'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG = {
  host: '127.0.0.1',
  port: 18082,
  title: 'MCC Bot Panel',
  authToken: '',
  users: [],
  mcsm: {
    url: 'http://127.0.0.1:23333',
    apikey: '',
    timeoutMs: 15000,
    daemonContainer: ''
  },
  logPollIntervalMs: 2000,
  listPollIntervalMs: 4000,
  // ---- v3 增强（自动化引擎等）----
  v3: {
    enabled: true,               // 自动化引擎总开关（健康监控/掉线检测/防AFK/定时任务）
    healthPollIntervalMs: 15000  // 健康/掉线检测轮询间隔（毫秒）
  },
  // ---- 安全增强 ----
  ipWhitelistEnabled: false,     // 启用 IP 白名单后，仅白名单内 IP 可访问面板
  ipWhitelist: [],               // 允许访问的 IP 列表，如 ["127.0.0.1", "1.2.3.4"]
  trustProxy: false              // 面板位于反向代理后时置为 true（取 X-Forwarded-For 首个 IP）
};

function loadConfig(configPath) {
  const resolved = configPath ? path.resolve(configPath) : path.join(__dirname, '..', 'panel.config.json');
  let config = { ...DEFAULT_CONFIG };

  if (fs.existsSync(resolved)) {
    let parsed = null;
    try {
      parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
    } catch (error) {
      throw new Error(`配置文件解析失败: ${resolved} - ${error.message}`);
    }
    if (parsed && typeof parsed === 'object') {
      config = {
        ...DEFAULT_CONFIG,
        ...parsed,
        mcsm: { ...DEFAULT_CONFIG.mcsm, ...(parsed.mcsm || {}) },
        v3: { ...DEFAULT_CONFIG.v3, ...(parsed.v3 || {}) },
        users: Array.isArray(parsed.users) ? parsed.users : [],
        ipWhitelist: Array.isArray(parsed.ipWhitelist) ? parsed.ipWhitelist : []
      };
    }
  }

  config.mcsm.url = String(config.mcsm.url || '').trim().replace(/\/+$/, '');
  config.mcsm.apikey = String(config.mcsm.apikey || '').trim();

  // 未配置 users 时，回退到单口令（authToken），保证兼容
  return { config, configPath: resolved };
}

module.exports = { loadConfig, DEFAULT_CONFIG };
