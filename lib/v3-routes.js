'use strict';

/**
 * lib/v3-routes.js — v3 增强 API 路由（全部挂载于 /api/v3/*）。
 *
 * 设计原则：
 *   - 现有 v2 API 路径与前端交互完全不变，v3 全部使用新路径
 *   - apikey 只存在于后端（经 mcsm 客户端转发），本层不接触密钥
 *   - 数据持久化走 lib/store.js（data/*.json）
 *   - 写操作权限（admin）由 server.js 统一拦截，本层只负责业务
 *
 * handleV3Route(ctx) 返回统一响应 { ok, status, data, error }；
 * 未匹配的路由返回 null（由 server.js 继续走 v2 代理 / 404）。
 */

const mccMod = require('./mcc-mod');
const store = require('./store');
const crypto = require('crypto');

// 注册用户存储（data/users.json），密码 sha256(password + ':' + salt) 哈希
const REG_USERS_STORE = 'users.json';

function registeredUsersList() {
  const saved = store.load(REG_USERS_STORE, { users: [] });
  return (saved && Array.isArray(saved.users)) ? saved.users : [];
}

function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(String(password) + ':' + salt).digest('hex');
}

/** 最早的 admin = 配置 users 数组第一个用户；单口令模式（无 users）下登录者即 owner。 */
function isOwnerUsername(config, username) {
  const users = Array.isArray(config.users) ? config.users : [];
  if (users.length === 0) return true;
  const first = users[0];
  return !!first && first.username === username;
}

/** 普通用户（role=user）的授权实例集合；返回 null 表示不过滤（admin/readonly 语义）。 */
function userAccessSet(operator, role) {
  if (role !== 'user') return null;
  const u = registeredUsersList().find((x) => x && x.username === operator);
  if (!u) return new Set();
  if (u.instances == null) return null;
  const set = new Set();
  for (const i of (Array.isArray(u.instances) ? u.instances : [])) {
    if (i && i.daemonId && i.uuid) set.add(String(i.daemonId) + '::' + String(i.uuid));
  }
  return set;
}

function ok(data) {
  return { ok: true, status: 200, data, error: null };
}

function fail(error, status = 400) {
  return { ok: false, status, data: null, error };
}

function keyOf(daemonId, uuid) {
  return String(daemonId) + '::' + String(uuid);
}

/** 从 ini 文本解析 Server（Host/Port）。 */
function parseServerFromIni(ini) {
  if (typeof ini !== 'string') return { serverIp: '', serverPort: null };
  const m = /Server\s*=\s*\{([^}]*)\}/.exec(ini);
  if (!m) return { serverIp: '', serverPort: null };
  const host = /Host\s*=\s*"([^"]*)"/.exec(m[1]);
  const port = /Port\s*=\s*(\d+)/.exec(m[1]);
  return {
    serverIp: host ? host[1] : '',
    serverPort: port ? Number(port[1]) : null
  };
}

/** 从 ini 文本解析 Account（Login/Password，Password 为 "-" 视为离线账号）。 */
function parseAccountFromIni(ini) {
  if (typeof ini !== 'string') return { accountType: '', accountLogin: '' };
  const m = /Account\s*=\s*\{([^}]*)\}/.exec(ini);
  if (!m) return { accountType: '', accountLogin: '' };
  const login = /Login\s*=\s*"([^"]*)"/.exec(m[1]);
  const pw = /Password\s*=\s*"([^"]*)"/.exec(m[1]);
  return {
    accountType: pw && pw[1] === '-' ? 'offline' : 'microsoft',
    accountLogin: login ? login[1] : ''
  };
}

/** CSV 字段转义（逗号/引号/换行）。 */
function csvField(v) {
  const s = String(v == null ? '' : v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/**
 * v3 路由入口。
 * @param {object} ctx
 * @param {string} ctx.method
 * @param {string} ctx.pathname
 * @param {object} ctx.query
 * @param {object} ctx.body
 * @param {object} ctx.mcsm McsmClient
 * @param {object} ctx.config 面板配置
 * @param {object} ctx.engine AutomationEngine
 * @param {object} ctx.health HealthTracker
 * @param {string} ctx.operator 操作者用户名
 * @param {string} ctx.role 角色 admin/readonly
 * @param {Function} ctx.logOperation
 * @param {Array} ctx.operationLogs 内存操作日志（含持久化历史）
 * @param {Function} ctx.createMcsmInstance v2 创建实例函数（server.js 注入）
 * @param {object} ctx.panelConfig
 */
async function handleV3Route(ctx) {
  const {
    method, pathname, query, body,
    mcsm, config, engine, health,
    operator, role, logOperation, operationLogs,
    createMcsmInstance, panelConfig
  } = ctx;

  // ---- 文件读写辅助（走 MCSM 文件接口，target 相对实例目录）----
  async function readFile(daemonId, uuid, target) {
    const r = await mcsm.request('PUT', '/api/files/', { daemonId, uuid }, { target });
    return r.status === 200 && typeof r.data === 'string' ? r.data : null;
  }
  async function writeFile(daemonId, uuid, target, text) {
    let r = await mcsm.request('PUT', '/api/files/', { daemonId, uuid }, { target, text });
    if (r.status !== 200) {
      // 文件可能不存在，先 touch 再写
      await mcsm.request('POST', '/api/files/touch', { daemonId, uuid }, { target });
      r = await mcsm.request('PUT', '/api/files/', { daemonId, uuid }, { target, text });
    }
    return r.status === 200;
  }
  async function listDir(daemonId, uuid, target) {
    const r = await mcsm.request('GET', '/api/files/list', {
      daemonId, uuid, target: target || '/', page: 0, page_size: 100, file_name: ''
    });
    return (r.status === 200 && r.data && Array.isArray(r.data.items)) ? r.data.items : [];
  }

  const route = `${method} ${pathname}`;

  // =========================================================================
  // 基础信息
  // =========================================================================
  if (route === 'GET /api/v3/me') {
    return ok({ user: operator, role, isOwner: isOwnerUsername(config, operator) });
  }

  if (route === 'GET /api/v3/overview') {
    const allList = health.getList();
    const access = userAccessSet(operator, role);
    // 普通用户：统计只算被授权的实例
    const list = access ? allList.filter((i) => access.has(i.key)) : allList;
    const stats = health.getStats();
    const schedules = engine.listSchedules();
    return ok({
      instances: {
        total: list.length,
        running: list.filter((i) => i.status === '3').length
      },
      stats,
      schedules: { total: schedules.length, enabled: schedules.filter((s) => s.enabled).length },
      automation: {
        autoreconnect: engine.getAutomation().autoreconnect.enabled,
        afk: engine.getAutomation().afk.enabled
      },
      groups: engine.listGroups().length
    });
  }

  // =========================================================================
  // 用户注册（仅最早的 admin 用户可注册其他用户）
  // =========================================================================
  if (route === 'GET /api/v3/users') {
    const regUsers = registeredUsersList();
    const roleOf = (r) => (['admin', 'user', 'readonly'].includes(r) ? r : 'admin');
    return ok({
      owner: isOwnerUsername(config, operator),
      users: [
        ...(Array.isArray(config.users) ? config.users : []).map((u) => ({
          username: u.username,
          role: u.role === 'readonly' ? 'readonly' : 'admin',
          source: 'config'
        })),
        ...regUsers.map((u) => ({
          username: u.username,
          role: roleOf(u.role),
          source: 'registered',
          createdAt: u.createdAt,
          instances: u.role === 'user' ? (u.instances || []) : undefined
        }))
      ]
    });
  }

  if (route === 'POST /api/v3/users') {
    // 仅最早的 admin（config.users[0]）可注册；readonly/user 写操作已被 server.js 统一拦截
    if (!isOwnerUsername(config, operator)) {
      return fail('仅最早的 admin 用户可以注册其他用户', 403);
    }
    const username = String((body && body.username) || '').trim();
    const password = String((body && body.password) || '');
    const role = ['admin', 'user', 'readonly'].includes(body && body.role) ? body.role : 'user';
    if (!/^[A-Za-z0-9_-]{2,32}$/.test(username)) {
      return fail('用户名需为 2-32 位字母/数字/下划线/短横线', 400);
    }
    if (password.length < 6) return fail('密码至少 6 位', 400);
    const allNames = [
      ...(Array.isArray(config.users) ? config.users : []).map((u) => u.username),
      ...registeredUsersList().map((u) => u.username)
    ];
    if (allNames.includes(username)) return fail('用户名已存在', 400);
    const regList = registeredUsersList();
    if (regList.length >= 100) return fail('注册用户数量已达上限', 400);
    const salt = crypto.randomBytes(16).toString('hex');
    const entry = {
      username,
      passwordHash: { salt, hash: hashPassword(password, salt) },
      role,
      instances: role === 'user' ? [] : null, // user 角色默认未授权实例，由管理员配置
      createdAt: Date.now(),
      createdBy: operator
    };
    regList.push(entry);
    store.save(REG_USERS_STORE, { users: regList });
    logOperation(operator, '注册用户', `${username}（${role}）`);
    return ok({ username, role });
  }

  if (route === 'PUT /api/v3/users') {
    // 管理员可修改注册用户的角色与授权实例（config 用户不可改，需改配置文件）
    if (role !== 'admin') return fail('仅管理员可配置用户', 403);
    const username = String((body && body.username) || '').trim();
    if (!username) return fail('username 缺失', 400);
    const regList = registeredUsersList();
    const entry = regList.find((u) => u.username === username);
    if (!entry) return fail('用户不存在（配置文件中的初始用户不可在此修改，请编辑 panel.config.json）', 404);
    if (body.role !== undefined) {
      if (!['admin', 'user', 'readonly'].includes(body.role)) return fail('非法角色', 400);
      entry.role = body.role;
      if (entry.role !== 'user') entry.instances = null;
    }
    if (body.instances !== undefined && entry.role === 'user') {
      // instances: [{ daemonId, uuid }]；仅保留合法字段
      const list = Array.isArray(body.instances) ? body.instances : [];
      entry.instances = list.map((i) => ({ daemonId: String(i.daemonId || ''), uuid: String(i.uuid || '') }))
        .filter((i) => i.daemonId && i.uuid);
    }
    store.save(REG_USERS_STORE, { users: regList });
    logOperation(operator, '配置用户', `${username}：角色 ${entry.role}，授权实例 ${(entry.instances || []).length} 个`);
    return ok({ username, role: entry.role, instances: entry.role === 'user' ? entry.instances : null });
  }

  if (route === 'DELETE /api/v3/users') {
    // 管理员可删除注册用户（初始用户在 panel.config.json 中定义，不可删除）
    if (role !== 'admin') return fail('仅管理员可删除用户', 403);
    const username = String(query.id || '').trim();
    if (!username) return fail('id 缺失', 400);
    const regList = registeredUsersList();
    const before = regList.length;
    const next = regList.filter((u) => u.username !== username);
    if (next.length === before) {
      return fail('用户不存在（配置文件中的初始用户不可删除，请编辑 panel.config.json）', 404);
    }
    store.save(REG_USERS_STORE, { users: next });
    logOperation(operator, '删除用户', username);
    return ok(true);
  }

  // =========================================================================
  // 健康监控 / 消息统计
  // =========================================================================
  if (route === 'GET /api/v3/health') {
    const allList = health.getList();
    const access = userAccessSet(operator, role);
    // 普通用户：只显示被授权的实例
    return ok(access ? allList.filter((i) => access.has(i.key)) : allList);
  }

  if (route === 'POST /api/v3/health/reset') {
    health.reset();
    logOperation(operator, '重置健康统计', '清空全部健康监控数据');
    return ok(true);
  }

  if (route === 'POST /api/v3/health/prune') {
    // 清理已删除实例的历史健康统计：只移除 MCSM 实时列表中已不存在的条目。
    // 节点实例列表查询失败时保守保留该节点全部条目，防止误删。
    if (role !== 'admin') return fail('仅管理员可清理健康统计', 403);
    let dl;
    try {
      dl = await mcsm.request('GET', '/api/service/remote_services_list');
    } catch (e) {
      return fail('无法连接 MCSM，未做任何清理', 502);
    }
    if (dl.status !== 200 || !Array.isArray(dl.data)) {
      return fail('无法获取 MCSM 节点列表，未做任何清理', 502);
    }
    const live = new Set();
    const keepDaemons = [];
    for (const d of dl.data) {
      if (!d || !d.uuid) continue;
      let page = 1;
      let maxPage = 1;
      let queryFailed = false;
      try {
        // 逐页收集实例（MCSM 单页上限约 50），避免大节点误删
        do {
          const r = await mcsm.request('GET', '/api/service/remote_service_instances', {
            daemonId: d.uuid, page, page_size: 100
          });
          if (r.status !== 200) {
            queryFailed = true;
            break;
          }
          maxPage = Number((r.data && r.data.maxPage) || 1) || 1;
          const arr = (r.data && r.data.data) || [];
          for (const inst of (Array.isArray(arr) ? arr : [])) {
            if (inst && inst.instanceUuid) live.add(keyOf(d.uuid, inst.instanceUuid));
          }
          page += 1;
        } while (page <= maxPage);
      } catch (e) {
        queryFailed = true;
      }
      if (queryFailed) keepDaemons.push(String(d.uuid));
    }
    const removed = health.pruneStale(live, keepDaemons);
    logOperation(operator, '清理健康统计',
      removed.length ? `清理已删除实例残留 ${removed.length} 条: ${removed.join('; ')}` : '无残留条目');
    return ok({ removed: removed.length, keys: removed, keptDaemons: keepDaemons });
  }

  if (route === 'GET /api/v3/stats') {
    return ok(health.getStats());
  }

  // =========================================================================
  // 定时任务（cron）
  // =========================================================================
  if (route === 'GET /api/v3/schedules') {
    return ok(engine.listSchedules());
  }
  if (route === 'POST /api/v3/schedules') {
    try {
      const s = engine.createSchedule(body || {});
      logOperation(operator, '新建定时任务', `${s.name} [${s.cron}]`);
      return ok(s);
    } catch (e) {
      return fail(e.message, 400);
    }
  }
  if (route === 'PUT /api/v3/schedules') {
    try {
      const s = engine.updateSchedule(String(body.id || ''), body || {});
      logOperation(operator, '修改定时任务', `${s.name}`);
      return ok(s);
    } catch (e) {
      return fail(e.message, e.message.includes('不存在') ? 404 : 400);
    }
  }
  if (route === 'DELETE /api/v3/schedules') {
    try {
      const s = engine.listSchedules().find((x) => x.id === query.id);
      engine.deleteSchedule(String(query.id || ''));
      logOperation(operator, '删除定时任务', s ? s.name : String(query.id || ''));
      return ok(true);
    } catch (e) {
      return fail(e.message, 404);
    }
  }

  // =========================================================================
  // 自动化配置（掉线检测 / 防 AFK）
  // =========================================================================
  if (route === 'GET /api/v3/automation') {
    return ok(engine.getAutomation());
  }
  if (route === 'PUT /api/v3/automation') {
    const updated = engine.updateAutomation(body || {});
    logOperation(operator, '更新自动化配置', JSON.stringify(body || {}).slice(0, 120));
    return ok(updated);
  }

  // =========================================================================
  // 开机自启组
  // =========================================================================
  if (route === 'GET /api/v3/autostart-groups') {
    return ok(await engine.refreshGroupStatus());
  }
  if (route === 'POST /api/v3/autostart-groups') {
    try {
      const g = engine.createGroup(body || {});
      logOperation(operator, '新建自启组', g.name);
      return ok(g);
    } catch (e) {
      return fail(e.message, 400);
    }
  }
  if (route === 'PUT /api/v3/autostart-groups') {
    try {
      const g = engine.updateGroup(String(body.id || ''), body || {});
      logOperation(operator, '修改自启组', g.name);
      return ok(g);
    } catch (e) {
      return fail(e.message, e.message.includes('不存在') ? 404 : 400);
    }
  }
  if (route === 'DELETE /api/v3/autostart-groups') {
    try {
      engine.deleteGroup(String(query.id || ''));
      logOperation(operator, '删除自启组', String(query.id || ''));
      return ok(true);
    } catch (e) {
      return fail(e.message, 404);
    }
  }
  if (route === 'POST /api/v3/autostart-groups/trigger') {
    const result = await engine.runGroup(String(body.id || ''));
    return result.ok ? ok(result) : fail(result.error, 404);
  }

  // =========================================================================
  // 操作日志筛选 / 导出
  // =========================================================================
  function filterLogs(list, q) {
    const user = String(q.user || '').trim();
    const action = String(q.action || '').trim();
    const from = Number(q.from) || 0;
    const to = Number(q.to) || 0;
    return list.filter((l) => {
      if (user && !String(l.user || '').includes(user)) return false;
      if (action && !String(l.action || '').includes(action)) return false;
      if (from && l.time < from) return false;
      if (to && l.time > to) return false;
      return true;
    });
  }

  if (route === 'GET /api/v3/operation-logs') {
    const limit = Math.min(Number(query.limit) || 200, 2000);
    const filtered = filterLogs(operationLogs, query).slice(0, limit);
    return ok({ total: filtered.length, logs: filtered });
  }

  if (route === 'GET /api/v3/operation-logs/export') {
    const fmt = String(query.format || 'json') === 'csv' ? 'csv' : 'json';
    const filtered = filterLogs(operationLogs, query);
    if (fmt === 'csv') {
      const header = ['时间', '用户', '操作', '详情'];
      const lines = [header.join(',')];
      for (const l of filtered) {
        lines.push([
          csvField(new Date(l.time).toLocaleString('zh-CN', { hour12: false })),
          csvField(l.user),
          csvField(l.action),
          csvField(l.detail)
        ].join(','));
      }
      return ok({ filename: `operation-logs-${Date.now()}.csv`, content: lines.join('\n'), mime: 'text/csv; charset=utf-8' });
    }
    return ok({
      filename: `operation-logs-${Date.now()}.json`,
      content: JSON.stringify(filtered, null, 2),
      mime: 'application/json; charset=utf-8'
    });
  }

  // =========================================================================
  // 实例配置批量导入导出 / 克隆
  // =========================================================================
  if (route === 'GET /api/v3/instances/export') {
    try {
      const includeIni = String(query.includeIni) === 'true';
      // 可选过滤：uuids=daemonId::uuid,daemonId::uuid（逗号分隔）；不传则导出全部（兼容原行为）
      const onlyUuids = String(query.uuids || '').split(',').map((s) => s.trim()).filter(Boolean);
      const onlySet = onlyUuids.length > 0 ? new Set(onlyUuids) : null;
      const dlR = await mcsm.request('GET', '/api/service/remote_services_list');
      const nodes = (dlR.status === 200 && Array.isArray(dlR.data)) ? dlR.data : [];
      const instances = [];
      for (const node of nodes) {
        // 逐页收集实例（MCSM 单页上限约 50）
        let page = 1;
        let maxPage = 1;
        do {
          const r = await mcsm.request('GET', '/api/service/remote_service_instances', {
            daemonId: node.uuid, page, page_size: 100
          });
          if (r.status !== 200) break;
          maxPage = Number((r.data && r.data.maxPage) || 1) || 1;
          const list = (r.data && Array.isArray(r.data.data)) ? r.data.data : [];
          for (const inst of list) {
            const key = keyOf(node.uuid, inst.instanceUuid);
            if (onlySet && !onlySet.has(key)) continue; // 选择性导出
            const item = {
              daemonId: node.uuid,
              daemonName: node.remarks || node.name || '',
              uuid: inst.instanceUuid,
              // 实例名在 config.nickname（MCSM 列表接口无顶层 name 字段）
              name: (inst.config && inst.config.nickname) || inst.name || '',
              status: String(inst.status == null ? '' : inst.status)
            };
            const detailR = await mcsm.request('GET', '/api/instance', { daemonId: node.uuid, uuid: inst.instanceUuid });
            if (detailR.status === 200 && detailR.data && typeof detailR.data === 'object') {
              const cfg = detailR.data.config || {};
              item.cwd = cfg.cwd || '';
              item.startCommand = cfg.startCommand || '';
              item.eventTask = cfg.eventTask || null;
            }
            if (includeIni) {
              const ini = await readFile(node.uuid, inst.instanceUuid, 'MinecraftClient.ini');
              if (ini !== null) {
                const srv = parseServerFromIni(ini);
                const acc = parseAccountFromIni(ini);
                item.serverIp = srv.serverIp;
                item.serverPort = srv.serverPort;
                item.accountType = acc.accountType;
                item.accountLogin = acc.accountLogin;
                item.ini = ini;
              }
            }
            instances.push(item);
          }
          page += 1;
        } while (page <= maxPage);
      }
      logOperation(operator, '导出实例配置', `${instances.length} 个实例`);
      return ok({ version: 1, exportedAt: Date.now(), instances });
    } catch (e) {
      return fail('导出失败: ' + e.message, 502);
    }
  }

  if (route === 'POST /api/v3/instances/import') {
    const arr = (body && Array.isArray(body.instances)) ? body.instances : [];
    if (arr.length === 0) return fail('instances 不能为空', 400);
    const defaultDaemonId = String(body.defaultDaemonId || '');
    const created = [];
    const failed = [];
    for (const item of arr) {
      try {
        const payload = {
          daemonId: String(item.daemonId || defaultDaemonId || ''),
          name: item.name,
          serverIp: item.serverIp,
          serverPort: item.serverPort,
          accountType: item.accountType === 'offline' ? 'offline' : 'microsoft',
          accountLogin: item.accountLogin,
          autoAcceptTpa: item.autoAcceptTpa !== false
        };
        const r = await createMcsmInstance(mcsm, payload, panelConfig);
        if (r.ok) created.push({ name: item.name, uuid: r.data.instanceUuid });
        else failed.push({ name: item.name, error: r.error });
      } catch (e) {
        failed.push({ name: item.name, error: e.message });
      }
    }
    logOperation(operator, '导入实例配置', `成功 ${created.length}，失败 ${failed.length}`);
    return ok({ created, failed });
  }

  if (route === 'POST /api/v3/instance/clone') {
    const { daemonId, uuid, newName } = body || {};
    if (!daemonId || !uuid) return fail('daemonId / uuid 缺失', 400);
    if (!newName) return fail('newName 不能为空', 400);
    try {
      const detailR = await mcsm.request('GET', '/api/instance', { daemonId, uuid });
      if (detailR.status !== 200 || !detailR.data) return fail('读取源实例失败', 502);
      const src = detailR.data;
      const safeName = String(newName).trim().replace(/[\/\\\s:;'"`$&^|?*<>]+/g, '_').slice(0, 64) || 'clone';
      const srcConfig = src.config || {};
      const newCwd = `/mcc/${safeName}/`;
      const newConfig = {
        nickname: safeName,
        startCommand: String(srcConfig.startCommand || '').replace(/\/mcc\/[^/]+\//, newCwd),
        stopCommand: srcConfig.stopCommand || '^c',
        cwd: newCwd,
        type: srcConfig.type || 'universal',
        processType: srcConfig.processType || 'general',
        terminalOption: srcConfig.terminalOption || { haveColor: true, pty: false },
        eventTask: srcConfig.eventTask || { autoStart: false, autoRestart: false, autoRestartMaxTimes: 3, ignore: false }
      };
      const createR = await mcsm.request('POST', '/api/instance', { daemonId }, newConfig);
      if (createR.status !== 200) return fail('创建克隆实例失败: ' + (createR.error || createR.status), createR.status || 500);
      const newUuid = createR.data && (createR.data.instanceUuid || (createR.data.instances && createR.data.instances[0] && createR.data.instances[0].instanceUuid));
      if (!newUuid) return fail('创建克隆实例失败：未返回 uuid', 500);

      // 复制文件：源目录全部文件 -> 新目录
      const srcCwd = String(srcConfig.cwd || '').replace(/\/+$/, '') || '/mcc';
      const entries = await listDir(daemonId, 'global0001', srcCwd);
      let copied = 0;
      let copyFailed = 0;
      for (const it of entries) {
        const pair = [srcCwd + '/' + it.name, newCwd.replace(/\/+$/, '') + '/' + it.name];
        const copyR = await mcsm.request('POST', '/api/files/copy', { daemonId, uuid: 'global0001' }, { targets: [pair] });
        if (copyR.status === 200) copied += 1;
        else copyFailed += 1;
      }
      logOperation(operator, '克隆实例', `${uuid} -> ${safeName}（复制 ${copied} 个文件${copyFailed ? '，失败 ' + copyFailed : ''}）`);
      return ok({ instanceUuid: newUuid, nickname: safeName, copied, copyFailed });
    } catch (e) {
      return fail('克隆失败: ' + e.message, 502);
    }
  }

  // =========================================================================
  // MCC 魔改：自定义聊天指令（matches.ini）
  // =========================================================================
  if (route === 'GET /api/v3/mcc/commands') {
    const { daemonId, uuid } = query;
    if (!daemonId || !uuid) return fail('daemonId / uuid 缺失', 400);
    const text = await readFile(daemonId, uuid, 'matches.ini');
    if (text === null) {
      return ok({ commands: mccMod.defaultCommands(), hasFile: false });
    }
    return ok({ commands: mccMod.parseMatchesIni(text), hasFile: true });
  }

  if (route === 'PUT /api/v3/mcc/commands') {
    const { daemonId, uuid, commands } = body || {};
    if (!daemonId || !uuid) return fail('daemonId / uuid 缺失', 400);
    if (!Array.isArray(commands)) return fail('commands 必须为数组', 400);
    const text = mccMod.buildMatchesIni(commands);
    const wrote = await writeFile(daemonId, uuid, 'matches.ini', text);
    if (!wrote) return fail('写入 matches.ini 失败', 502);
    logOperation(operator, '保存聊天指令', `${commands.length} 条规则 (${keyOf(daemonId, uuid)})`);
    return ok({ count: commands.length });
  }

  // =========================================================================
  // MCC 魔改：多服务器切换（servers.txt）
  // =========================================================================
  if (route === 'GET /api/v3/mcc/servers') {
    const { daemonId, uuid } = query;
    if (!daemonId || !uuid) return fail('daemonId / uuid 缺失', 400);
    const text = await readFile(daemonId, uuid, 'servers.txt');
    return ok({ servers: text === null ? [] : mccMod.parseServersTxt(text), hasFile: text !== null });
  }

  if (route === 'PUT /api/v3/mcc/servers') {
    const { daemonId, uuid, servers } = body || {};
    if (!daemonId || !uuid) return fail('daemonId / uuid 缺失', 400);
    if (!Array.isArray(servers)) return fail('servers 必须为数组', 400);
    const text = mccMod.buildServersTxt(servers);
    const wrote = await writeFile(daemonId, uuid, 'servers.txt', text);
    if (!wrote) return fail('写入 servers.txt 失败', 502);
    logOperation(operator, '保存服务器列表', `${servers.length} 个服务器 (${keyOf(daemonId, uuid)})`);
    return ok({ count: servers.length });
  }

  if (route === 'POST /api/v3/mcc/switch-server') {
    const { daemonId, uuid, alias, host, port } = body || {};
    if (!daemonId || !uuid) return fail('daemonId / uuid 缺失', 400);
    if (!alias && !host) return fail('alias 或 host 至少提供一个', 400);
    try {
      // 1. 更新 servers.txt（合并目标项）
      const current = mccMod.parseServersTxt(await readFile(daemonId, uuid, 'servers.txt') || '');
      const targetAlias = alias || String(host).split(':')[0];
      const others = current.filter((s) => s.alias !== targetAlias);
      others.push({ alias: targetAlias, host, port: Number(port) > 0 ? Number(port) : undefined });
      await writeFile(daemonId, uuid, 'servers.txt', mccMod.buildServersTxt(others));

      // 2. 更新 MinecraftClient.ini 的 Server 行（重启后仍连目标）
      const ini = await readFile(daemonId, uuid, 'MinecraftClient.ini');
      if (ini !== null) {
        const srv = parseServerFromIni(ini);
        const newHost = host || srv.serverIp;
        const newPort = Number(port) > 0 ? Number(port) : (srv.serverPort || undefined);
        const newIni = mccMod.replaceServerLine(ini, newHost, newPort);
        await writeFile(daemonId, uuid, 'MinecraftClient.ini', newIni);
      }

      // 3. 若实例运行中，发送 MCC 内部命令 connect 立即切换
      const statusR = await mcsm.request('GET', '/api/instance', { daemonId, uuid });
      const status = String(statusR.data && statusR.data.status == null ? '' : (statusR.data && statusR.data.status));
      let viaConnect = false;
      if (status === '3') {
        const cmd = `connect ${targetAlias}`;
        const cR = await mcsm.request('POST', '/api/protected_instance/command', { daemonId, uuid, command: cmd });
        viaConnect = cR.status === 200;
      }
      logOperation(operator, '切换服务器', `${keyOf(daemonId, uuid)} -> ${targetAlias}${viaConnect ? '（运行中，已发送 connect）' : '（未运行，已改配置）'}`);
      return ok({ switched: true, alias: targetAlias, viaConnect });
    } catch (e) {
      return fail('切换失败: ' + e.message, 502);
    }
  }

  // =========================================================================
  // MCC 魔改：一键注入（AntiAFK / AutoRelog / ScriptScheduler）
  // =========================================================================
  if (route === 'GET /api/v3/mcc/mod') {
    const { daemonId, uuid } = query;
    if (!daemonId || !uuid) return fail('daemonId / uuid 缺失', 400);
    const ini = await readFile(daemonId, uuid, 'MinecraftClient.ini');
    if (ini === null) return fail('读取 MinecraftClient.ini 失败（实例未初始化）', 404);
    const parseSection = (name, keys) => {
      const lines = mccMod.getSection(ini, name) || [];
      const out = {};
      for (const key of keys) {
        const mm = new RegExp('^' + key + '\\s*=\\s*(.+)$', 'im').exec(lines.join('\n'));
        out[key] = mm ? mm[1].trim() : undefined;
      }
      return out;
    };
    // 新版 MCC 段名为 ChatBot.AntiAFK / ChatBot.AutoRelog
    const antiAfk = parseSection('ChatBot.AntiAFK', ['Enabled', 'Delay', 'Command']);
    const autoRelog = parseSection('ChatBot.AutoRelog', ['Enabled', 'Delay', 'Retries', 'Ignore_Kick_Message', 'Kick_Messages']);
    return ok({ hasIni: true, antiAfk, autoRelog });
  }

  if (route === 'POST /api/v3/mcc/apply-mod') {
    const { daemonId, uuid, antiAfk, autoRelog, scriptScheduler } = body || {};
    if (!daemonId || !uuid) return fail('daemonId / uuid 缺失', 400);
    const ini = await readFile(daemonId, uuid, 'MinecraftClient.ini');
    if (ini === null) return fail('读取 MinecraftClient.ini 失败（实例未初始化）', 404);
    const plan = mccMod.planModApply(ini, { antiAfk, autoRelog, scriptScheduler });
    const wroteIni = await writeFile(daemonId, uuid, 'MinecraftClient.ini', plan.ini);
    if (!wroteIni) return fail('写回 MinecraftClient.ini 失败', 502);
    const wroteFiles = [];
    for (const f of plan.files) {
      if (await writeFile(daemonId, uuid, f.target, f.text)) wroteFiles.push(f.target);
    }
    logOperation(operator, '应用 MCC 魔改', `${keyOf(daemonId, uuid)}: ${Object.keys({ antiAfk, autoRelog, scriptScheduler }).filter((k) => body[k]).join(', ')}（需重启实例生效）`);
    return ok({ iniWritten: true, files: wroteFiles });
  }

  // =========================================================================
  // MCC 魔改：手机设置页可视化配置（MinecraftClient.ini）
  // =========================================================================
  if (route === 'GET /api/v3/mcc/settings') {
    const { daemonId, uuid } = query;
    if (!daemonId || !uuid) return fail('daemonId / uuid 缺失', 400);
    const ini = await readFile(daemonId, uuid, 'MinecraftClient.ini');
    if (ini === null) return fail('读取 MinecraftClient.ini 失败（实例未初始化）', 404);
    return ok(mccMod.parseSettings(ini));
  }

  if (route === 'PUT /api/v3/mcc/settings') {
    const { daemonId, uuid, values } = body || {};
    if (!daemonId || !uuid) return fail('daemonId / uuid 缺失', 400);
    if (!values || typeof values !== 'object') return fail('values 必须为对象', 400);
    const ini = await readFile(daemonId, uuid, 'MinecraftClient.ini');
    if (ini === null) return fail('读取 MinecraftClient.ini 失败（实例未初始化）', 404);
    const newIni = mccMod.applySettings(ini, values);
    const wrote = await writeFile(daemonId, uuid, 'MinecraftClient.ini', newIni);
    if (!wrote) return fail('写回 MinecraftClient.ini 失败', 502);
    logOperation(operator, '可视化配置', `${keyOf(daemonId, uuid)}: ${Object.keys(values).map((k) => k + '=' + String(values[k])).join(', ')}（多数需重启实例生效）`);
    return ok({ count: Object.keys(values).length });
  }

  // =========================================================================
  // MCC 魔改：脚本模板与挂机脚本
  // =========================================================================
  if (route === 'GET /api/v3/mcc/templates') {
    return ok({
      idle: { name: '挂机脚本模板', filename: 'idle.txt', content: mccMod.buildIdleScriptTemplate({ name: 'idle' }) },
      tasks: { name: 'ScriptScheduler 任务模板', filename: 'tasks.txt', content: mccMod.buildTasksTxtTemplate() }
    });
  }

  if (route === 'POST /api/v3/mcc/scripts') {
    const { daemonId, uuid, name, content } = body || {};
    if (!daemonId || !uuid) return fail('daemonId / uuid 缺失', 400);
    const safeName = String(name || '').replace(/[\/\\\s:;'"`$&^|?*<>]+/g, '_').slice(0, 64);
    if (!safeName) return fail('脚本名不能为空', 400);
    const wrote = await writeFile(daemonId, uuid, safeName, String(content || ''));
    if (!wrote) return fail('写入脚本失败', 502);
    logOperation(operator, '保存脚本', `${safeName} (${keyOf(daemonId, uuid)})`);
    return ok({ name: safeName });
  }

  return null; // 未匹配，交由 server.js 处理
}

module.exports = { handleV3Route };
