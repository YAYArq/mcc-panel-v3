'use strict';

/**
 * lib/automation.js — v3 自动化引擎（后台循环 + 定时调度，零第三方依赖）。
 *
 * 职责：
 *   1. 健康监控驱动：周期性拉取所有节点实例快照，喂给 HealthTracker
 *   2. 消息统计：解析运行中实例的日志增量，统计聊天消息/命令
 *   3. 掉线检测：命中关键词后按策略处理（默认先 /reco，连续失败 N 次再重启）
 *   4. 防 AFK：周期性向实例发送自定义命令
 *   5. 定时任务：cron 风格（重启/停止/启动/发命令）
 *   6. 开机自启组：面板启动后按组错峰启动实例
 *
 * 数据文件：data/automation.json（掉线检测/防AFK/自启组配置）、
 *           data/schedules.json（定时任务列表）。
 *
 * 容错：所有 MCSM 调用均 try/catch，单次失败只记录日志，不影响后续轮询；
 * tick 循环带重入保护，避免请求未返回时叠加。
 */

const store = require('./store');
const cron = require('./cron');
const crypto = require('crypto');
const { keyOf } = require('./health');

const AUTOMATION_STORE = 'automation.json';
const SCHEDULES_STORE = 'schedules.json';
const STATUS_RUNNING = '3';

// 掉线检测默认关键词（MCC 控制台为英文输出）
const DEFAULT_KEYWORDS = [
  'Connection has been lost',
  'Connection lost',
  'connection lost',
  'Disconnected',
  'disconnected',
  'Lost connection',
  'Connection failed',
  'Failed to connect'
];

// 自动化配置默认值
const DEFAULT_AUTOMATION = {
  autoreconnect: {
    enabled: false,
    keywords: DEFAULT_KEYWORDS,
    strategy: 'reco',          // 'reco'：先发 /reco；'restart'：直接重启
    maxRecoFailures: 3,        // 连续 /reco 失败达此次数后自动重启实例
    cooldownMs: 60000,         // 同一实例两次触发的最小间隔
    resetAfterMs: 300000,      // 恢复在线超过此时间后清零失败计数
    enabledInstances: {}       // key -> true/false，缺省视为启用
  },
  afk: {
    enabled: false,
    intervalMs: 300000,        // 默认 5 分钟
    command: '/ping',
    enabledInstances: {}
  },
  autostartGroups: []
};

function mergeDefaultAutomation(saved) {
  const base = JSON.parse(JSON.stringify(DEFAULT_AUTOMATION));
  if (!saved || typeof saved !== 'object') return base;
  for (const section of ['autoreconnect', 'afk']) {
    if (saved[section] && typeof saved[section] === 'object') {
      base[section] = { ...base[section], ...saved[section] };
    }
  }
  if (Array.isArray(saved.autostartGroups)) base.autostartGroups = saved.autostartGroups;
  return base;
}

/** 去掉 ANSI 转义序列（与 server.js 中逻辑一致）。 */
function stripAnsi(text) {
  if (typeof text !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, '');
}

class AutomationEngine {
  /**
   * @param {object} opts
   * @param {object} opts.mcsm McsmClient 实例
   * @param {object} opts.config 面板完整配置（含 v3 段）
   * @param {object} opts.health HealthTracker 实例
   * @param {Function} [opts.logOperation] (user, action, detail) 操作日志回调
   */
  constructor({ mcsm, config, health, logOperation }) {
    this.mcsm = mcsm;
    this.config = config || {};
    this.health = health;
    this.logOperation = logOperation || (() => {});

    this.automation = mergeDefaultAutomation(store.load(AUTOMATION_STORE, null));
    const savedSchedules = store.load(SCHEDULES_STORE, null);
    this.schedules = { schedules: Array.isArray(savedSchedules && savedSchedules.schedules) ? savedSchedules.schedules : [] };

    // 内存态
    this.failCounts = new Map();      // key -> 连续 /reco 失败次数
    this.lastTriggers = new Map();    // key -> 最近掉线触发时间
    this.lastAfkSent = new Map();     // key -> 最近防 AFK 发送时间
    this.logTails = new Map();        // key -> { tail, first }
    this.lastSnapshot = [];
    this.running = false;             // tick 重入保护
    this.timers = [];
    this.started = false;
  }

  // -------------------------------------------------------------------------
  // 生命周期
  // -------------------------------------------------------------------------
  start() {
    if (this.started) return;
    this.started = true;
    const v3 = this.config.v3 || {};
    if (v3.enabled === false) {
      console.log('[MCC_V3] 自动化引擎已通过配置 v3.enabled=false 禁用');
      return;
    }
    const poll = Math.max(5000, Number(v3.healthPollIntervalMs) || 15000);

    this.timers.push(setInterval(() => this.tickHealth(), poll));
    this.timers.push(setInterval(() => this.tickSchedules(), 30000));
    // 启动后尽快跑一次健康检查，让数据尽快可用（延迟 3s 等服务就绪）
    this.timers.push(setTimeout(() => this.tickHealth().catch(() => {}), 3000));
    this.startAutostartGroupsSoon();
    console.log(`[MCC_V3] 自动化引擎已启动（健康轮询 ${poll}ms，cron 调度每 30s 检查）`);
  }

  stop() {
    for (const t of this.timers) clearInterval(t);
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    this.started = false;
  }

  // -------------------------------------------------------------------------
  // MCSM 基础调用（带容错）
  // -------------------------------------------------------------------------
  async listDaemons() {
    const r = await this.mcsm.request('GET', '/api/service/remote_services_list');
    return (r.status === 200 && Array.isArray(r.data)) ? r.data : [];
  }

  async listInstances(daemonId) {
    const r = await this.mcsm.request('GET', '/api/service/remote_service_instances', {
      daemonId, page: 1, page_size: 100
    });
    if (r.status !== 200) return [];
    const data = (r.data && r.data.data) || [];
    return Array.isArray(data) ? data : [];
  }

  async readLog(daemonId, uuid) {
    const r = await this.mcsm.request('GET', '/api/protected_instance/outputlog', { daemonId, uuid, size: 65536 });
    let text = r.data;
    if (text && typeof text === 'object' && typeof text.data === 'string') text = text.data;
    return typeof text === 'string' ? stripAnsi(text) : '';
  }

  async sendCommand(daemonId, uuid, command) {
    const r = await this.mcsm.request('POST', '/api/protected_instance/command', { daemonId, uuid, command });
    return r.status === 200;
  }

  async instanceAction(daemonId, uuid, action) {
    const r = await this.mcsm.request('POST', `/api/protected_instance/${action}`, { daemonId, uuid });
    return r.status === 200;
  }

  async getInstanceStatus(daemonId, uuid) {
    const r = await this.mcsm.request('GET', '/api/instance', { daemonId, uuid });
    const inst = (r.data && typeof r.data === 'object') ? r.data : null;
    return inst ? String(inst.status == null ? '' : inst.status) : '';
  }

  // -------------------------------------------------------------------------
  // 健康轮询（快照 + 日志分析 + 掉线检测 + 防AFK）
  // -------------------------------------------------------------------------
  async tickHealth() {
    if (this.running) return;
    this.running = true;
    try {
      const daemons = await this.listDaemons();
      const snapshot = [];
      for (const d of daemons) {
        if (String(d.available) === 'false') continue; // 节点不可用跳过
        const instances = await this.listInstances(d.uuid);
        for (const inst of instances) {
          snapshot.push({
            daemonId: d.uuid,
            uuid: inst.instanceUuid,
            // 实例名在 config.nickname（MCSM 列表接口无顶层 name 字段，之前取不到导致健康面板显示 uuid）
            nickname: (inst.config && inst.config.nickname) || inst.name || inst.nickname || '',
            status: String(inst.status == null ? '' : inst.status)
          });
        }
      }
      this.lastSnapshot = snapshot;
      this.health.updateFromSnapshot(snapshot);

      // 只对运行中的实例做日志分析
      const running = snapshot.filter((i) => i.status === STATUS_RUNNING);
      for (const inst of running) {
        try {
          const key = keyOf(inst.daemonId, inst.uuid);
          const logText = await this.readLog(inst.daemonId, inst.uuid);
          const tailState = this.logTails.get(key) || { tail: '', first: true };
          const newText = tailState.first ? null : this.extractNew(logText, tailState.tail);
          tailState.tail = logText.slice(-400);
          tailState.first = false;
          this.logTails.set(key, tailState);

          if (newText) {
            this.countStats(inst, newText);
            if (this.isEnabled('autoreconnect', key)) await this.checkDisconnect(inst, newText);
          }
          if (this.isEnabled('afk', key)) await this.checkAfk(inst);
        } catch (e) {
          console.error('[MCC_V3] 实例日志分析失败:', inst.nickname || inst.uuid, e.message);
        }
      }

      // 失败计数复位：运行中且距上次触发超过 resetAfterMs 的实例清零
      const now = Date.now();
      for (const key of Array.from(this.failCounts.keys())) {
        const last = this.lastTriggers.get(key) || 0;
        if (now - last > (this.automation.autoreconnect.resetAfterMs || 300000)) {
          this.failCounts.delete(key);
        }
      }
    } catch (e) {
      console.error('[MCC_V3] 健康轮询失败:', e.message);
    } finally {
      this.running = false;
    }
  }

  /** 判断某实例在某功能下是否启用（enabledInstances 缺省视为启用）。 */
  isEnabled(section, key) {
    const cfg = this.automation[section];
    if (!cfg) return false;
    if (section === 'autoreconnect' && !cfg.enabled) return false;
    if (section === 'afk' && !cfg.enabled) return false;
    const map = cfg.enabledInstances || {};
    return map[key] !== false; // 未配置 = 启用；显式 false = 停用
  }

  /** 从新日志文本中提取上次尾部之后的新增内容（缓冲区滚动时返回 null）。 */
  extractNew(text, prevTail) {
    if (!prevTail) return null;
    const idx = text.indexOf(prevTail);
    if (idx < 0) return null; // 日志缓冲区已滚动，跳过本次，避免误报/重复统计
    return text.slice(idx + prevTail.length);
  }

  /** 统计聊天消息/命令（近似：<玩家> 开头=消息，/ 开头=命令）。 */
  countStats(inst, newText) {
    let messages = 0;
    let commands = 0;
    for (const line of newText.split('\n')) {
      const l = line.trim();
      if (!l) continue;
      // 兼容多种日志前缀（无前缀 / [Server] / [HH:mm:ss]）：
      // 行内出现 <名字> 后跟非空内容即视为一条聊天消息
      if (/<[^>]{1,16}>\s+\S/.test(l)) messages += 1;
      else if (/^\/[a-zA-Z]/.test(l)) commands += 1;
    }
    if (messages > 0 || commands > 0) {
      this.health.recordMessages(inst.daemonId, inst.uuid, { messages, commands }, inst.nickname);
    }
  }

  /** 掉线检测与自动处理（策略：reco -> 连续失败 N 次 -> 重启）。 */
  async checkDisconnect(inst, newText) {
    const key = keyOf(inst.daemonId, inst.uuid);
    const cfg = this.automation.autoreconnect;
    const hit = (cfg.keywords || []).find((k) => k && newText.includes(k));
    if (!hit) return;

    const now = Date.now();
    const last = this.lastTriggers.get(key) || 0;
    if (now - last < (cfg.cooldownMs || 60000)) return;
    this.lastTriggers.set(key, now);

    this.health.recordDisconnect(inst.daemonId, inst.uuid);
    const failCount = (this.failCounts.get(key) || 0) + 1;

    const shouldRestart = cfg.strategy === 'restart' || failCount >= (cfg.maxRecoFailures || 3);
    if (shouldRestart) {
      this.failCounts.set(key, 0);
      this.logOperation('auto', '掉线自动重启', `${inst.nickname || key} 命中「${hit}」，已连续失败 ${failCount} 次，重启实例`);
      try {
        await this.instanceAction(inst.daemonId, inst.uuid, 'restart');
        this.health.recordReco(inst.daemonId, inst.uuid);
      } catch (e) {
        this.logOperation('auto', '掉线自动重启失败', `${inst.nickname || key}: ${e.message}`);
      }
    } else {
      this.failCounts.set(key, failCount);
      this.logOperation('auto', '掉线自动重连', `${inst.nickname || key} 命中「${hit}」，发送 /reco（第 ${failCount} 次）`);
      try {
        await this.sendCommand(inst.daemonId, inst.uuid, '/reco');
        this.health.recordReco(inst.daemonId, inst.uuid);
      } catch (e) {
        this.logOperation('auto', '掉线重连失败', `${inst.nickname || key}: ${e.message}`);
      }
    }
  }

  /** 防 AFK：周期性发送命令。 */
  async checkAfk(inst) {
    const key = keyOf(inst.daemonId, inst.uuid);
    const cfg = this.automation.afk;
    if (!cfg.command) return;
    const now = Date.now();
    const last = this.lastAfkSent.get(key) || 0;
    if (now - last < (cfg.intervalMs || 300000)) return;
    this.lastAfkSent.set(key, now);
    try {
      await this.sendCommand(inst.daemonId, inst.uuid, cfg.command);
    } catch (e) {
      console.error('[MCC_V3] 防 AFK 命令发送失败:', inst.nickname || key, e.message);
    }
  }

  // -------------------------------------------------------------------------
  // 定时任务（cron）
  // -------------------------------------------------------------------------
  listSchedules() {
    return this.schedules.schedules.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }

  createSchedule(input) {
    const { name, cron: cronExpr, action, enabled } = input || {};
    if (!name || !cronExpr) throw new Error('name / cron 不能为空');
    if (!cron.isValid(cronExpr)) throw new Error(`非法 cron 表达式: ${cronExpr}`);
    const act = normalizeAction(action);
    const now = Date.now();
    const s = {
      id: crypto.randomUUID(),
      name: String(name).slice(0, 64),
      cron: String(cronExpr).trim(),
      action: act,
      enabled: enabled !== false,
      createdAt: now,
      updatedAt: now,
      lastRunAt: null,
      lastRunMinute: null,
      runCount: 0,
      lastResult: null,
      lastError: null,
      history: []
    };
    this.schedules.schedules.push(s);
    store.save(SCHEDULES_STORE, this.schedules);
    return s;
  }

  updateSchedule(id, patch) {
    const s = this.schedules.schedules.find((x) => x.id === id);
    if (!s) throw new Error('任务不存在');
    if (patch.name !== undefined) s.name = String(patch.name).slice(0, 64);
    if (patch.cron !== undefined) {
      if (!cron.isValid(patch.cron)) throw new Error(`非法 cron 表达式: ${patch.cron}`);
      s.cron = String(patch.cron).trim();
    }
    if (patch.action !== undefined) s.action = normalizeAction(patch.action);
    if (patch.enabled !== undefined) s.enabled = !!patch.enabled;
    s.updatedAt = Date.now();
    store.save(SCHEDULES_STORE, this.schedules);
    return s;
  }

  deleteSchedule(id) {
    const before = this.schedules.schedules.length;
    this.schedules.schedules = this.schedules.schedules.filter((x) => x.id !== id);
    if (this.schedules.schedules.length === before) throw new Error('任务不存在');
    store.save(SCHEDULES_STORE, this.schedules);
  }

  /** 每分钟边界检查（每 30s 调用一次，靠 lastRunMinute 防重复）。 */
  tickSchedules() {
    const now = new Date();
    const minuteKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    let changed = false;
    for (const s of this.schedules.schedules) {
      if (!s.enabled || !cron.isValid(s.cron)) continue;
      if (!cron.matches(s.cron, now)) continue;
      if (s.lastRunMinute === minuteKey) continue;
      s.lastRunMinute = minuteKey;
      changed = true;
      this.executeSchedule(s); // 异步执行，不阻塞轮询
    }
    if (changed) store.save(SCHEDULES_STORE, this.schedules);
  }

  async executeSchedule(s) {
    s.runCount = (s.runCount || 0) + 1;
    try {
      const result = await this.runAction(s.action);
      s.lastResult = result;
      s.lastError = null;
      this.logOperation('auto', '定时任务', `${s.name} → ${result}`);
    } catch (e) {
      s.lastError = e.message;
      s.lastResult = null;
      this.logOperation('auto', '定时任务失败', `${s.name}: ${e.message}`);
    }
    s.lastRunAt = Date.now();
    s.history = s.history || [];
    s.history.unshift({
      time: Date.now(),
      ok: !s.lastError,
      result: s.lastResult || s.lastError
    });
    if (s.history.length > 20) s.history.length = 20;
    store.save(SCHEDULES_STORE, this.schedules);
  }

  /** 执行一个任务动作（供定时任务与手动触发复用）。 */
  async runAction(action) {
    const act = action || {};
    const { daemonId, uuid } = act;
    if (!daemonId || !uuid) throw new Error('daemonId / uuid 缺失');
    switch (act.type) {
      case 'start':
      case 'stop':
      case 'restart': {
        const ok = await this.instanceAction(daemonId, uuid, act.type);
        if (!ok) throw new Error('MCSM 操作未成功');
        return `已执行 ${act.type}`;
      }
      case 'command': {
        if (!act.command) throw new Error('command 内容为空');
        const ok = await this.sendCommand(daemonId, uuid, act.command);
        if (!ok) throw new Error('命令发送失败');
        return `已发送命令: ${String(act.command).slice(0, 60)}`;
      }
      default:
        throw new Error(`未知动作类型: ${act.type}`);
    }
  }

  // -------------------------------------------------------------------------
  // 自动化配置
  // -------------------------------------------------------------------------
  getAutomation() {
    return JSON.parse(JSON.stringify(this.automation));
  }

  updateAutomation(patch) {
    const p = patch || {};
    if (p.autoreconnect && typeof p.autoreconnect === 'object') {
      const rc = p.autoreconnect;
      if (rc.enabled !== undefined) this.automation.autoreconnect.enabled = !!rc.enabled;
      if (Array.isArray(rc.keywords)) {
        this.automation.autoreconnect.keywords = rc.keywords.map((k) => String(k).slice(0, 200)).filter(Boolean);
      }
      if (rc.strategy === 'reco' || rc.strategy === 'restart') this.automation.autoreconnect.strategy = rc.strategy;
      if (rc.maxRecoFailures !== undefined) this.automation.autoreconnect.maxRecoFailures = Math.max(1, Number(rc.maxRecoFailures) || 3);
      if (rc.cooldownMs !== undefined) this.automation.autoreconnect.cooldownMs = Math.max(5000, Number(rc.cooldownMs) || 60000);
      if (rc.resetAfterMs !== undefined) this.automation.autoreconnect.resetAfterMs = Math.max(30000, Number(rc.resetAfterMs) || 300000);
      if (rc.enabledInstances && typeof rc.enabledInstances === 'object') {
        this.automation.autoreconnect.enabledInstances = rc.enabledInstances;
      }
    }
    if (p.afk && typeof p.afk === 'object') {
      const afk = p.afk;
      if (afk.enabled !== undefined) this.automation.afk.enabled = !!afk.enabled;
      if (afk.intervalMs !== undefined) this.automation.afk.intervalMs = Math.max(10000, Number(afk.intervalMs) || 300000);
      if (afk.command !== undefined) this.automation.afk.command = String(afk.command).slice(0, 200);
      if (afk.enabledInstances && typeof afk.enabledInstances === 'object') {
        this.automation.afk.enabledInstances = afk.enabledInstances;
      }
    }
    store.save(AUTOMATION_STORE, this.automation);
    return this.getAutomation();
  }

  // -------------------------------------------------------------------------
  // 开机自启组
  // -------------------------------------------------------------------------
  listGroups() {
    return (this.automation.autostartGroups || []).slice();
  }

  saveGroups() {
    store.save(AUTOMATION_STORE, this.automation);
  }

  createGroup(input) {
    const { name, enabled, startDelayMs, instanceDelayMs, instances } = input || {};
    if (!name) throw new Error('组名不能为空');
    const group = {
      id: crypto.randomUUID(),
      name: String(name).slice(0, 64),
      enabled: enabled !== false,
      startDelayMs: Math.max(0, Number(startDelayMs) || 0),
      instanceDelayMs: Math.max(0, Number(instanceDelayMs) || 8000),
      instances: Array.isArray(instances)
        ? instances.map((i) => ({ daemonId: String(i.daemonId), uuid: String(i.uuid) }))
        : []
    };
    this.automation.autostartGroups.push(group);
    this.saveGroups();
    return group;
  }

  updateGroup(id, patch) {
    const g = this.automation.autostartGroups.find((x) => x.id === id);
    if (!g) throw new Error('组不存在');
    if (patch.name !== undefined) g.name = String(patch.name).slice(0, 64);
    if (patch.enabled !== undefined) g.enabled = !!patch.enabled;
    if (patch.startDelayMs !== undefined) g.startDelayMs = Math.max(0, Number(patch.startDelayMs) || 0);
    if (patch.instanceDelayMs !== undefined) g.instanceDelayMs = Math.max(0, Number(patch.instanceDelayMs) || 8000);
    if (Array.isArray(patch.instances)) {
      g.instances = patch.instances.map((i) => ({ daemonId: String(i.daemonId), uuid: String(i.uuid) }));
    }
    this.saveGroups();
    return g;
  }

  deleteGroup(id) {
    const before = this.automation.autostartGroups.length;
    this.automation.autostartGroups = this.automation.autostartGroups.filter((x) => x.id !== id);
    if (this.automation.autostartGroups.length === before) throw new Error('组不存在');
    this.saveGroups();
  }

  /** 面板启动后触发启用的自启组（错峰）。 */
  startAutostartGroupsSoon() {
    for (const group of this.automation.autostartGroups || []) {
      if (!group.enabled) continue;
      const delay = Math.max(0, Number(group.startDelayMs) || 0);
      this.timers.push(setTimeout(() => this.runGroup(group.id), delay));
    }
  }

  /** 手动/自动触发某自启组。 */
  async runGroup(id) {
    const g = this.automation.autostartGroups.find((x) => x.id === id);
    if (!g) return { ok: false, error: '组不存在' };
    this.logOperation('auto', '自启组', `触发组「${g.name}」（${(g.instances || []).length} 个实例）`);
    const started = [];
    const skipped = [];
    const failed = [];
    const step = Math.max(0, Number(g.instanceDelayMs) || 8000);
    const jobs = [];
    let delay = 0;
    for (const inst of g.instances || []) {
      jobs.push(new Promise((resolve) => {
        setTimeout(async () => {
          try {
            const status = await this.getInstanceStatus(inst.daemonId, inst.uuid);
            if (status === STATUS_RUNNING) {
              skipped.push(inst.uuid);
            } else {
              await this.instanceAction(inst.daemonId, inst.uuid, 'open');
              started.push(inst.uuid);
            }
          } catch (e) {
            failed.push(`${inst.uuid}: ${e.message}`);
          }
          resolve();
        }, delay);
      }));
      delay += step;
    }
    await Promise.all(jobs);
    return { ok: true, started, skipped, failed };
  }

  /** 立即按实例快照核对自启组状态（供手动刷新）。 */
  async refreshGroupStatus() {
    const snapshot = this.lastSnapshot;
    const list = [];
    for (const g of this.automation.autostartGroups || []) {
      const items = [];
      for (const inst of g.instances || []) {
        const found = snapshot.find((s) => s.daemonId === inst.daemonId && s.uuid === inst.uuid);
        items.push({ daemonId: inst.daemonId, uuid: inst.uuid, status: found ? found.status : '未知' });
      }
      list.push({ ...g, items });
    }
    return list;
  }
}

/** 校验并规范化定时任务动作。 */
function normalizeAction(action) {
  const act = action || {};
  const type = String(act.type || '');
  if (!['start', 'stop', 'restart', 'command'].includes(type)) {
    throw new Error(`非法动作类型: ${type || '(空)'}`);
  }
  const out = { type, daemonId: String(act.daemonId || ''), uuid: String(act.uuid || '') };
  if (type === 'command') {
    if (!act.command) throw new Error('command 内容不能为空');
    out.command = String(act.command);
  }
  if (!out.daemonId || !out.uuid) throw new Error('daemonId / uuid 不能为空');
  return out;
}

module.exports = { AutomationEngine, DEFAULT_AUTOMATION };
