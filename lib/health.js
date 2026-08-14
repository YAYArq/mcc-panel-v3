'use strict';

/**
 * lib/health.js — 实例健康监控与消息统计（数据持久化到 data/health.json）。
 *
 * 由自动化引擎周期性调用 updateFromSnapshot()（MCSM 实例快照）驱动，
 * 记录每个实例的：
 *   - 在线时长（累计秒数 + 最长在线秒数 + 当前连续在线）
 *   - 重启次数（状态 stopped -> running 计数）
 *   - 掉线次数 / 最后掉线时间 / 最后自动重连时间
 *   - 消息统计（今日/累计，以及按天历史，保留 30 天）
 *
 * 消息统计由引擎在解析实例日志时调用 recordMessages() 增量累计，
 * 前端「健康监控」面板直接读取。
 */

const store = require('./store');

const STORE_NAME = 'health.json';
const DAYS_KEEP = 30; // 按天历史保留天数

function keyOf(daemonId, uuid) {
  return String(daemonId) + '::' + String(uuid);
}

/** 服务器本地日期 YYYY-MM-DD。 */
function todayStr(d) {
  const dt = d || new Date();
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** MCSM 实例状态码（与面板前端 STATUS 常量一致）。 */
const STATUS_RUNNING = '3'; // 运行中
const STATUS_STOPPED = '0'; // 已停止

class HealthTracker {
  constructor() {
    this.data = {
      instances: {}, // key -> 实例统计
      statsByDay: {} // "YYYY-MM-DD" -> { messages, commands }
    };
    this.load();
  }

  load() {
    const saved = store.load(STORE_NAME, null);
    if (saved && typeof saved === 'object') {
      this.data.instances = (saved.instances && typeof saved.instances === 'object') ? saved.instances : {};
      this.data.statsByDay = (saved.statsByDay && typeof saved.statsByDay === 'object') ? saved.statsByDay : {};
    }
  }

  save() {
    store.save(STORE_NAME, this.data);
  }

  /**
   * 用 MCSM 实例快照更新统计（状态机）。
   * @param {Array} snapshot [{ daemonId, uuid, nickname, status }]
   */
  updateFromSnapshot(snapshot) {
    const now = Date.now();
    const list = Array.isArray(snapshot) ? snapshot : [];
    for (const item of list) {
      if (!item || !item.uuid) continue;
      const key = keyOf(item.daemonId, item.uuid);
      const status = String(item.status == null ? '' : item.status);
      const prev = this.data.instances[key];
      if (!prev) {
        // 新实例：首次出现
        this.data.instances[key] = {
          daemonId: String(item.daemonId || ''),
          uuid: String(item.uuid),
          nickname: String(item.nickname || item.name || ''),
          firstSeen: now,
          status,
          onlineSince: status === STATUS_RUNNING ? now : null,
          lastOnlineEnd: null,
          onlineSeconds: 0,
          maxOnlineSeconds: 0,
          restarts: 0,
          lastRestartAt: null,
          disconnects: 0,
          lastDisconnectAt: null,
          lastRecoAt: null,
          lastActiveAt: now,
          todayMessages: 0,
          todayCommands: 0,
          todayDate: todayStr(),
          totalMessages: 0,
          totalCommands: 0
        };
        continue;
      }

      // 状态变化：running -> 非 running：结算在线时长
      if (prev.status === STATUS_RUNNING && status !== STATUS_RUNNING) {
        if (prev.onlineSince) {
          const seconds = Math.floor((now - prev.onlineSince) / 1000);
          prev.onlineSeconds += seconds;
          if (prev.onlineSeconds > prev.maxOnlineSeconds) prev.maxOnlineSeconds = prev.onlineSeconds;
          prev.onlineSince = null;
          prev.lastOnlineEnd = now;
        }
      }
      // 状态变化：非 running -> running：开始计时，且判定为一次重启
      if (prev.status && prev.status !== STATUS_RUNNING && status === STATUS_RUNNING) {
        prev.onlineSince = now;
        prev.restarts = (prev.restarts || 0) + 1;
        prev.lastRestartAt = now;
        prev.lastActiveAt = now;
      }
      prev.status = status;
      prev.nickname = String(item.nickname || item.name || prev.nickname || '');
      prev.daemonId = String(item.daemonId || prev.daemonId || '');
      prev.uuid = String(item.uuid);
      // 每日统计滚动
      if (prev.todayDate !== todayStr()) {
        prev.todayDate = todayStr();
        prev.todayMessages = 0;
        prev.todayCommands = 0;
      }
    }
    // 清理已不存在的实例？保留（历史统计有价值），由 reset 显式清空。
    this.save();
  }

  /**
   * 累计消息/命令统计。
   * @param {string} daemonId
   * @param {string} uuid
   * @param {object} delta { messages: number, commands: number }
   * @param {string} [nickname]
   */
  recordMessages(daemonId, uuid, delta, nickname) {
    const key = keyOf(daemonId, uuid);
    const inst = this.data.instances[key];
    const d = delta || {};
    const msgs = Number(d.messages) || 0;
    const cmds = Number(d.commands) || 0;
    if (msgs === 0 && cmds === 0) return;

    if (inst) {
      inst.todayMessages = (inst.todayMessages || 0) + msgs;
      inst.todayCommands = (inst.todayCommands || 0) + cmds;
      inst.totalMessages = (inst.totalMessages || 0) + msgs;
      inst.totalCommands = (inst.totalCommands || 0) + cmds;
      inst.lastActiveAt = Date.now();
    }

    // 按天历史（无论实例是否在列表中，都记录）
    const dateStr = todayStr();
    const day = this.data.statsByDay[dateStr] || { messages: 0, commands: 0 };
    day.messages += msgs;
    day.commands += cmds;
    this.data.statsByDay[dateStr] = day;

    // 清理超出保留天数的历史
    const dates = Object.keys(this.data.statsByDay).sort();
    while (dates.length > DAYS_KEEP) {
      delete this.data.statsByDay[dates.shift()];
    }
    this.save();
  }

  /** 记录一次掉线。 */
  recordDisconnect(daemonId, uuid) {
    const key = keyOf(daemonId, uuid);
    const inst = this.data.instances[key];
    if (inst) {
      inst.disconnects = (inst.disconnects || 0) + 1;
      inst.lastDisconnectAt = Date.now();
      this.save();
    }
  }

  /** 记录一次自动重连（/reco 或重启）。 */
  recordReco(daemonId, uuid) {
    const key = keyOf(daemonId, uuid);
    const inst = this.data.instances[key];
    if (inst) {
      inst.lastRecoAt = Date.now();
      this.save();
    }
  }

  /** 当前连续在线秒数（运行中时实时计算）。 */
  currentOnlineSeconds(key) {
    const inst = this.data.instances[key];
    if (!inst) return 0;
    if (inst.status === STATUS_RUNNING && inst.onlineSince) {
      return inst.onlineSeconds + Math.floor((Date.now() - inst.onlineSince) / 1000);
    }
    return inst.onlineSeconds || 0;
  }

  /**
   * 获取全部实例的健康统计列表（含实时在线时长）。
   * @returns {Array}
   */
  getList() {
    const now = Date.now();
    return Object.keys(this.data.instances).map((key) => {
      const it = this.data.instances[key];
      const onlineNow = it.status === STATUS_RUNNING && it.onlineSince ? Math.floor((now - it.onlineSince) / 1000) : 0;
      return {
        key,
        daemonId: it.daemonId,
        uuid: it.uuid,
        nickname: it.nickname,
        status: it.status,
        firstSeen: it.firstSeen,
        onlineSeconds: it.onlineSeconds + onlineNow,
        maxOnlineSeconds: Math.max(it.maxOnlineSeconds || 0, it.onlineSeconds + onlineNow),
        restarts: it.restarts || 0,
        lastRestartAt: it.lastRestartAt,
        disconnects: it.disconnects || 0,
        lastDisconnectAt: it.lastDisconnectAt,
        lastRecoAt: it.lastRecoAt,
        lastActiveAt: it.lastActiveAt,
        todayMessages: it.todayMessages || 0,
        todayCommands: it.todayCommands || 0,
        totalMessages: it.totalMessages || 0,
        totalCommands: it.totalCommands || 0
      };
    });
  }

  /** 消息统计汇总（按天）。 */
  getStats() {
    const dates = Object.keys(this.data.statsByDay || {}).sort();
    const byDay = dates.map((date) => ({
      date,
      messages: (this.data.statsByDay[date] || {}).messages || 0,
      commands: (this.data.statsByDay[date] || {}).commands || 0
    }));
    let totalMessages = 0;
    let totalCommands = 0;
    for (const d of byDay) { totalMessages += d.messages; totalCommands += d.commands; }
    const today = this.data.statsByDay[todayStr()] || { messages: 0, commands: 0 };
    return {
      byDay,
      todayMessages: today.messages || 0,
      todayCommands: today.commands || 0,
      totalMessages,
      totalCommands
    };
  }

  /** 清空全部健康统计。 */
  reset() {
    this.data = { instances: {}, statsByDay: {} };
    this.save();
  }
}

module.exports = { HealthTracker, keyOf, todayStr };
