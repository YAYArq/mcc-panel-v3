'use strict';

const http = require('http');
const https = require('https');

/**
 * MCSManager Panel API 客户端（零依赖）。
 * 所有请求自动附加 apikey 与 MCSM 要求的请求头，并解析响应。
 */
class McsmClient {
  constructor({ url, apikey, timeoutMs = 15000 }) {
    this.baseUrl = String(url || '').trim().replace(/\/+$/, '');
    this.apikey = String(apikey || '').trim();
    this.timeoutMs = timeoutMs;
    if (!this.baseUrl) throw new Error('MCSM url 未配置');
  }

  /**
   * 发送请求。
   * @param {string} method HTTP 方法
   * @param {string} path 相对路径，例如 "/api/instance"
   * @param {object} [query] 附加到 query string 的参数
   * @param {object} [body] JSON body（若提供则发送）
   * @returns {Promise<{httpStatus:number, status:number, data:any, error:string|null, raw:any}>}
   */
  request(method, path, query = {}, body = null) {
    const parsed = new URL(this.baseUrl + '/' + String(path).replace(/^\/+/, ''));
    parsed.searchParams.set('apikey', this.apikey);
    for (const [key, value] of Object.entries(query || {})) {
      // MCSM 文档要求「即使参数未定义也要提交」，空字符串也需透传
      // （例如 files/list 的 file_name 缺省会变成 "undefined" 导致过滤异常）
      if (value === undefined || value === null) continue;
      parsed.searchParams.set(key, String(value));
    }

    const payload = body === null ? null : Buffer.from(JSON.stringify(body), 'utf8');
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;

    const options = {
      method: method.toUpperCase(),
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/json'
      }
    };
    if (payload) {
      options.headers['Content-Length'] = payload.length;
    }

    return new Promise((resolve, reject) => {
      const req = lib.request(options, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          resolve(this._normalizeResponse(res.statusCode, raw));
        });
      });

      req.setTimeout(this.timeoutMs, () => {
        req.destroy(new Error('MCSM 请求超时'));
      });
      req.on('error', (error) => {
        reject(new Error(`无法连接 MCSM (${this.baseUrl}): ${error.message}`));
      });

      if (payload) req.write(payload);
      req.end();
    });
  }

  _normalizeResponse(httpStatus, raw) {
    let parsed = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch (error) {
      parsed = null;
    }

    // MCSM 统一响应协议为 { status, data, time }；失败时 data 为错误消息字符串。
    if (parsed && typeof parsed === 'object' && 'status' in parsed) {
      const isOk = parsed.status === 200;
      let error = null;
      if (!isOk) {
        error = typeof parsed.data === 'string' ? parsed.data : `MCSM 返回状态 ${parsed.status}`;
      }
      return {
        httpStatus,
        status: parsed.status,
        data: parsed.data !== undefined ? parsed.data : null,
        error,
        raw: parsed
      };
    }

    // 未解析或非标准结构：httpStatus 非 2xx 视为错误。
    return {
      httpStatus,
      status: httpStatus >= 200 && httpStatus < 300 ? 200 : httpStatus,
      data: parsed !== null ? parsed : (raw || null),
      error: httpStatus >= 200 && httpStatus < 300 ? null : (raw || `HTTP ${httpStatus}`),
      raw
    };
  }
}

module.exports = { McsmClient };
