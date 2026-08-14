'use strict';

/**
 * lib/store.js — v3 数据持久化（JSON 文件，零第三方依赖）。
 *
 * 数据统一存放于 <项目根>/data/ 目录：
 *   - data/health.json    实例健康监控统计（在线时长/重启次数/消息数）
 *   - data/schedules.json 定时任务（cron 风格）
 *   - data/automation.json 自动化配置（掉线检测/防AFK/自启组）
 *   - data/logs.jsonl     操作日志持久化（JSONL 追加写，避免全量重写）
 *
 * 所有写操作均采用「写临时文件 + rename」原子替换，避免中途断电/崩溃
 * 导致数据文件损坏。
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/** 将逻辑文件名映射到安全路径，防止路径穿越。 */
function filePath(name) {
  const safe = String(name || '').replace(/[^a-zA-Z0-9._-]/g, '_') || 'data';
  return path.join(DATA_DIR, safe);
}

/** 读取 JSON 文件；不存在或损坏时返回 fallback（默认值）。 */
function load(name, fallback) {
  try {
    const raw = fs.readFileSync(filePath(name), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed === undefined || parsed === null ? fallback : parsed;
  } catch (e) {
    return fallback;
  }
}

/** 原子写入 JSON 文件（先写 .tmp 再 rename）。 */
function save(name, data) {
  ensureDataDir();
  const fp = filePath(name);
  const tmp = fp + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, fp);
}

/**
 * JSONL 追加写（用于高频日志类数据）。
 * @param {string} name 逻辑文件名（如 logs.jsonl -> data/logs.jsonl）
 * @param {object} entry 追加的一行对象
 */
function appendLine(name, entry) {
  ensureDataDir();
  const fp = filePath(name);
  fs.appendFileSync(fp, JSON.stringify(entry) + '\n', 'utf8');
}

/**
 * 读取 JSONL 全部记录（按写入顺序）。
 * @param {string} name 逻辑文件名
 * @param {number} [max] 最多保留条数（超出取最后 max 条）
 */
function readLines(name, max) {
  try {
    const raw = fs.readFileSync(filePath(name), 'utf8');
    const lines = raw.split('\n').filter((l) => l.trim());
    const parsed = [];
    for (const line of lines) {
      try { parsed.push(JSON.parse(line)); } catch (e) { /* 跳过损坏行 */ }
    }
    if (max && parsed.length > max) return parsed.slice(parsed.length - max);
    return parsed;
  } catch (e) {
    return [];
  }
}

/**
 * 截断 JSONL 文件，只保留最后 keep 条（超出上限时压缩体积）。
 */
function truncateLines(name, keep) {
  const lines = readLines(name, keep);
  const fp = filePath(name);
  fs.writeFileSync(fp, lines.map((l) => JSON.stringify(l)).join('\n') + (lines.length ? '\n' : ''), 'utf8');
}

/** 删除数据文件（谨慎使用）。 */
function remove(name) {
  try { fs.rmSync(filePath(name), { force: true }); } catch (e) { /* 忽略 */ }
}

module.exports = {
  DATA_DIR,
  ensureDataDir,
  load,
  save,
  appendLine,
  readLines,
  truncateLines,
  remove
};
