'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, execSync } = require('child_process');

const { loadConfig } = require('./lib/config');
const { McsmClient } = require('./lib/mcsm-client');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY_BYTES = 1 * 1024 * 1024; // 1 MiB
const MAX_TEMPLATE_UPLOAD_BYTES = 300 * 1024 * 1024; // 300 MiB（MCC 模板上传上限）
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const TEMPLATE_DIR = path.join(__dirname, 'templates', 'mcc'); // 面板内置 MCC 模板目录

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

// ---------------------------------------------------------------------------
// 访问口令会话
// ---------------------------------------------------------------------------
const sessions = new Map(); // token -> { username, expiry }

function issueSession(username) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { username: username || '', expiry: Date.now() + SESSION_TTL_MS });
  return token;
}

function isSessionValid(token) {
  if (!token || !sessions.has(token)) return false;
  if (sessions.get(token).expiry < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function getSessionUser(token) {
  if (!token || !sessions.has(token)) return null;
  const s = sessions.get(token);
  if (s.expiry < Date.now()) { sessions.delete(token); return null; }
  return s.username || null;
}

function readBearerToken(req) {
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  const cookie = req.headers['cookie'] || '';
  const match = /(?:^|;\s*)mcc_panel_session=([^;]+)/.exec(cookie);
  return match ? decodeURIComponent(match[1]) : '';
}

// 操作日志（内存，最多 500 条）
const operationLogs = [];
function logOperation(user, action, detail) {
  operationLogs.push({ time: Date.now(), user: user || '-', action, detail: detail || '' });
  if (operationLogs.length > 500) operationLogs.shift();
}

// ---------------------------------------------------------------------------
// HTTP 工具
// ---------------------------------------------------------------------------
function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'"
  );
}

function sendJson(res, statusCode, payload) {
  setSecurityHeaders(res);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, text) {
  setSecurityHeaders(res);
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(text);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(new Error('JSON 解析失败'));
      }
    });
    req.on('error', reject);
  });
}

// 读取原始二进制 body（模板文件上传）
function readRawBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('文件过大（超过 ' + Math.round(maxBytes / 1024 / 1024) + 'MB）'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function resolvePublicFile(pathname) {
  const normalized = pathname === '/' ? '/index.html' : pathname;
  let decoded;
  try {
    decoded = decodeURIComponent(normalized);
  } catch (error) {
    return null;
  }
  const sanitized = decoded.replace(/^\/+/, '');
  const fullPath = path.resolve(PUBLIC_DIR, sanitized);
  const rel = path.relative(PUBLIC_DIR, fullPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return fullPath;
}

function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;

  const filePath = resolvePublicFile(pathname);
  if (!filePath) {
    sendText(res, 400, 'Bad Request');
    return true;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    sendText(res, 404, 'Not Found');
    return true;
  }

  const extension = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[extension] || 'application/octet-stream';
  setSecurityHeaders(res);
  res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache' });

  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => {
    if (!res.headersSent) sendText(res, 500, 'Internal Server Error');
    else res.destroy();
  });
  stream.pipe(res);
  return true;
}

// ---------------------------------------------------------------------------
// MCSM 代理：把本面板端点转成 MCSM 面板端点
// ---------------------------------------------------------------------------
function ok(data) {
  return { ok: true, status: 200, data, error: null };
}

function fail(error, status = 502) {
  return { ok: false, status, data: null, error };
}

// ---------------------------------------------------------------------------
// 创建 MCC 实例的辅助函数
// ---------------------------------------------------------------------------
function sanitizeName(name) {
  const cleaned = String(name || '').trim()
    .replace(/[\/\\\s:;'"`$&^|?*<>]+/g, '_')
    .slice(0, 64);
  return cleaned || 'bot';
}

function buildMatchesIni() {
  return [
    '# MCC AutoRespond 自动接受传送规则（可在实例目录的 matches.ini 中自行修改）',
    '# 匹配到 tpa / tphere 请求时自动发送 /tpaccept 接受传送',
    '',
    '[Match]',
    'match=请求传送到你',
    'action=send /tpaccept',
    'cooldown=5',
    '',
    '[Match]',
    'match=wants to teleport to you',
    'action=send /tpaccept',
    'cooldown=5',
    '',
    '[Match]',
    'match=requests to teleport to you',
    'action=send /tpaccept',
    'cooldown=5',
    ''
  ].join('\n');
}

function replaceAccountLine(ini, accountType, login) {
  const password = accountType === 'offline' ? '-' : '';
  const replacement = `Account = { Login = "${login}", Password = "${password}" }`;
  const re = /Account\s*=\s*\{[^}]*\}/;
  if (re.test(ini)) return ini.replace(re, () => replacement);
  return ini.replace(/(\[Main\.General\][^\[]*)/, (m) => m + '\n' + replacement);
}

function replaceServerLine(ini, host, port) {
  const portPart = (port && Number(port) > 0) ? `, Port = ${Number(port)}` : '';
  const replacement = `Server = { Host = "${host}"${portPart} }`;
  const re = /Server\s*=\s*\{[^}]*\}/;
  if (re.test(ini)) return ini.replace(re, () => replacement);
  return ini.replace(/(\[Main\.General\][^\[]*)/, (m) => m + '\n' + replacement);
}

function ensureAutoRespond(ini) {
  const header = '[ChatBot.AutoRespond]';
  const idx = ini.indexOf(header);
  if (idx >= 0) {
    const afterHeader = ini.slice(idx);
    const sectionEnd = afterHeader.search(/\n\[/);
    const section = sectionEnd >= 0 ? afterHeader.slice(0, sectionEnd) : afterHeader;
    if (/Enabled\s*=\s*true/.test(section)) return ini; // 已启用，不动
    let newSection = section;
    if (/Enabled\s*=\s*false/.test(section)) {
      newSection = section.replace(/Enabled\s*=\s*false/, 'Enabled = true');
    } else if (/Enabled\s*=/.test(section)) {
      newSection = section.replace(/Enabled\s*=\s*\S+/, 'Enabled = true');
    } else {
      newSection = section + '\nEnabled = true';
    }
    return ini.slice(0, idx) + newSection + ini.slice(idx + section.length);
  }
  return ini + '\n\n' + header + '\nEnabled = true\nMatches_File = "matches.ini"\n';
}

// ---------------------------------------------------------------------------
// 内置 MCC 模板（面板服务器本地 templates/mcc/）
// ---------------------------------------------------------------------------
function listTemplateFiles() {
  if (!fs.existsSync(TEMPLATE_DIR)) return [];
  return fs.readdirSync(TEMPLATE_DIR, { withFileTypes: true })
    .map((d) => ({
      name: d.name,
      type: d.isDirectory() ? 0 : 1,
      size: d.isFile() ? fs.statSync(path.join(TEMPLATE_DIR, d.name)).size : 0
    }))
    .sort((a, b) => a.type - b.type || a.name.localeCompare(b.name));
}

function sanitizeFileName(name) {
  return String(name || '').replace(/[\/\\\s:;'"`$&^|?*<>]+/g, '_').slice(0, 128);
}

// docker cp：面板模板 → daemon 容器实例目录
function copyTemplateToContainer(containerName, targetPath) {
  if (!containerName || !fs.existsSync(TEMPLATE_DIR)) return false;
  try {
    execSync(`docker cp ${JSON.stringify(TEMPLATE_DIR)}/. ${JSON.stringify(containerName + ':' + targetPath)}`, { timeout: 90000 });
    return true;
  } catch (e) {
    return false;
  }
}

// docker cp：daemon 容器实例目录 → 面板模板目录（初始化/更新内置模板）
function initTemplateFromContainer(containerName, sourcePath) {
  if (!containerName) return null;
  try {
    fs.mkdirSync(TEMPLATE_DIR, { recursive: true });
    execSync(`docker cp ${JSON.stringify(containerName + ':' + sourcePath)}/. ${JSON.stringify(TEMPLATE_DIR)}`, { timeout: 180000 });
    return listTemplateFiles();
  } catch (e) {
    return null;
  }
}

async function createMcsmInstance(mcsm, body, panelConfig) {
  const { daemonId, name, serverIp, serverPort, accountType, accountLogin, autoAcceptTpa } = body;
  if (!daemonId || !name || !serverIp || !accountLogin) {
    return fail('缺少参数：daemonId / name / serverIp / accountLogin 不能为空', 400);
  }
  const safeName = sanitizeName(name);
  const host = String(serverIp).trim().replace(/["\r\n]/g, '');
  const isOffline = accountType === 'offline';
  // 离线账号：登录名(游戏名)强制与实例名统一；微软账号用填写的邮箱
  let login = String(accountLogin || '').trim().replace(/["\r\n]/g, '');
  if (isOffline) login = safeName;

  const panelUrl = (panelConfig && panelConfig.mcsm && panelConfig.mcsm.url) || '';
  const container = (panelConfig && panelConfig.mcsm && panelConfig.mcsm.daemonContainer) || '';
  const tplFiles = listTemplateFiles();
  const hasLocalTemplate = tplFiles.length > 0;
  const tplIniPath = path.join(TEMPLATE_DIR, 'MinecraftClient.ini');

  // 判断目标节点是否面板本机（daemon ip 等于面板 url host）
  let isLocalNode = false;
  try {
    const dlR = await mcsm.request('GET', '/api/service/remote_services_list');
    const node = ((dlR.data && Array.isArray(dlR.data)) ? dlR.data : []).find((d) => d.uuid === daemonId) || null;
    let panelHost = '';
    try { panelHost = new URL(panelUrl).hostname; } catch (e) { /* 忽略 */ }
    isLocalNode = !!node && !!panelHost && (node.ip === panelHost || node.ip === '127.0.0.1' || node.ip === 'localhost');
  } catch (e) { isLocalNode = false; }

  // 1. 确定可执行文件名与模板 ini（优先内置模板）
  let exeName = '';
  const exeTpl = tplFiles.find((f) => f.type === 1 && /^MinecraftClient/i.test(f.name) && !/\.(ini|db)$/i.test(f.name));
  if (exeTpl) exeName = exeTpl.name;

  let ini = null;
  if (fs.existsSync(tplIniPath)) {
    try { ini = fs.readFileSync(tplIniPath, 'utf8'); } catch (e) { ini = null; }
  }

  // fallback：从该节点的 MCC 实例获取
  let template = null;
  if (!exeName || !ini) {
    const listR = await mcsm.request('GET', '/api/service/remote_service_instances', {
      daemonId, page: 1, page_size: 50
    });
    const instances = (listR.data && listR.data.data) || [];
    template = instances.find((i) => String((i.config && i.config.startCommand) || '').includes('MinecraftClient'));
    if (!template) return fail('内置 MCC 模板为空且该节点无 MCC 实例可复制，请先在「模板」中初始化内置 MCC', 400);
    if (!exeName) exeName = String(template.config.startCommand).split('/').pop();
    if (!ini) {
      const iniR = await mcsm.request('PUT', '/api/files/', { daemonId, uuid: template.instanceUuid }, { target: 'MinecraftClient.ini' });
      if (iniR.status !== 200 || typeof iniR.data !== 'string') {
        return fail('读取 MCC 模板配置失败: ' + (iniR.error || '非文本返回'), iniR.status || 500);
      }
      ini = iniR.data;
    }
  }

  // 2. 生成新实例配置（替换账号/服务器）
  ini = replaceAccountLine(ini, isOffline ? 'offline' : 'microsoft', login);
  ini = replaceServerLine(ini, host, serverPort);
  if (autoAcceptTpa) ini = ensureAutoRespond(ini);

  // 3. 创建 MCSM 实例（cwd 由 daemon 自动创建；startCommand 指向新目录自己的可执行文件）
  const cwd = `/mcc/${safeName}/`;
  const config = {
    nickname: safeName,
    startCommand: cwd + exeName,
    stopCommand: '^c',
    cwd,
    type: 'universal',
    processType: 'general',
    terminalOption: { haveColor: true, pty: false, ptyWindowCol: 164, ptyWindowRow: 40 },
    eventTask: { autoStart: false, autoRestart: false, autoRestartMaxTimes: 3, ignore: false }
  };
  const createR = await mcsm.request('POST', '/api/instance', { daemonId }, config);
  if (createR.status !== 200) return fail('创建实例失败: ' + (createR.error || createR.status), createR.status || 500);
  const newUuid = createR.data && (createR.data.instanceUuid || (createR.data.instances && createR.data.instances[0] && createR.data.instances[0].instanceUuid));
  if (!newUuid) return fail('创建实例失败：未返回实例 uuid', 500);

  // 4. 复制 MCC 文件到新实例目录
  if (isLocalNode && container && hasLocalTemplate) {
    // 本机节点：docker cp 内置模板（可靠、独立、不依赖任何实例）
    const okCp = copyTemplateToContainer(container, cwd);
    if (!okCp) return fail('复制内置 MCC 模板失败（docker cp 出错，请检查 daemonContainer 配置）', 500);
  } else {
    // 回退：从该节点的 MCC 实例逐个 file/copy（远程节点）
    const templateCwd = String(template.config.cwd || '').replace(/\/+$/, '') || '/mcc';
    const tplListR = await mcsm.request('GET', '/api/files/list', {
      daemonId, uuid: 'global0001', target: templateCwd, page: 0, page_size: 100, file_name: ''
    });
    const tplEntries = (tplListR.status === 200 && tplListR.data && tplListR.data.items) || [];
    const newCwdPath = cwd.replace(/\/+$/, '');
    for (const it of tplEntries) {
      const pair = [templateCwd + '/' + it.name, newCwdPath + '/' + it.name];
      const copyR = await mcsm.request('POST', '/api/files/copy', { daemonId, uuid: 'global0001' }, { targets: [pair] });
      if (copyR.status !== 200) {
        return fail('复制文件失败 ' + it.name + ': ' + (copyR.error || copyR.status), copyR.status || 500);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  // 5. 写入新实例自己的 MinecraftClient.ini（覆盖复制来的模板配置）
  const writeR = await mcsm.request('PUT', '/api/files/', { daemonId, uuid: newUuid }, { target: 'MinecraftClient.ini', text: ini });
  if (writeR.status !== 200) return fail('写入 MCC 配置失败: ' + (writeR.error || writeR.status), writeR.status || 500);

  // 6. 写入 matches.ini（自动接取传送）
  if (autoAcceptTpa) {
    const touchM = await mcsm.request('POST', '/api/files/touch', { daemonId, uuid: newUuid }, { target: 'matches.ini' });
    if (touchM.status !== 200) return fail('创建 matches.ini 失败: ' + (touchM.error || touchM.status), touchM.status || 500);
    const mwR = await mcsm.request('PUT', '/api/files/', { daemonId, uuid: newUuid }, { target: 'matches.ini', text: buildMatchesIni() });
    if (mwR.status !== 200) return fail('写入 matches.ini 失败: ' + (mwR.error || mwR.status), mwR.status || 500);
  }

  return ok({ instanceUuid: newUuid, nickname: safeName, cwd, autoAcceptTpa: !!autoAcceptTpa });
}

// ---------------------------------------------------------------------------
// 背包与账号名
// ---------------------------------------------------------------------------
function stripAnsiLog(s) {
  if (typeof s !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, '');
}

// 游戏名缓存（uuid -> {name, time}），日志很少变，缓存 10 分钟
const usernameCache = new Map();

async function getInstanceUsername(mcsm, daemonId, uuid) {
  const cached = usernameCache.get(uuid);
  if (cached && Date.now() - cached.time < 600000) {
    return cached.name;
  }
  let name = null;
  try {
    // SessionCache.db 内含微软账号 JWT，pfd[0].name 即正版游戏名
    const r = await mcsm.request('PUT', '/api/files/', { daemonId, uuid }, { target: 'SessionCache.db' });
    const text = typeof r.data === 'string' ? r.data : '';
    const jwts = text.match(/eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*/g) || [];
    for (const j of jwts) {
      try {
        const payload = JSON.parse(Buffer.from(j.split('.')[1], 'base64url').toString('utf8'));
        const n = payload.pfd && payload.pfd[0] && payload.pfd[0].name;
        if (n) name = n; // 取最后一个（最近登录的账号）
      } catch (e) { /* 忽略无效 JWT */ }
    }
  } catch (e) { /* SessionCache.db 不存在等情况 */ }
  usernameCache.set(uuid, { name, time: Date.now() });
  return name;
}

async function getInstanceInventory(mcsm, daemonId, uuid) {
  // 1. 发送查看背包命令（MCC 26.x 语法为 /inventory player list）
  const cmdR = await mcsm.request('POST', '/api/protected_instance/command', {
    daemonId, uuid, command: '/inventory player list'
  });
  if (cmdR.status !== 200) return fail('发送命令失败: ' + (cmdR.error || cmdR.status), cmdR.status || 500);

  // 2. 等待 MCC 处理并输出
  await new Promise((resolve) => setTimeout(resolve, 1300));

  // 3. 读取日志，取最后一次 Inventory 输出段
  const logR = await mcsm.request('GET', '/api/protected_instance/outputlog', { daemonId, uuid, size: 65536 });
  const log = stripAnsiLog(typeof logR.data === 'string' ? logR.data : '');
  const idx = log.lastIndexOf('Inventory #');
  const seg = idx >= 0 ? log.slice(idx) : log;

  const items = [];
  for (const line of seg.split('\n')) {
    const m = line.match(/\|\s*#(\d+):\s*x(\d+)\s+(.+)/);
    if (!m) continue;
    let name = m[3].trim();
    name = name.replace(/§./g, '').replace(/\s*-\s*.*$/, '').trim();
    items.push({ slot: Number(m[1]), count: Number(m[2]), name });
  }
  // 去重（同一 slot 取最后一次）
  const map = new Map();
  for (const it of items) map.set(it.slot, it);
  const slots = Array.from(map.values()).sort((a, b) => a.slot - b.slot);
  return ok({ slots, enabled: slots.length > 0 });
}

async function proxyRoute(mcsm, ctx, panelConfig) {
  const { pathname, query, method, body } = ctx;
  try {
    switch (`${method} ${pathname}`) {
      case 'GET /api/daemons': {
        // remote_services_list 明确返回 uuid / remarks / available，适合做节点列表
        const r = await mcsm.request('GET', '/api/service/remote_services_list');
        return r.status === 200 ? ok(r.data) : fail(r.error, r.status);
      }

      case 'GET /api/daemon-system': {
        // 节点系统信息（CPU/内存/负载），与节点列表合并 uuid 便于精确匹配
        const [listR, sysR] = await Promise.all([
          mcsm.request('GET', '/api/service/remote_services_list'),
          mcsm.request('GET', '/api/service/remote_services_system')
        ]);
        const daemonList = (listR.data && Array.isArray(listR.data)) ? listR.data : [];
        const sysList = (sysR.data && Array.isArray(sysR.data)) ? sysR.data : [];
        const merged = daemonList.map((d, i) => ({
          uuid: d.uuid,
          remarks: d.remarks,
          available: d.available,
          system: sysList[i] && sysList[i].system ? sysList[i].system : null
        }));
        return ok(merged);
      }

      case 'GET /api/instances': {
        const r = await mcsm.request('GET', '/api/service/remote_service_instances', {
          daemonId: query.daemonId,
          page: query.page || 1,
          page_size: query.page_size || 50,
          instance_name: query.instance_name,
          status: query.status
        });
        return r.status === 200 ? ok(r.data) : fail(r.error, r.status);
      }

      case 'GET /api/instance': {
        const r = await mcsm.request('GET', '/api/instance', {
          daemonId: query.daemonId,
          uuid: query.uuid
        });
        return r.status === 200 ? ok(r.data) : fail(r.error, r.status);
      }

      case 'POST /api/instance/action': {
        const action = String(body.action || '');
        const allowed = ['open', 'stop', 'restart', 'kill'];
        if (!allowed.includes(action)) return fail(`非法操作: ${action}`, 400);
        const r = await mcsm.request('POST', `/api/protected_instance/${action}`, {
          daemonId: body.daemonId,
          uuid: body.uuid
        });
        if (r.status === 200) logOperation(ctx.operator, '实例操作', action + ' uuid=' + (body.uuid || ''));
        return r.status === 200 ? ok(r.data) : fail(r.error, r.status);
      }

      case 'POST /api/instance/command': {
        if (!body.command || !String(body.command).trim()) return fail('命令不能为空', 400);
        const r = await mcsm.request('POST', '/api/protected_instance/command', {
          daemonId: body.daemonId,
          uuid: body.uuid,
          command: String(body.command)
        });
        if (r.status === 200) logOperation(ctx.operator, '发送命令', String(body.command) + ' uuid=' + (body.uuid || ''));
        return r.status === 200 ? ok(r.data) : fail(r.error, r.status);
      }

      case 'GET /api/instance/outputlog': {
        const r = await mcsm.request('GET', '/api/protected_instance/outputlog', {
          daemonId: query.daemonId,
          uuid: query.uuid,
          size: query.size
        });
        // MCSM 的 outputlog 直接返回文本（可能是字符串，可能带 status 包装）
        return r.status === 200 ? ok(typeof r.data === 'string' ? r.data : r.data) : fail(r.error, r.status);
      }

      case 'PUT /api/instance/config': {
        if (!body.config || typeof body.config !== 'object') return fail('config 缺失', 400);
        const r = await mcsm.request('PUT', '/api/instance', {
          daemonId: body.daemonId,
          uuid: body.uuid
        }, body.config);
        if (r.status === 200) logOperation(ctx.operator, '修改配置', 'uuid=' + (body.uuid || ''));
        return r.status === 200 ? ok(r.data) : fail(r.error, r.status);
      }

      case 'GET /api/files/list': {
        const r = await mcsm.request('GET', '/api/files/list', {
          daemonId: query.daemonId,
          uuid: query.uuid,
          target: query.target || '/',
          page: query.page || 0,
          page_size: query.page_size || 100,
          file_name: query.file_name || ''
        });
        return r.status === 200 ? ok(r.data) : fail(r.error, r.status);
      }

      case 'GET /api/files/read': {
        // MCSM 读文件：PUT /api/files/ body { target }（不带 text 即为读取）
        const r = await mcsm.request('PUT', '/api/files/', {
          daemonId: query.daemonId,
          uuid: query.uuid
        }, { target: query.target });
        return r.status === 200 ? ok(r.data) : fail(r.error, r.status);
      }

      case 'POST /api/files/write': {
        if (typeof body.target !== 'string' || typeof body.text !== 'string') {
          return fail('target / text 缺失', 400);
        }
        const r = await mcsm.request('PUT', '/api/files/', {
          daemonId: body.daemonId,
          uuid: body.uuid
        }, { target: body.target, text: body.text });
        if (r.status === 200) logOperation(ctx.operator, '写入文件', String(body.target || ''));
        return r.status === 200 ? ok(r.data) : fail(r.error, r.status);
      }

      case 'POST /api/files/touch': {
        if (typeof body.target !== 'string' || !body.target) return fail('target 缺失', 400);
        const r = await mcsm.request('POST', '/api/files/touch', { daemonId: body.daemonId, uuid: body.uuid }, { target: body.target });
        return r.status === 200 ? ok(r.data) : fail(r.error, r.status);
      }

      case 'POST /api/files/mkdir': {
        if (typeof body.target !== 'string' || !body.target) return fail('target 缺失', 400);
        const r = await mcsm.request('POST', '/api/files/mkdir', { daemonId: body.daemonId, uuid: body.uuid }, { target: body.target });
        return r.status === 200 ? ok(r.data) : fail(r.error, r.status);
      }

      case 'POST /api/files/delete': {
        if (!Array.isArray(body.targets) || body.targets.length === 0) return fail('targets 缺失', 400);
        const r = await mcsm.request('DELETE', '/api/files/', { daemonId: body.daemonId, uuid: body.uuid }, { targets: body.targets });
        if (r.status === 200) logOperation(ctx.operator, '删除文件', (body.targets || []).join(', '));
        return r.status === 200 ? ok(r.data) : fail(r.error, r.status);
      }

      case 'POST /api/files/copy': {
        if (!Array.isArray(body.targets) || body.targets.length === 0) return fail('targets 缺失', 400);
        const r = await mcsm.request('POST', '/api/files/copy', { daemonId: body.daemonId, uuid: body.uuid }, { targets: body.targets });
        return r.status === 200 ? ok(r.data) : fail(r.error, r.status);
      }

      case 'POST /api/files/move': {
        if (!Array.isArray(body.targets) || body.targets.length === 0) return fail('targets 缺失', 400);
        const r = await mcsm.request('PUT', '/api/files/move', { daemonId: body.daemonId, uuid: body.uuid }, { targets: body.targets });
        return r.status === 200 ? ok(r.data) : fail(r.error, r.status);
      }

      case 'POST /api/instance/inventory': {
        return getInstanceInventory(mcsm, body.daemonId, body.uuid);
      }

      case 'GET /api/instance/username': {
        const name = await getInstanceUsername(mcsm, query.daemonId, query.uuid);
        return ok(name);
      }

      case 'POST /api/instance/create': {
        const r = await createMcsmInstance(mcsm, body, panelConfig);
        if (r.ok) logOperation(ctx.operator, '创建实例', (body && body.name) || '');
        return r;
      }

      case 'POST /api/instance/delete': {
        if (!Array.isArray(body.uuids) || body.uuids.length === 0) return fail('uuids 缺失', 400);
        const deleteFile = Boolean(body.deleteFile);
        const r = await mcsm.request('DELETE', '/api/instance', { daemonId: body.daemonId }, { uuids: body.uuids, deleteFile });
        if (r.status === 200) logOperation(ctx.operator, '删除实例', (body.uuids || []).join(', ') + (deleteFile ? '（含文件）' : ''));
        return r.status === 200 ? ok(r.data) : fail(r.error, r.status);
      }

      default:
        return null; // 未匹配
    }
  } catch (error) {
    return fail(error.message || '代理请求失败', 502);
  }
}

// ---------------------------------------------------------------------------
// 服务器
// ---------------------------------------------------------------------------
function createServer(options = {}) {
  const { config, configPath } = options;
  const mcsm = new McsmClient(config.mcsm);
  const users = Array.isArray(config.users) ? config.users : [];
  const authEnabled = Boolean(config.authToken || users.length > 0);

  function verifyLogin(username, password) {
    if (users.length > 0) {
      const u = users.find((x) => x && x.username === username && x.password === password);
      return u ? u.username : null;
    }
    // 单口令兼容模式
    if (config.authToken && password === config.authToken) return username || 'admin';
    return null;
  }

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      const pathname = url.pathname;
      const method = req.method.toUpperCase();

      // ---- 认证接口（无需登录）----
      if (method === 'POST' && pathname === '/api/auth/login') {
        const body = await readJsonBody(req);
        if (!authEnabled) {
          sendJson(res, 200, { ok: true, token: '', title: config.title, authed: true, user: 'guest' });
          return;
        }
        const username = String(body.username || '').trim();
        const password = String(body.password || '');
        const user = verifyLogin(username, password);
        if (user) {
          const token = issueSession(user);
          logOperation(user, '登录', '登录面板');
          sendJson(res, 200, { ok: true, token, title: config.title, authed: true, user });
        } else {
          sendJson(res, 401, { ok: false, error: '账号或密码错误' });
        }
        return;
      }

      if (method === 'POST' && pathname === '/api/auth/logout') {
        const token = readBearerToken(req);
        const u = getSessionUser(token);
        if (u) logOperation(u, '退出', '退出登录');
        sessions.delete(token);
        sendJson(res, 200, { ok: true });
        return;
      }

      if (method === 'GET' && pathname === '/api/auth/status') {
        const token = readBearerToken(req);
        const authed = !authEnabled || isSessionValid(token);
        sendJson(res, 200, { ok: true, authed, title: config.title, user: authed ? getSessionUser(token) : null });
        return;
      }

      if (method === 'GET' && pathname === '/healthz') {
        sendJson(res, 200, { ok: true, title: config.title });
        return;
      }

      // ---- 面板公开配置（不含 apikey）----
      if (method === 'GET' && pathname === '/api/config') {
        sendJson(res, 200, ok({
          title: config.title,
          mcsmUrl: config.mcsm.url,
          mcsmConfigured: Boolean(config.mcsm.url && config.mcsm.apikey),
          logPollIntervalMs: config.logPollIntervalMs,
          listPollIntervalMs: config.listPollIntervalMs
        }));
        return;
      }

      // ---- 其余 /api/* 需认证 ----
      if (pathname.startsWith('/api/')) {
        const token = readBearerToken(req);
        if (authEnabled && !isSessionValid(token)) {
          sendJson(res, 401, { ok: false, error: '未登录或会话已过期' });
          return;
        }
        const operator = getSessionUser(token) || '';

        // 操作日志查询
        if (method === 'GET' && pathname === '/api/operation-logs') {
          sendJson(res, 200, ok(operationLogs.slice().reverse()));
          return;
        }

        // ---- 内置 MCC 模板管理（面板本地）----
        if (method === 'GET' && pathname === '/api/template/list') {
          sendJson(res, 200, ok(listTemplateFiles()));
          return;
        }
        if (method === 'POST' && pathname === '/api/template/upload') {
          const name = sanitizeFileName(String(url.searchParams.get('name') || ''));
          if (!name) { sendJson(res, 400, fail('文件名缺失', 400)); return; }
          let buf;
          try {
            buf = await readRawBody(req, MAX_TEMPLATE_UPLOAD_BYTES);
          } catch (error) {
            sendJson(res, 400, fail(error.message, 400));
            return;
          }
          fs.mkdirSync(TEMPLATE_DIR, { recursive: true });
          fs.writeFileSync(path.join(TEMPLATE_DIR, name), buf);
          logOperation(operator, '上传模板', name + ' (' + buf.length + ' 字节)');
          sendJson(res, 200, ok({ name, size: buf.length }));
          return;
        }
        if (method === 'DELETE' && pathname === '/api/template/file') {
          const name = sanitizeFileName(String(url.searchParams.get('name') || ''));
          const p = path.join(TEMPLATE_DIR, name);
          if (!name || !p.startsWith(TEMPLATE_DIR) || !fs.existsSync(p)) {
            sendJson(res, 404, fail('文件不存在', 404));
            return;
          }
          fs.rmSync(p, { recursive: true, force: true });
          logOperation(operator, '删除模板文件', name);
          sendJson(res, 200, ok(true));
          return;
        }
        if (method === 'POST' && pathname === '/api/template/init') {
          const b = (method === 'POST') ? await readJsonBody(req) : {};
          const containerName = String((config.mcsm && config.mcsm.daemonContainer) || b.container || '');
          const src = String(b.source || '/mcc').replace(/\/+$/, '');
          if (!containerName) { sendJson(res, 400, fail('未配置 daemonContainer', 400)); return; }
          const files = initTemplateFromContainer(containerName, src);
          if (files === null) {
            sendJson(res, 500, fail('初始化失败（docker cp 出错，请检查容器名与源路径）', 500));
            return;
          }
          logOperation(operator, '初始化模板', '从 ' + containerName + ':' + src);
          sendJson(res, 200, ok(files));
          return;
        }

        const body = (method === 'POST' || method === 'PUT' || method === 'PATCH')
          ? await readJsonBody(req)
          : {};
        const result = await proxyRoute(mcsm, {
          pathname,
          query: Object.fromEntries(url.searchParams.entries()),
          method,
          body,
          operator
        }, config);
        if (result === null) {
          sendJson(res, 404, fail('接口不存在', 404));
        } else {
          sendJson(res, result.ok ? 200 : (result.status || 502), result);
        }
        return;
      }

      // ---- 静态文件 ----
      if (serveStatic(req, res, pathname)) return;
      sendText(res, 405, 'Method Not Allowed');
    } catch (error) {
      if (!res.headersSent) {
        sendJson(res, 500, { ok: false, error: error.message || 'Internal Server Error' });
      } else {
        res.destroy();
      }
    }
  });
}

async function main() {
  const configArg = process.argv[2];
  const { config, configPath } = loadConfig(configArg);

  if (!config.mcsm.url || !config.mcsm.apikey) {
    console.warn('[MCC_PANEL] 警告: 未配置 MCSM url/apikey，请在 panel.config.json 中填写。');
  }
  if (!config.authToken) {
    console.warn('[MCC_PANEL] 警告: 未配置 authToken，面板将不启用访问口令（不安全）。');
  }

  const server = createServer({ config, configPath });

  await new Promise((resolve) => {
    server.listen(config.port, config.host, resolve);
  });

  console.log(`[MCC_PANEL] 已启动: http://${config.host}:${config.port}`);
  console.log(`[MCC_PANEL] 目标 MCSM: ${config.mcsm.url}`);
  console.log(`[MCC_PANEL] 访问口令: ${config.authToken ? '已启用' : '未启用(不安全)'}`);

  const shutdown = () => {
    server.close(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[MCC_PANEL] 启动失败:', error && error.stack ? error.stack : error);
    process.exit(1);
  });
}

module.exports = { createServer, loadConfig };
