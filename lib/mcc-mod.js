'use strict';

/**
 * lib/mcc-mod.js — MCC 客户端「魔改」配置生成与解析（零第三方依赖）。
 *
 * 不修改 MCC C# 源码，全部通过 MCC 原生支持的配置文件/脚本实现：
 *   - 自定义聊天指令：AutoRespond（matches.ini），如聊天里出现 !home 自动发 /send /home
 *   - 多服务器切换：servers.txt（serverlist）+ MCC 内部命令 /connect
 *   - 自动化挂机逻辑：ScriptScheduler（tasks.txt）+ MCC 脚本（.txt）
 *   - 掉线自动重连：AutoRelog（kickmessages.txt / ignorekickmessage）
 *   - 防 AFK：[AntiAFK]（enabled/delay/command）
 *
 * 本模块只做「纯函数」的配置生成/解析；实际读写实例文件（MinecraftClient.ini、
 * matches.ini、servers.txt 等）由 v3 路由层通过 MCSM 文件接口完成。
 */

// ---------------------------------------------------------------------------
// INI 段操作（用于注入/替换唯一段，如 [AntiAFK]、[AutoRelog]）
// ---------------------------------------------------------------------------

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 读取 INI 中某段的内容（按行返回，不含段头；不存在返回 null）。 */
function getSection(ini, name) {
  if (typeof ini !== 'string') return null;
  const re = new RegExp('\\[' + escapeRegExp(name) + '\\]([^\\[]*)');
  const m = re.exec(ini);
  if (!m) return null;
  return m[1].split('\n').map((l) => l.trim()).filter(Boolean);
}

/**
 * 设置 INI 段：已存在则整段替换，不存在则追加到文件末尾。
 * @param {string} ini 原 INI 文本
 * @param {string} name 段名（不含方括号）
 * @param {string[]} lines 段内行（不含段头）
 * @returns {string} 新 INI 文本
 */
function setSection(ini, name, lines) {
  const text = typeof ini === 'string' ? ini : '';
  const header = '[' + name + ']';
  const idx = text.indexOf(header);
  const block = lines.join('\n');
  if (idx >= 0) {
    // 段结束 = 下一个 '[' 段头（支持 \n[ 与文件开头的 [）
    const after = text.indexOf('\n[', idx + header.length);
    const end = after >= 0 ? after + 1 : text.length;
    return text.slice(0, idx) + header + '\n' + block + '\n' + text.slice(end);
  }
  return text.replace(/\s*$/, '') + '\n\n' + header + '\n' + block + '\n';
}

/** 删除 INI 段。 */
function removeSection(ini, name) {
  const text = typeof ini === 'string' ? ini : '';
  const header = '[' + name + ']';
  const idx = text.indexOf(header);
  if (idx < 0) return text;
  const after = text.indexOf('\n[', idx + header.length);
  const end = after >= 0 ? after + 1 : text.length;
  return text.slice(0, idx) + text.slice(end);
}

/** 替换 INI 中的 Server 行（兼容 v2 的 replaceServerLine 语义）。 */
function replaceServerLine(ini, host, port) {
  const portPart = (port && Number(port) > 0) ? `, Port = ${Number(port)}` : '';
  const replacement = `Server = { Host = "${host}"${portPart} }`;
  const re = /Server\s*=\s*\{[^}]*\}/;
  if (re.test(ini)) return ini.replace(re, () => replacement);
  return ini.replace(/(\[Main[^\[]*)/, (m) => m + '\n' + replacement);
}

// ---------------------------------------------------------------------------
// 自定义聊天指令（matches.ini / AutoRespond）
// ---------------------------------------------------------------------------

/**
 * 由指令列表生成 matches.ini 文本。
 * @param {Array} commands [{ trigger, action, cooldown, enabled }]
 */
function buildMatchesIni(commands) {
  const lines = [
    '# 本文件由 MCC Panel v3 生成 —— 自定义聊天指令（AutoRespond 自动回复）',
    '# 每段 [Match] 为一条规则：match=触发文本，action=要执行的命令（send 表示发到游戏）',
    '# 如需正则匹配，可在本面板「高级」中直接编辑此文件',
    ''
  ];
  for (const c of commands || []) {
    if (!c || !String(c.trigger || '').trim()) continue;
    lines.push('[Match]');
    lines.push('match=' + String(c.trigger).trim());
    if (c.action) lines.push('action=' + String(c.action).trim());
    if (Number(c.cooldown) > 0) lines.push('cooldown=' + Number(c.cooldown));
    lines.push('enabled=' + (c.enabled === false ? 'false' : 'true'));
    lines.push('');
  }
  return lines.join('\n');
}

/** 解析现有 matches.ini 为指令列表。 */
function parseMatchesIni(text) {
  const commands = [];
  if (typeof text !== 'string') return commands;
  const re = /\[Match\]([^\[]*)/g;
  let m;
  while ((m = re.exec(text))) {
    const body = m[1];
    const get = (k) => {
      const mm = new RegExp('^' + k + '\\s*=\\s*(.+)$', 'm').exec(body);
      return mm ? mm[1].trim() : null;
    };
    const trigger = get('match');
    if (!trigger) continue;
    commands.push({
      trigger,
      action: get('action') || '',
      cooldown: Number(get('cooldown')) || 0,
      enabled: get('enabled') !== 'false'
    });
  }
  return commands;
}

/** 内置演示指令（新实例没有 matches.ini 时给出示例）。 */
function defaultCommands() {
  return [
    { trigger: '!home', action: 'send /home', cooldown: 5, enabled: true },
    { trigger: '!back', action: 'send /back', cooldown: 5, enabled: true },
    { trigger: '!tpaccept', action: 'send /tpaccept', cooldown: 5, enabled: true },
    { trigger: '!help', action: 'send /msg %username% 可用指令: !home !back !tpaccept', cooldown: 10, enabled: true }
  ];
}

// ---------------------------------------------------------------------------
// 多服务器切换（servers.txt + /connect）
// ---------------------------------------------------------------------------

/**
 * 由服务器列表生成 servers.txt。
 * MCC 格式：每行 `别名 服务器地址 [端口]`，# 开头为注释。
 * @param {Array} servers [{ alias, host, port }]
 */
function buildServersTxt(servers) {
  const lines = [
    '# 本文件由 MCC Panel v3 生成 —— 多服务器切换列表',
    '# 格式: 别名 服务器地址 [端口]，在面板中执行「切换服务器」或 MCC 内 /connect <别名>',
    ''
  ];
  for (const s of servers || []) {
    const alias = String(s.alias || '').trim();
    const host = String(s.host || '').trim();
    if (!alias || !host) continue;
    const port = Number(s.port) > 0 ? ' ' + Number(s.port) : '';
    lines.push(alias + ' ' + host + port);
  }
  return lines.join('\n') + '\n';
}

/** 解析 servers.txt 为服务器列表。 */
function parseServersTxt(text) {
  const servers = [];
  if (typeof text !== 'string') return servers;
  for (const line of text.split('\n')) {
    const l = line.trim();
    if (!l || l.startsWith('#')) continue;
    const parts = l.split(/\s+/);
    if (parts.length < 2) continue;
    let host = parts[1];
    let port = 0;
    if (parts.length >= 3) port = Number(parts[2]) || 0;
    else if (host.includes(':')) {
      const hp = host.split(':');
      host = hp[0];
      port = Number(hp[1]) || 0;
    }
    servers.push({ alias: parts[0], host, port: port || undefined });
  }
  return servers;
}

// ---------------------------------------------------------------------------
// 原生功能段注入（防 AFK / 掉线自动重连 / 脚本调度）
// ---------------------------------------------------------------------------

/** 生成 [AntiAFK] 段（delay 单位：10 tick ≈ 1 秒，MCC 官方注释）。 */
function buildAntiAfkSection({ enabled = true, delay = 600, command = '/ping' } = {}) {
  const lines = ['enabled = ' + (enabled ? 'true' : 'false')];
  if (delay !== undefined) lines.push('delay = ' + Number(delay));
  if (command) lines.push('command = ' + String(command));
  return lines;
}

/** 生成 [AutoRelog] 段。 */
function buildAutoRelogSection({ enabled = true, delay = 10, retries = 5, ignoreKickMessage = false } = {}) {
  return [
    'enabled = ' + (enabled ? 'true' : 'false'),
    'delay = ' + Number(delay),
    'retries = ' + Number(retries),
    'ignorekickmessage = ' + (ignoreKickMessage ? 'true' : 'false')
  ];
}

/** 生成 kickmessages.txt（AutoRelog 触发词）。 */
function buildKickMessagesTxt(messages) {
  const list = (messages && messages.length) ? messages : [
    'Connection has been lost',
    'Login failed',
    'Failed to ping this IP',
    'Restarting'
  ];
  return list.map((m) => String(m).trim()).filter(Boolean).join('\n') + '\n';
}

/** 生成 [ChatBot.ScriptScheduler] 段（MCC 新版本节名）。 */
function buildScriptSchedulerSection({ enabled = true, tasksFile = 'tasks.txt' } = {}) {
  return [
    'enabled = ' + (enabled ? 'true' : 'false'),
    'tasks_file = ' + String(tasksFile)
  ];
}

/** 生成 tasks.txt 模板（ScriptScheduler 任务文件，供用户自定义挂机逻辑）。 */
function buildTasksTxtTemplate() {
  return [
    '# MCC Panel v3 生成的 ScriptScheduler 任务模板',
    '# 每段一个任务；可用的 Trigger: On_First_Login / On_Interval / On_Time',
    '# 例：登录后 3 秒自动回家',
    '',
    '[Task]',
    'Task_Name = "login home"',
    'Trigger_On_First_Login = true',
    'Action = "wait 30; send /home"',
    '',
    '# 例：每 10-12 分钟随机发一条消息防呆（防 AFK 兜底）',
    '[Task]',
    'Task_Name = "afk message"',
    'Trigger_On_Interval = { Enable = true, MinTime = 600.0, MaxTime = 720.0 }',
    'Action = "send 挂机中，有事请留言"',
    ''
  ].join('\n');
}

/**
 * 生成 MCC 挂机脚本模板（.txt，每行一条内部命令）。
 * @param {object} opts { name, serverHint }
 */
function buildIdleScriptTemplate(opts) {
  const o = opts || {};
  return [
    '# 挂机脚本模板（由 MCC Panel v3 生成）',
    '# 每行一条 MCC 内部命令；# 开头为注释；wait 单位为 tick（10 tick ≈ 1 秒）',
    '# 通过 MCC 控制台执行: /script ' + (o.name || 'idle'),
    '',
    'log 开始执行挂机脚本',
    'wait 40',
    'send /home',
    'wait 60',
    'send 大家好，我是挂机机器人 ' + (o.serverHint ? '[' + o.serverHint + ']' : ''),
    'wait 600',
    '# 每小时播报一次（示例，可自行修改）',
    'log 挂机中',
    ''
  ].join('\n');
}

// ---------------------------------------------------------------------------
// 组合：一次性生成「魔改」相关全部文件内容
// ---------------------------------------------------------------------------

/**
 * 生成魔改写入计划（不改动磁盘，只产出文件内容）。
 * @param {object} ini MinecraftClient.ini 原文
 * @param {object} opts {
 *   antiAfk: {enabled, delay, command},
 *   autoRelog: {enabled, delay, retries, ignoreKickMessage, kickMessages[]},
 *   scriptScheduler: {enabled, tasksFile}
 * }
 * @returns {object} { ini: 新 ini 文本, files: [{target, text}] 附加文件 }
 */
function planModApply(ini, opts) {
  const o = opts || {};
  let newIni = typeof ini === 'string' ? ini : '';

  const files = [];

  if (o.antiAfk) {
    newIni = setSection(newIni, 'AntiAFK', buildAntiAfkSection(o.antiAfk));
  }
  if (o.autoRelog) {
    newIni = setSection(newIni, 'AutoRelog', buildAutoRelogSection(o.autoRelog));
    files.push({ target: 'kickmessages.txt', text: buildKickMessagesTxt(o.autoRelog.kickMessages) });
  }
  if (o.scriptScheduler) {
    newIni = setSection(newIni, 'ChatBot.ScriptScheduler', buildScriptSchedulerSection(o.scriptScheduler));
    if (o.scriptScheduler.tasksTemplate) {
      files.push({ target: String(o.scriptScheduler.tasksFile || 'tasks.txt'), text: buildTasksTxtTemplate() });
    }
  }

  return { ini: newIni, files };
}

module.exports = {
  // INI 段
  getSection,
  setSection,
  removeSection,
  replaceServerLine,
  // 自定义聊天指令
  buildMatchesIni,
  parseMatchesIni,
  defaultCommands,
  // 多服务器
  buildServersTxt,
  parseServersTxt,
  // 原生功能段
  buildAntiAfkSection,
  buildAutoRelogSection,
  buildKickMessagesTxt,
  buildScriptSchedulerSection,
  buildTasksTxtTemplate,
  buildIdleScriptTemplate,
  // 组合
  planModApply
};
