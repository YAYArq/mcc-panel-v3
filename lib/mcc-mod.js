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
    '# 每段 [Match] 为一条规则：match=触发正则，action=要执行的命令（send 表示发到游戏）',
    '# 白名单规则通过「发言前缀 + 触发词」复合正则实现，由面板自动生成',
    ''
  ];
  for (const c of commands || []) {
    if (!c || !String(c.trigger || '').trim()) continue;
    const trigger = String(c.trigger).trim();
    const whitelist = (Array.isArray(c.whitelist) ? c.whitelist : [])
      .map((s) => String(s || '').trim()).filter(Boolean);
    let match = trigger;
    if (whitelist.length > 0) {
      // 仅白名单玩家可触发：匹配「玩家 > 消息」（中文服）、「玩家: 消息」（部分插件服）、
      // 「<玩家> 消息」（英文服）三种发言前缀；玩家名做正则转义，
      // 名字前必须是行首或非字母数字（防止 X玩家名 这类包含关系误触发）
      const names = whitelist.map(escapeRegExp).join('|');
      match = '(?:^|[^A-Za-z0-9_])(?:(?:' + names + ') > |(?:' + names + '): |<(?:' + names + ')> )' + trigger;
    }
    lines.push('[Match]');
    lines.push('match=' + match);
    if (c.action) lines.push('action=' + String(c.action).trim());
    if (Number(c.cooldown) > 0) lines.push('cooldown=' + Number(c.cooldown));
    lines.push('enabled=' + (c.enabled === false ? 'false' : 'true'));
    // 注释回写原始触发词与白名单，供面板下次编辑还原（MCC 忽略 # 注释行）
    if (whitelist.length > 0) lines.push('# 白名单: ' + whitelist.join(', ') + ' | 触发: ' + trigger);
    lines.push('');
  }
  return lines.join('\n');
}

/** 解析现有 matches.ini 为指令列表。 */
function parseMatchesIni(text) {
  const commands = [];
  if (typeof text !== 'string') return commands;
  // 按 [Match] 行切块（不能按字符 [ 切：白名单复合正则本身含 [ 字符）
  const lines = text.split(/\r?\n/);
  let body = [];
  const flush = () => {
    const block = body.join('\n');
    body = [];
    const get = (k) => {
      const mm = new RegExp('^' + k + '\\s*=\\s*(.+)$', 'm').exec(block);
      return mm ? mm[1].trim() : null;
    };
    const rawTrigger = get('match');
    if (!rawTrigger) return;
    // 白名单注释回读：# 白名单: a, b | 触发: !home
    const wm = /#\s*白名单\s*:\s*([^|]*?)(?:\|\s*触发\s*:\s*([^\r\n]+))?\s*$/m.exec(block);
    const whitelist = wm ? wm[1].split(/[,，]/).map((s) => s.trim()).filter(Boolean) : [];
    const trigger = (wm && wm[2] !== undefined) ? wm[2].trim() : rawTrigger;
    commands.push({
      trigger,
      action: get('action') || '',
      cooldown: Number(get('cooldown')) || 0,
      enabled: get('enabled') !== 'false',
      whitelist
    });
  };
  let inBlock = false;
  for (const l of lines) {
    if (/^\s*\[Match\]\s*$/i.test(l)) {
      flush();
      inBlock = true;
      continue;
    }
    if (inBlock && /^\s*\[/.test(l)) {
      flush();
      inBlock = false;
      continue;
    }
    if (inBlock) body.push(l);
  }
  flush();
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
// 注：新版 MCC（build 500+）段名为 [ChatBot.AntiAFK] / [ChatBot.AutoRelog]，
//     旧版 [AntiAFK] / [AutoRelog] 已不被识别，此处按新版格式输出。
// ---------------------------------------------------------------------------

/** 生成 [ChatBot.AntiAFK] 段（新版格式，delay 单位秒，写成 min/max 区间）。 */
function buildAntiAfkSection({ enabled = true, delay = 600, command = '/ping' } = {}) {
  const sec = Number(delay) > 0 ? Number(delay) : 600;
  return [
    'Enabled = ' + (enabled ? 'true' : 'false'),
    'Delay = { min = ' + sec + ', max = ' + sec + ' }',
    'Command = "' + String(command || '/ping').replace(/"/g, '') + '"'
  ];
}

/** 生成 [ChatBot.AutoRelog] 段（新版格式：Retries + Kick_Messages 内嵌触发词）。 */
function buildAutoRelogSection({ enabled = true, delay = 10, retries = -1, ignoreKickMessage = false, kickMessages = null } = {}) {
  const msgs = (Array.isArray(kickMessages) && kickMessages.length)
    ? kickMessages
    : ['Connection has been lost', 'Server is restarting', 'Server is full', 'Too Many people'];
  return [
    'Enabled = ' + (enabled ? 'true' : 'false'),
    'Delay = { min = ' + (Number(delay) || 10) + ', max = ' + (Number(delay) || 10) + ' }',
    'Retries = ' + (Number(retries) || 0),
    'Ignore_Kick_Message = ' + (ignoreKickMessage ? 'true' : 'false'),
    'Kick_Messages = [ ' + msgs.map((m) => '"' + String(m).replace(/"/g, '').trim() + '"').join(', ') + ' ]'
  ];
}

/** 生成 kickmessages.txt（旧版 MCC 兼容用；新版走 Kick_Messages 段，此文件无害保留）。 */
function buildKickMessagesTxt(messages) {
  const list = (messages && messages.length) ? messages : [
    'Connection has been lost',
    'Login failed',
    'Failed to ping this IP',
    'Restarting'
  ];
  return list.map((m) => String(m).trim()).filter(Boolean).join('\n') + '\n';
}

/** 生成 [ChatBot.RemoteControl] 段（新版原生自动接受传送）。 */
function buildRemoteControlSection({ enabled = true, autoTpaccept = true, autoTpacceptEveryone = false } = {}) {
  return [
    'Enabled = ' + (enabled ? 'true' : 'false'),
    'AutoTpaccept = ' + (autoTpaccept ? 'true' : 'false'),
    'AutoTpaccept_Everyone = ' + (autoTpacceptEveryone ? 'true' : 'false')
  ];
}

/** 生成 [ChatBot.ScriptScheduler] 段（新版节名）。 */
function buildScriptSchedulerSection({ enabled = true, tasksFile = 'tasks.txt' } = {}) {
  return [
    'Enabled = ' + (enabled ? 'true' : 'false')
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
    newIni = setSection(newIni, 'ChatBot.AntiAFK', buildAntiAfkSection(o.antiAfk));
  }
  if (o.autoRelog) {
    newIni = setSection(newIni, 'ChatBot.AutoRelog', buildAutoRelogSection(o.autoRelog));
    // 旧版 MCC 兼容文件（新版走段内 Kick_Messages，此文件无害保留）
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

// ---------------------------------------------------------------------------
// 手机设置页：MinecraftClient.ini 可视化配置（解析/写回，纯函数）
// 配置项参考 MCC 官方 MinecraftClient.ini 注释说明（build 500）。
// 只精确替换目标键所在行，段内其他配置原样保留。
// ---------------------------------------------------------------------------

/** 默认传送请求正则（兼容常见中英文插件提示，可按服务器插件在设置页修改）。
 *  注意：不使用 .NET 专属的 (?s) 内联标志，保证 MCC(.NET) 与前端(JS) 均可解析；
 *  不加 ^ 行首锚点（TSL 等插件消息行首有 ▌ 装饰符，锚定会失配）。 */
function defaultTeleportRegex() {
  return '([a-zA-Z0-9_\\u4e00-\\u9fa5]{1,16}) ?(请求你传送到他的位置|请求传送到你的位置|请求传送|请求传送到你|想要传送到你|传送请求|wants to teleport to you|invites you to teleport to them|requests to teleport to you)\\.?';
}

/** 定位 ini 段范围。返回 { headerEnd, end } 或 null（不存在）。 */
function sectionRange(text, name) {
  const header = '[' + name + ']';
  const idx = text.indexOf(header);
  if (idx < 0) return null;
  const headerEndRaw = text.indexOf('\n', idx);
  const headerEnd = headerEndRaw < 0 ? text.length : headerEndRaw;
  const after = text.indexOf('\n[', headerEnd);
  const end = after >= 0 ? after + 1 : text.length;
  return { headerEnd, end };
}

/** 精确替换某段内某个键所在行；键不存在则在该段末尾追加；段不存在则新建段。 */
function setKey(ini, section, key, valueText) {
  const text = typeof ini === 'string' ? ini : '';
  const line = key + ' = ' + valueText;
  const range = sectionRange(text, section);
  if (!range) {
    return text.replace(/\s*$/, '') + '\n\n[' + section + ']\n' + line + '\n';
  }
  const body = text.slice(range.headerEnd, range.end);
  // 匹配键行（允许缩进；跳过 # 注释行）
  const keyRe = new RegExp('(^|\\n)(?!#)[ \\t]*' + escapeRegExp(key) + '[ \\t]*=[^\\n]*');
  if (keyRe.test(body)) {
    const newBody = body.replace(keyRe, (m, nl) => nl + line);
    return text.slice(0, range.headerEnd) + newBody + text.slice(range.end);
  }
  // 键不存在：段末尾追加
  const needNl = body.length > 0 && !body.endsWith('\n') ? '\n' : '';
  return text.slice(0, range.end) + needNl + line + '\n' + text.slice(range.end);
}

/** 读取某段内某个键的原始值文本（不含注释），不存在返回 null。 */
function getKeyValue(ini, section, key) {
  const text = typeof ini === 'string' ? ini : '';
  const range = sectionRange(text, section);
  if (!range) return null;
  const body = text.slice(range.headerEnd, range.end);
  const re = new RegExp('(^|\\n)(?!#)[ \\t]*' + escapeRegExp(key) + '[ \\t]*=[ \\t]*([^\\n]*)');
  const m = re.exec(body);
  return m ? m[2].trim() : null;
}

/** 解析 { Key = "v", Num = 1.5 } 嵌套结构为扁平对象（值保留原始文本）。 */
function parseNested(raw) {
  const out = {};
  if (typeof raw !== 'string') return out;
  const re = /([A-Za-z_][A-Za-z0-9_]*)\s*=\s*("((?:[^"\\]|\\.)*)"|-?\d+(?:\.\d+)?|[A-Za-z0-9_.-]+)/g;
  let m;
  while ((m = re.exec(raw))) {
    let v = m[2];
    if (v.startsWith('"')) v = v.slice(1, -1).replace(/\\"/g, '"');
    out[m[1]] = v;
  }
  return out;
}

/** 解析 [ "a", "b" ] 列表为字符串数组。 */
function parseList(raw) {
  if (typeof raw !== 'string') return [];
  const list = [];
  const re = /"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(raw))) list.push(m[1].replace(/\\"/g, '"'));
  return list;
}

/** 把文本值（换行分隔）序列化为 INI 列表写法。 */
function serializeList(value) {
  const items = String(value == null ? '' : value).split(/\r?\n/)
    .map((s) => s.trim()).filter(Boolean)
    .map((s) => '"' + String(s).replace(/"/g, '') + '"');
  return '[ ' + items.join(', ') + ' ]';
}

/** 清理引号与换行，防止注入破坏 ini 结构。 */
function cleanQuoted(v) {
  return String(v == null ? '' : v).replace(/["\r\n]/g, '').trim();
}

/** 把 bool / number / text / textarea 值序列化为 INI 值文本。 */
function serializeValue(v, type) {
  if (type === 'bool') return v ? 'true' : 'false';
  if (type === 'number') {
    const n = Number(v);
    return String(Number.isFinite(n) ? n : 0);
  }
  if (type === 'textarea') return serializeList(v);
  // 文本值统一用 TOML 单引号字面量字符串包裹：
  // 正则里的反斜杠（如 \[）在单引号字符串中是字面量，避免双引号字符串的转义歧义
  const s = String(v == null ? '' : v).replace(/[\r\n']/g, ' ').trim();
  return "'" + s + "'";
}

/** 剥离 ini 值后的行内注释（# 之后的内容）。 */
function stripInlineComment(v) {
  return String(v == null ? '' : v).split('#')[0].trim();
}

/** 把 INI 原始值文本转换为对应类型值。 */
function convertValue(raw, type) {
  if (type === 'bool') return String(stripInlineComment(raw)) === 'true';
  if (type === 'number') {
    const n = Number(stripInlineComment(raw));
    return Number.isFinite(n) ? n : 0;
  }
  if (type === 'textarea') return parseList(stripInlineComment(raw)).join('\n');
  // 文本值：剥离首尾成对的单/双引号（TOML 字符串字面量），避免界面显示带引号
  let s = String(raw == null ? '' : stripInlineComment(raw)).trim();
  if (s.length >= 2 && ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"')))) {
    s = s.slice(1, -1);
  }
  return s;
}

/** 简单键（单段或多段 fallback）配置项工厂。新版 MCC 把聊天类键放在 Main.Advanced，旧版在 Main.General，两段都要兼容。 */
function simpleDef(key, group, type, label, sections, iniKey, hint) {
  const secs = Array.isArray(sections) ? sections : [sections];
  return {
    key, group, type, label, hint: hint || '',
    extract: (ini) => {
      for (const s of secs) {
        const v = getKeyValue(ini, s, iniKey);
        if (v !== null) return convertValue(v, type);
      }
      return convertValue(null, type);
    },
    write: (ini, v) => {
      // 写回优先选已存在的段（保持原文件结构），都不存在则新建第一个
      let target = null;
      for (const s of secs) {
        if (sectionRange(ini, s)) { target = s; break; }
      }
      if (!target) target = secs[0];
      return setKey(ini, target, iniKey, serializeValue(v, type));
    }
  };
}

/** 服务器地址/端口（共用 Server = { Host, Port } 结构）。 */
function serverHostDef() {
  return {
    key: 'server.host', group: 'server', type: 'text', label: '服务器地址', hint: '域名或 IP，修改后需重启实例生效',
    extract: (ini) => parseNested(getKeyValue(ini, 'Main.General', 'Server')).Host || '',
    write: (ini, v, all) => {
      const cur = parseNested(getKeyValue(ini, 'Main.General', 'Server'));
      const port = all['server.port'] !== undefined ? all['server.port'] : cur.Port;
      const portPart = (port && Number(port) > 0) ? ', Port = ' + Number(port) : '';
      return setKey(ini, 'Main.General', 'Server', '{ Host = "' + cleanQuoted(v) + '"' + portPart + ' }');
    }
  };
}
function serverPortDef() {
  return {
    key: 'server.port', group: 'server', type: 'number', label: '端口', hint: '填 0 = 自动解析（默认 25565）',
    extract: (ini) => Number(parseNested(getKeyValue(ini, 'Main.General', 'Server')).Port) || 0,
    write: (ini, v, all) => {
      const cur = parseNested(getKeyValue(ini, 'Main.General', 'Server'));
      const host = all['server.host'] !== undefined ? all['server.host'] : cur.Host;
      const portPart = (v && Number(v) > 0) ? ', Port = ' + Number(v) : '';
      return setKey(ini, 'Main.General', 'Server', '{ Host = "' + cleanQuoted(host) + '"' + portPart + ' }');
    }
  };
}

/** 登录名（Account = { Login, Password } 结构，与离线模式/密码共用写回）。 */
function accountLoginDef() {
  return {
    key: 'account.login', group: 'server', type: 'text', label: '登录名', hint: '正版填邮箱，离线模式填游戏名',
    extract: (ini) => parseNested(getKeyValue(ini, 'Main.General', 'Account')).Login || '',
    write: (ini, v, all) => writeAccount(ini, v, all)
  };
}
function accountPasswordDef() {
  return {
    key: 'account.password', group: 'server', type: 'text', label: '密码', hint: '离线模式填 -（留空则保持原密码不变）',
    extract: () => '', // 不回显密码，安全考虑
    write: (ini, v, all) => {
      if (String(v || '').trim() === '') return ini; // 未修改
      return writeAccount(ini, undefined, all, v);
    }
  };
}
function accountOfflineDef() {
  return {
    key: 'account.offline', group: 'server', type: 'bool', label: '离线模式', hint: '开启后无需正版登录（密码自动写为 -）',
    extract: (ini) => parseNested(getKeyValue(ini, 'Main.General', 'Account')).Password === '-',
    write: (ini, v, all) => writeAccount(ini, undefined, all, v ? '-' : undefined)
  };
}
function writeAccount(ini, loginValue, all, passwordValue) {
  const cur = parseNested(getKeyValue(ini, 'Main.General', 'Account'));
  const login = loginValue !== undefined ? loginValue : (all['account.login'] !== undefined ? all['account.login'] : cur.Login);
  const pw = passwordValue !== undefined ? passwordValue
    : (all['account.password'] !== undefined ? all['account.password'] : cur.Password);
  return setKey(ini, 'Main.General', 'Account', '{ Login = "' + cleanQuoted(login) + '", Password = "' + cleanQuoted(pw || '-') + '" }');
}

/** 防 AFK 间隔（Delay = { min, max } 结构）。 */
function afkMinDef() {
  return {
    key: 'afk.minSec', group: 'automation', type: 'number', label: '间隔下限（秒）', hint: '随机区间下限，建议 ≥ 60',
    extract: (ini) => Number(parseNested(getKeyValue(ini, 'ChatBot.AntiAFK', 'Delay')).min) || 0,
    write: (ini, v, all) => writeAfkDelay(ini, v, all)
  };
}
function afkMaxDef() {
  return {
    key: 'afk.maxSec', group: 'automation', type: 'number', label: '间隔上限（秒）', hint: '随机区间上限，不小于下限',
    extract: (ini) => Number(parseNested(getKeyValue(ini, 'ChatBot.AntiAFK', 'Delay')).max) || 0,
    write: (ini, v, all) => writeAfkDelay(ini, undefined, all)
  };
}
function writeAfkDelay(ini, minValue, all) {
  const cur = parseNested(getKeyValue(ini, 'ChatBot.AntiAFK', 'Delay'));
  const min = minValue !== undefined ? Number(minValue) : (all['afk.minSec'] !== undefined ? Number(all['afk.minSec']) : Number(cur.min) || 0);
  const max = all['afk.maxSec'] !== undefined ? Number(all['afk.maxSec']) : Number(cur.max) || min;
  const minS = Math.max(0, min);
  const maxS = Math.max(minS, max);
  return setKey(ini, 'ChatBot.AntiAFK', 'Delay', '{ min = ' + minS + ', max = ' + maxS + ' }');
}

/** 设置页配置项定义（分组顺序即页面展示顺序）。 */
function settingDefs() {
  return [
    // ---- 账号与服务器 ----
    serverHostDef(),
    serverPortDef(),
    accountLoginDef(),
    accountPasswordDef(),
    accountOfflineDef(),
    // ---- 聊天与显示（新版 MCC 在 Main.Advanced，旧版在 Main.General，均兼容）----
    simpleDef('chat.language', 'chat', 'text', '语言', ['Main.Advanced', 'Main.General'], 'Language', '如 zh_cn / en_us，修改后重启生效'),
    simpleDef('chat.timestamps', 'chat', 'bool', '消息时间戳', ['Main.Advanced', 'Main.General'], 'Timestamps', '聊天消息前显示时间'),
    simpleDef('chat.autoRespawn', 'chat', 'bool', '自动重生', ['Main.Advanced', 'Main.General'], 'AutoRespawn', '死亡后自动重生（确保重生点安全）'),
    simpleDef('chat.systemMessages', 'chat', 'bool', '显示系统消息', ['Main.Advanced', 'Main.General'], 'ShowSystemMessages', '如进服/退服提示'),
    simpleDef('chat.xpBarMessages', 'chat', 'bool', '显示经验条消息', ['Main.Advanced', 'Main.General'], 'ShowXPBarMessages', '经验条刷屏时可关闭'),
    simpleDef('chat.chatLinks', 'chat', 'bool', '解析聊天链接', ['Main.Advanced', 'Main.General'], 'ShowChatLinks', '显示聊天中的网址'),
    simpleDef('chat.inventoryHandling', 'chat', 'bool', '背包处理', ['Main.Advanced', 'Main.General'], 'InventoryHandling', '背包/物品相关功能开关'),
    simpleDef('chat.messageCooldown', 'chat', 'number', '消息冷却（秒）', ['Main.Advanced', 'Main.General'], 'MessageCooldown', '两次发言最小间隔，防刷屏'),
    { key: 'chat.botOwners', group: 'tp', type: 'textarea', label: '传送白名单（BotOwners）', hint: '每行一个游戏名。名单内玩家的传送请求才会被自动接受（关闭「接受所有人」时）；同时这些玩家可用 /tell <bot名> 指令远程控制。保存后需重启实例生效',
      extract: (ini) => {
        for (const s of ['Main.Advanced', 'Main.General']) {
          const v = getKeyValue(ini, s, 'BotOwners');
          if (v !== null) return parseList(stripInlineComment(v)).join('\n');
        }
        return '';
      },
      write: (ini, v) => {
        const target = sectionRange(ini, 'Main.Advanced') ? 'Main.Advanced'
          : (sectionRange(ini, 'Main.General') ? 'Main.General' : 'Main.Advanced');
        return setKey(ini, target, 'BotOwners', serializeValue(v, 'textarea'));
      } },
    // ---- 传送请求（tpa）----
    simpleDef('tp.autoAccept', 'tp', 'bool', '自动接受传送', 'ChatBot.RemoteControl', 'AutoTpaccept', '收到传送请求自动同意'),
    simpleDef('tp.autoAcceptEveryone', 'tp', 'bool', '接受所有人', 'ChatBot.RemoteControl', 'AutoTpaccept_Everyone', '关闭则仅接受管理员名单玩家的请求'),
    simpleDef('tp.regex', 'tp', 'text', '传送请求正则', 'ChatFormat', 'TeleportRequest', '按服务器插件提示文本修改，如中文插件用「请求传送」'),
    // ---- 自动化 ----
    simpleDef('afk.enabled', 'automation', 'bool', '防挂机（原生）', 'ChatBot.AntiAFK', 'Enabled', 'MCC 原生 AntiAFK，周期性发命令'),
    afkMinDef(),
    afkMaxDef(),
    simpleDef('afk.command', 'automation', 'text', '防挂机命令', 'ChatBot.AntiAFK', 'Command', '如 /ping 或服务器防呆命令'),
    simpleDef('relog.enabled', 'automation', 'bool', '掉线自动重连（原生）', 'ChatBot.AutoRelog', 'Enabled', 'MCC 原生 AutoRelog'),
    simpleDef('relog.retries', 'automation', 'number', '重试次数', 'ChatBot.AutoRelog', 'Retries', '-1 = 无限重试，0 = 不重试'),
    { key: 'relog.kickMessages', group: 'automation', type: 'textarea', label: '重连触发词', hint: '每行一个，命中即自动重连（如 Connection has been lost）',
      extract: (ini) => parseList(getKeyValue(ini, 'ChatBot.AutoRelog', 'Kick_Messages')).join('\n'),
      write: (ini, v) => setKey(ini, 'ChatBot.AutoRelog', 'Kick_Messages', serializeValue(v, 'textarea')) },
    // ---- 日志 ----
    simpleDef('log.chat', 'logging', 'bool', '显示聊天消息', 'Logging', 'ChatMessages', '控制台是否显示聊天'),
    simpleDef('log.info', 'logging', 'bool', '显示信息消息', 'Logging', 'InfoMessages', 'MCC 自身的提示信息'),
    simpleDef('log.toFile', 'logging', 'bool', '日志写入文件', 'Logging', 'LogToFile', '保存到 console-log.txt'),
    simpleDef('log.timestamp', 'logging', 'bool', '日志文件时间戳', 'Logging', 'PrependTimestamp', '写入文件的消息前加时间')
  ];
}

/** 设置分组元信息。 */
function settingGroups() {
  return [
    { id: 'server', title: '账号与服务器' },
    { id: 'chat', title: '聊天与显示' },
    { id: 'tp', title: '传送请求（tpa）' },
    { id: 'automation', title: '自动化' },
    { id: 'logging', title: '日志' }
  ];
}

/**
 * 从 ini 文本解析出设置页数据（分组 + 配置项 + 当前值）。
 * @param {string} ini MinecraftClient.ini 原文
 * @returns {object} { groups: [{ id, title, items: [{ key, type, label, hint, value }] }] }
 */
function parseSettings(ini) {
  const defs = settingDefs();
  const groups = settingGroups().map((g) => ({
    id: g.id,
    title: g.title,
    items: defs.filter((d) => d.group === g.id).map((d) => ({
      key: d.key,
      type: d.type,
      label: d.label,
      hint: d.hint || '',
      value: d.extract(ini)
    }))
  }));
  return { groups };
}

/**
 * 把设置值写回 ini 文本（只替换被修改的键，其余原样保留）。
 * @param {string} ini 原文
 * @param {object} values { key: value }，仅包含需要修改的项
 * @returns {string} 新 ini 文本
 */
function applySettings(ini, values) {
  let out = typeof ini === 'string' ? ini : '';
  const all = values || {};
  for (const def of settingDefs()) {
    if (all[def.key] === undefined) continue;
    out = def.write(out, all[def.key], all);
  }
  return out;
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
  buildRemoteControlSection,
  buildTasksTxtTemplate,
  buildIdleScriptTemplate,
  // 组合
  planModApply,
  // 手机设置页（可视化配置）
  defaultTeleportRegex,
  setKey,
  getKeyValue,
  parseSettings,
  applySettings
};
