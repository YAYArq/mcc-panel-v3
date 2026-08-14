'use strict';

/**
 * lib/cron.js — 标准 5 字段 cron 表达式解析与匹配（零第三方依赖）。
 *
 * 语法（与 crontab 一致，5 个字段，空格分隔）：
 *   ┌──────────── 分 (0-59)
 *   │ ┌────────── 时 (0-23)
 *   │ │ ┌──────── 日 (1-31)
 *   │ │ │ ┌────── 月 (1-12)
 *   │ │ │ │ ┌──── 周 (0-7，0 与 7 均为周日)
 *   │ │ │ │ │
 *   * * * * *
 *
 * 每个字段支持：
 *   - `*`         任意值
 *   - `* / n`     每 n 个单位
 *   - `a-b`       范围
 *   - `a,b,c`     列表
 *   - `a-b / n`   范围内每 n 个单位（写法为 a-b/n）
 *
 * 匹配语义：5 个字段全部匹配（AND）。对绝大多数使用场景（如
 * 「每天 03:00」= `0 3 * * *`）与标准 cron 一致；仅当同时限定
 * 「日」和「周」时行为与 crontab 的 OR 语义不同，本项目统一按
 * AND 处理并在 README 中说明。
 *
 * 时区：使用服务器本地时间（与 MCSM / 面板所在主机一致）。
 */

/**
 * 解析单个字段。
 * @param {string} field 原始字段文本
 * @param {number} min 最小值
 * @param {number} max 最大值
 * @returns {number[]} 命中的值集合；解析失败返回 null
 */
function parseField(field, min, max) {
  const text = String(field || '').trim();
  if (text === '') return null;
  const values = new Set();

  for (const part of text.split(',')) {
    const p = part.trim();
    if (p === '') return null;
    // 通配 *
    if (p === '*') {
      for (let v = min; v <= max; v++) values.add(v);
      continue;
    }
    let m;
    // */n
    if ((m = /^\*\/(\d+)$/.exec(p))) {
      const step = parseInt(m[1], 10);
      if (step <= 0) return null;
      for (let v = min; v <= max; v += step) values.add(v);
      continue;
    }
    // a-b/n 或 a-b
    if ((m = /^(\d+)-(\d+)(?:\/(\d+))?$/.exec(p))) {
      const a = parseInt(m[1], 10);
      const b = parseInt(m[2], 10);
      const step = m[3] ? parseInt(m[3], 10) : 1;
      if (a < min || b > max || a > b || step <= 0) return null;
      for (let v = a; v <= b; v += step) values.add(v);
      continue;
    }
    // 单个值（含周字段 7 -> 0）
    if (/^\d+$/.test(p)) {
      let v = parseInt(p, 10);
      if (v < min || v > max) return null;
      if (max === 7 && v === 7) v = 0; // 周字段 7 视为周日
      values.add(v);
      continue;
    }
    return null;
  }
  // 周字段：把 7（周日）归一化为 0，保证集合去重
  if (max === 7 && values.has(7)) {
    values.delete(7);
    values.add(0);
  }
  return Array.from(values);
}

/**
 * 解析完整 cron 表达式。
 * @param {string} expr 如 "0 3 * * *"
 * @returns {object|null} { minute[], hour[], day[], month[], dow[] } 或 null（非法）
 */
function parse(expr) {
  const parts = String(expr || '').trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const minute = parseField(parts[0], 0, 59);
  const hour = parseField(parts[1], 0, 23);
  const day = parseField(parts[2], 1, 31);
  const month = parseField(parts[3], 1, 12);
  const dow = parseField(parts[4], 0, 7); // 内部已把 7 归一为 0
  if (minute === null || hour === null || day === null || month === null || dow === null) return null;
  return { minute, hour, day, month, dow };
}

/**
 * 判断给定时间是否命中 cron 表达式。
 * @param {string} expr cron 表达式
 * @param {Date} [date] 目标时间（默认当前时间）
 * @returns {boolean}
 */
function matches(expr, date) {
  const cron = typeof expr === 'string' ? parse(expr) : expr;
  if (!cron) return false;
  const d = date || new Date();
  const minute = d.getMinutes();
  const hour = d.getHours();
  const day = d.getDate();
  const month = d.getMonth() + 1; // 1-12
  const dow = d.getDay(); // 0-6
  return cron.minute.includes(minute) &&
    cron.hour.includes(hour) &&
    cron.day.includes(day) &&
    cron.month.includes(month) &&
    cron.dow.includes(dow);
}

/** 判断表达式是否合法（供前端表单校验与后端保存校验）。 */
function isValid(expr) {
  return parse(expr) !== null;
}

/** 生成一段人类可读描述（用于 UI 展示，尽力而为的简化翻译）。 */
function describe(expr) {
  const cron = typeof expr === 'string' ? parse(expr) : expr;
  if (!cron) return '非法表达式';
  const fmtSet = (s) => (s.length === 0 ? '-' : s.join(','));
  const isAll = (s, min, max) => s.length === max - min + 1;
  const parts = [];
  // 分/时
  if (isAll(cron.minute, 0, 59) && isAll(cron.hour, 0, 23)) {
    parts.push('每分钟');
  } else if (isAll(cron.hour, 0, 23)) {
    const mins = cron.minute.slice(0, 8).join(',');
    parts.push(`每小时的第 ${mins} 分`);
  } else if (cron.minute.length === 1 && cron.hour.length === 1) {
    parts.push(`每天 ${String(cron.hour[0]).padStart(2, '0')}:${String(cron.minute[0]).padStart(2, '0')}`);
  } else {
    parts.push(`分(${fmtSet(cron.minute)}) 时(${fmtSet(cron.hour)})`);
  }
  // 日/月/周
  const DOW_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  if (!isAll(cron.month, 1, 12)) parts.push(`月份:${fmtSet(cron.month)}`);
  if (!isAll(cron.day, 1, 31) && isAll(cron.dow, 0, 6)) parts.push(`日期:${fmtSet(cron.day)}`);
  if (!isAll(cron.dow, 0, 6)) parts.push(cron.dow.map((w) => DOW_NAMES[w]).join(','));
  return parts.join('，') || '每分钟';
}

/** 下一个触发时间（用于 UI 提示「下次执行时间」）。 */
function nextRun(expr, from) {
  const cron = typeof expr === 'string' ? parse(expr) : expr;
  if (!cron) return null;
  const start = from || new Date();
  const probe = new Date(start);
  // 从下一分钟开始探测，最多向后扫 366 天，避免死循环
  probe.setSeconds(0, 0);
  probe.setMinutes(probe.getMinutes() + 1);
  const limit = 366 * 24 * 60;
  for (let i = 0; i < limit; i++) {
    if (matches(cron, probe)) return new Date(probe);
    probe.setMinutes(probe.getMinutes() + 1);
  }
  return null;
}

module.exports = { parse, matches, isValid, describe, nextRun };
