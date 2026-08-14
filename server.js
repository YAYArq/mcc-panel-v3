'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, execSync } = require('child_process');

const { loadConfig } = require('./lib/config');
const { McsmClient } = require('./lib/mcsm-client');
const store = require('./lib/store');
const { HealthTracker } = require('./lib/health');
const { AutomationEngine } = require('./lib/automation');
const { handleV3Route } = require('./lib/v3-routes');
const mccMod = require('./lib/mcc-mod');
const { createAvatarService } = require('./lib/avatar');

// 正版玩家头像服务（Mojang API 代理，解决 CSP 拦截外部头像源的问题）
const avatarService = createAvatarService();

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
// 访问口令会话（v3 起带角色 role：admin / readonly）
// ---------------------------------------------------------------------------
const sessions = new Map(); // token -> { username, role, expiry }

function issueSession(username, role) {
  const token = crypto.randomBytes(32).toString('hex');
  // 角色三档：admin / user（普通用户）/ readonly（只读）
  const normalized = ['admin', 'user', 'readonly'].includes(role) ? role : 'admin';
  sessions.set(token, { username: username || '', role: normalized, expiry: Date.now() + SESSION_TTL_MS });
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

/** 获取会话完整信息（含角色），用于权限判断与 v3 路由。 */
function getSessionInfo(token) {
  if (!token || !sessions.has(token)) return null;
  const s = sessions.get(token);
  if (s.expiry < Date.now()) { sessions.delete(token); return null; }
  return { username: s.username || '', role: s.role || 'admin' };
}

function readBearerToken(req) {
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  const cookie = req.headers['cookie'] || '';
  const match = /(?:^|;\s*)mcc_panel_session=([^;]+)/.exec(cookie);
  return match ? decodeURIComponent(match[1]) : '';
}

// ---- IP 白名单（v3 安全增强）----
function clientIp(req, config) {
  if (config && config.trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) return String(xff).split(',')[0].trim();
  }
  const addr = req.socket.remoteAddress || '';
  return addr.startsWith('::ffff:') ? addr.slice(7) : addr;
}

function ipAllowed(req, config) {
  if (!config || !config.ipWhitelistEnabled) return true;
  const list = (config.ipWhitelist || []).map((x) => String(x).trim()).filter(Boolean);
  if (list.length === 0) return false; // 启用了但未配置 IP = 拒绝所有
  return list.includes(clientIp(req, config));
}

// 操作日志（内存 + data/logs.jsonl 持久化，最多 10000 条）
const operationLogs = [];
const LOGS_MAX = 10000;
// 启动时加载历史日志（供 v3 筛选/导出）
(function loadOperationLogs() {
  try {
    operationLogs.push(...store.readLines('logs.jsonl', LOGS_MAX));
  } catch (e) { /* 忽略 */ }
})();
function logOperation(user, action, detail) {
  const entry = { time: Date.now(), user: user || '-', action, detail: detail || '' };
  operationLogs.push(entry);
  try {
    store.appendLine('logs.jsonl', entry);
    if (operationLogs.length > LOGS_MAX) {
      operationLogs.splice(0, operationLogs.length - LOGS_MAX);
      store.truncateLines('logs.jsonl', LOGS_MAX);
    }
  } catch (e) { /* 持久化失败不阻塞请求 */ }
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

/** 生成 matches.ini（自动接受传送规则，trigger 为可配置正则，兼容各服务器插件提示文本）。 */
function buildMatchesIni(pattern) {
  const rules = String(pattern || '').trim() ? [String(pattern).trim()] : [
    '请求传送到你|wants to teleport to you|requests to teleport to you|invites you to teleport to them'
  ];
  const lines = [
    '# MCC AutoRespond 自动接受传送规则（可在实例目录的 matches.ini 中自行修改）',
    '# match 为正则表达式，匹配到传送请求时自动发送 /tpaccept 接受传送',
    '# 不同服务器插件提示文本不同，可在面板「设置」中修改「传送请求正则」',
    ''
  ];
  for (const rule of rules) {
    lines.push('[Match]');
    lines.push('match=' + rule);
    lines.push('action=send /tpaccept');
    lines.push('cooldown=5');
    lines.push('');
  }
  return lines.join('\n');
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
  const { daemonId, name, serverIp, serverPort, accountType, accountLogin, autoAcceptTpa, tpaRegex } = body;
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

  // 4.5 自动接受传送（tpa）：新版 MCC 原生方案 RemoteControl + ChatFormat 正则
  //     正则按服务器插件提示文本可配置（body.tpaRegex），默认兼容常见中英文提示
  let finalTpaRegex = '';
  if (autoAcceptTpa) {
    finalTpaRegex = String(body.tpaRegex || mccMod.defaultTeleportRegex()).replace(/["\r\n]/g, '');
    ini = mccMod.setKey(ini, 'ChatFormat', 'TeleportRequest', '"' + finalTpaRegex + '"');
    ini = mccMod.setKey(ini, 'ChatBot.RemoteControl', 'Enabled', 'true');
    ini = mccMod.setKey(ini, 'ChatBot.RemoteControl', 'AutoTpaccept', 'true');
    ini = mccMod.setKey(ini, 'ChatBot.RemoteControl', 'AutoTpaccept_Everyone', 'false');
  }

  // 5. 写入新实例自己的 MinecraftClient.ini（覆盖复制来的模板配置）
  const writeR = await mcsm.request('PUT', '/api/files/', { daemonId, uuid: newUuid }, { target: 'MinecraftClient.ini', text: ini });
  if (writeR.status !== 200) return fail('写入 MCC 配置失败: ' + (writeR.error || writeR.status), writeR.status || 500);

  // 6. 写入 matches.ini（自动接取传送，AutoRespond 兜底方案）
  if (autoAcceptTpa) {
    const touchM = await mcsm.request('POST', '/api/files/touch', { daemonId, uuid: newUuid }, { target: 'matches.ini' });
    if (touchM.status !== 200) return fail('创建 matches.ini 失败: ' + (touchM.error || touchM.status), touchM.status || 500);
    const mwR = await mcsm.request('PUT', '/api/files/', { daemonId, uuid: newUuid }, { target: 'matches.ini', text: buildMatchesIni(finalTpaRegex) });
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

// 实例名缓存（daemonId::uuid -> {name, time}），操作日志显示实例名用，缓存 10 分钟
const instanceNameCache = new Map();

/** 获取 MCSM 实例名（config.nickname），失败返回空字符串。 */
async function getInstanceName(mcsm, daemonId, uuid) {
  const key = String(daemonId) + '::' + String(uuid);
  const cached = instanceNameCache.get(key);
  if (cached && Date.now() - cached.time < 600000) return cached.name;
  let name = '';
  try {
    const r = await mcsm.request('GET', '/api/instance', { daemonId, uuid });
    if (r.status === 200 && r.data && typeof r.data === 'object' && r.data.config) {
      name = String(r.data.config.nickname || '');
    }
  } catch (e) { /* 忽略，返回空 */ }
  instanceNameCache.set(key, { name, time: Date.now() });
  return name;
}

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

// ---------------------------------------------------------------------------
// 删除实例辅助：MCSM 10 要求实例为「已停止」状态才允许删除
// （daemon 端 removeInstance 对运行中实例直接抛错，且 panel 端会先删数据库
//   记录再请求 daemon，运行中删除会造成记录与实例不一致）。
// 因此删除前先停止实例并轮询等待其进入已停止状态，失败则放弃删除并报错。
// ---------------------------------------------------------------------------
const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 查询实例状态码（0=已停止 1=停止中 2=启动中 3=运行中 -1=忙碌；查询失败返回 null）。 */
async function getInstanceStatusCode(mcsm, daemonId, uuid) {
  try {
    const r = await mcsm.request('GET', '/api/instance', { daemonId, uuid });
    if (r.status !== 200 || !r.data || typeof r.data !== 'object') return null;
    return String(r.data.status == null ? '' : r.data.status);
  } catch (e) {
    return null;
  }
}

/**
 * 停止实例并等待其进入「已停止」状态（先 stop，超时后 kill）。
 * @returns {Promise<boolean>} 已停止返回 true；无法停止返回 false
 */
async function ensureInstanceStopped(mcsm, daemonId, uuid) {
  const first = await getInstanceStatusCode(mcsm, daemonId, uuid);
  if (first === '0') return true;          // 已停止
  if (first === null) return true;         // 状态查询失败不阻塞，交给删除接口报错

  // 非停止状态：先尝试正常停止
  try {
    await mcsm.request('POST', '/api/protected_instance/stop', { daemonId, uuid });
  } catch (e) { /* stop 失败（忙碌等）继续轮询 */ }

  // 轮询等待停止（最长 45s）
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    await sleepMs(1000);
    const s = await getInstanceStatusCode(mcsm, daemonId, uuid);
    if (s === '0') return true;
    if (s === null) return true;
  }

  // 超时仍未停止：尝试强杀（最长再等 20s）
  try {
    await mcsm.request('POST', '/api/protected_instance/kill', { daemonId, uuid });
  } catch (e) { /* kill 失败继续轮询 */ }
  const deadline2 = Date.now() + 20000;
  while (Date.now() < deadline2) {
    await sleepMs(1000);
    const s = await getInstanceStatusCode(mcsm, daemonId, uuid);
    if (s === '0') return true;
    if (s === null) return true;
  }
  return false;
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
        if (r.status === 200) {
          const instName = await getInstanceName(mcsm, body.daemonId, body.uuid);
          logOperation(ctx.operator, '实例操作', action + ' → ' + (instName || body.uuid));
        }
        return r.status === 200 ? ok(r.data) : fail(r.error, r.status);
      }

      case 'POST /api/instance/command': {
        if (!body.command || !String(body.command).trim()) return fail('命令不能为空', 400);
        const r = await mcsm.request('POST', '/api/protected_instance/command', {
          daemonId: body.daemonId,
          uuid: body.uuid,
          command: String(body.command)
        });
        if (r.status === 200) {
          const instName = await getInstanceName(mcsm, body.daemonId, body.uuid);
          logOperation(ctx.operator, '发送命令', String(body.command) + ' → ' + (instName || body.uuid));
        }
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
        // MCSM 10 只允许删除「已停止」实例：删除前逐个自动停止并等待
        const stopFailures = [];
        for (const uuid of body.uuids) {
          const stopped = await ensureInstanceStopped(mcsm, body.daemonId, uuid);
          if (!stopped) stopFailures.push(uuid);
        }
        if (stopFailures.length > 0) {
          return fail('实例未能停止（请手动停止后再删除，本次未执行删除）: ' + stopFailures.join(', '), 502);
        }
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

  // ---- v3：健康监控 + 自动化引擎 ----
  const health = new HealthTracker();
  const engine = new AutomationEngine({ mcsm, config, health, logOperation });
  setTimeout(() => engine.start(), 1500); // 等服务监听就绪后启动后台循环

  // ---- 注册用户（data/users.json，密码 sha256+盐 哈希；config.users 为初始/最早用户）----
  const REG_USERS_STORE = 'users.json';

  function hashPassword(password, salt) {
    return crypto.createHash('sha256').update(String(password) + ':' + salt).digest('hex');
  }

  function registeredUsers() {
    const saved = store.load(REG_USERS_STORE, { users: [] });
    return (saved && Array.isArray(saved.users)) ? saved.users : [];
  }

  function isOwnerUser(username) {
    // 「最早的 admin」= 配置文件 users 数组的第一个用户；
    // 单口令模式（未配置 users）下登录者即管理员，视为 owner。
    if (users.length === 0) return true;
    const first = users[0];
    return !!first && first.username === username;
  }

  /**
   * 普通用户（role=user）是否被授权操作指定实例。
   * instances = null 表示不限制（admin）；数组 = 授权实例清单。
   */
  function userCanAccessInstance(username, daemonId, uuid) {
    const u = registeredUsers().find((x) => x && x.username === username);
    if (!u) return false;
    if (u.role !== 'user') return true;
    const list = u.instances;
    if (list == null) return true;
    if (!Array.isArray(list)) return false;
    return list.some((i) => i && String(i.daemonId) === String(daemonId) && String(i.uuid) === String(uuid));
  }

  function verifyLogin(username, password) {
    if (users.length > 0) {
      const u = users.find((x) => x && x.username === username && x.password === password);
      if (u) return { username: u.username, role: u.role === 'readonly' ? 'readonly' : 'admin' };
    }
    // 注册用户（data/users.json，密码哈希校验；角色可为 admin / user / readonly）
    const ru = registeredUsers().find((x) => x && x.username === username);
    if (ru && ru.passwordHash && ru.passwordHash.hash === hashPassword(password, ru.passwordHash.salt)) {
      const r = ['admin', 'user', 'readonly'].includes(ru.role) ? ru.role : 'admin';
      return { username: ru.username, role: r };
    }
    // 单口令兼容模式：登录者视为管理员
    if (users.length === 0 && config.authToken && password === config.authToken) {
      return { username: username || 'admin', role: 'admin' };
    }
    return null;
  }

  return http.createServer(async (req, res) => {
    try {
      // ---- IP 白名单（服务器级，含静态资源与健康检查）----
      if (!ipAllowed(req, config)) {
        setSecurityHeaders(res);
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, status: 403, data: null, error: 'IP 不在白名单内' }));
        return;
      }

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
          const token = issueSession(user.username, user.role);
          logOperation(user.username, '登录', '登录面板');
          sendJson(res, 200, { ok: true, token, title: config.title, authed: true, user: user.username, role: user.role });
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
        const info = getSessionInfo(token);
        const authed = !authEnabled || isSessionValid(token);
        sendJson(res, 200, { ok: true, authed, title: config.title, user: authed ? (info ? info.username : null) : null, role: authed ? (info ? info.role : null) : null });
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
        const operatorInfo = getSessionInfo(token) || { username: '', role: 'admin' };
        const operator = operatorInfo.username;
        const role = operatorInfo.role;
        const isGet = ['GET', 'HEAD', 'OPTIONS'].includes(method);

        // ---- v3 权限分级：readonly 禁止一切写操作 ----
        if (role === 'readonly' && !isGet) {
          sendJson(res, 403, { ok: false, error: '只读账号无权执行此操作' });
          return;
        }

        // ---- 普通用户（role=user）权限：全局管理接口一律禁止 ----
        if (role === 'user') {
          const deniedWrite = [
            '/api/v3/users', '/api/v3/schedules', '/api/v3/automation', '/api/v3/autostart-groups',
            '/api/v3/health/reset', '/api/v3/instances/import', '/api/v3/instance/clone',
            '/api/instance/create', '/api/instance/delete', '/api/operation-logs'
          ].includes(pathname) || pathname.startsWith('/api/template/');
          const deniedGet = [
            '/api/v3/users', '/api/v3/operation-logs', '/api/v3/instances/export',
            '/api/v3/schedules', '/api/v3/automation', '/api/v3/autostart-groups',
            '/api/operation-logs'
          ].includes(pathname);
          if ((!isGet && deniedWrite) || (isGet && deniedGet)) {
            sendJson(res, 403, { ok: false, error: '普通用户无权使用该功能' });
            return;
          }
        }

        // 操作日志查询
        if (method === 'GET' && pathname === '/api/operation-logs') {
          sendJson(res, 200, ok(operationLogs.slice().reverse()));
          return;
        }

        // ---- 正版玩家头像代理（GET /api/avatar/<游戏名>，返回皮肤 PNG 由前端裁脸）----
        if (method === 'GET' && pathname.startsWith('/api/avatar/')) {
          const name = decodeURIComponent(pathname.slice('/api/avatar/'.length)).trim();
          try {
            const png = await avatarService.getSkinPng(name);
            res.writeHead(200, {
              'Content-Type': 'image/png',
              'Cache-Control': 'public, max-age=86400',
              'X-Content-Type-Options': 'nosniff'
            });
            res.end(png);
          } catch (error) {
            sendJson(res, error.status || 502, { ok: false, error: error.message });
          }
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

        // ---- 普通用户（role=user）：实例级接口需校验实例授权 ----
        if (role === 'user') {
          const needsInstanceCheck = [
            '/api/instance', '/api/instance/outputlog', '/api/instance/action', '/api/instance/command',
            '/api/instance/config', '/api/instance/inventory', '/api/instance/username',
            '/api/files/list', '/api/files/read', '/api/files/write', '/api/files/touch',
            '/api/files/mkdir', '/api/files/delete', '/api/files/copy', '/api/files/move',
            '/api/v3/mcc/commands', '/api/v3/mcc/servers', '/api/v3/mcc/switch-server',
            '/api/v3/mcc/apply-mod', '/api/v3/mcc/settings', '/api/v3/mcc/scripts', '/api/v3/mcc/mod'
          ].includes(pathname);
          if (needsInstanceCheck) {
            const targetDaemonId = isGet
              ? url.searchParams.get('daemonId')
              : (body && body.daemonId);
            const targetUuid = isGet
              ? url.searchParams.get('uuid')
              : (body && body.uuid);
            if (!targetDaemonId || !targetUuid) {
              sendJson(res, 403, { ok: false, error: '缺少实例参数' });
              return;
            }
            if (!userCanAccessInstance(operator, targetDaemonId, targetUuid)) {
              sendJson(res, 403, { ok: false, error: '无权操作该实例（未授权）' });
              return;
            }
          }
        }

        // ---- v3 增强路由（/api/v3/*）----
        const v3Result = await handleV3Route({
          method,
          pathname,
          query: Object.fromEntries(url.searchParams.entries()),
          body,
          mcsm,
          config,
          engine,
          health,
          operator,
          role: operatorInfo.role,
          logOperation,
          operationLogs,
          createMcsmInstance,
          panelConfig: config
        });
        if (v3Result !== null) {
          sendJson(res, v3Result.ok ? 200 : (v3Result.status || 502), v3Result);
          return;
        }

        const result = await proxyRoute(mcsm, {
          pathname,
          query: Object.fromEntries(url.searchParams.entries()),
          method,
          body,
          operator,
          role
        }, config);
        // 普通用户：实例列表只返回被授权的实例
        if (result && result.ok && role === 'user' && pathname === '/api/instances') {
          const rawList = (result.data && result.data.data) || [];
          const listDaemonId = url.searchParams.get('daemonId');
          result.data.data = rawList.filter((inst) => inst && userCanAccessInstance(operator, listDaemonId, inst.instanceUuid));
        }
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
