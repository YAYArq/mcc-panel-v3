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
  listPollIntervalMs: 4000
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
        users: Array.isArray(parsed.users) ? parsed.users : []
      };
    }
  }

  config.mcsm.url = String(config.mcsm.url || '').trim().replace(/\/+$/, '');
  config.mcsm.apikey = String(config.mcsm.apikey || '').trim();

  // 未配置 users 时，回退到单口令（authToken），保证兼容
  return { config, configPath: resolved };
}

module.exports = { loadConfig, DEFAULT_CONFIG };
