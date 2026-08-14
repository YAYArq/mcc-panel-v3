'use strict';

/**
 * lib/avatar.js — 正版玩家头像服务（零第三方依赖）。
 *
 * 实现思路参考 APRme/MULTIBOT_PANEL（已与作者沟通）：
 *   - 面板 CSP 的 img-src 只允许同源与 data:，外部头像源会被浏览器拦截，
 *     因此头像必须由后端代理：用户名 -> Mojang API 查 UUID -> 取皮肤 URL -> 下载皮肤 PNG 返回
 *   - 两级缓存（用户名->皮肤URL 24h / 皮肤字节 24h）+ 失败冷却（5 分钟）+ 并发合并
 *   - 前端拿到的是一张完整皮肤 PNG，由前端 canvas 裁剪成 40x40 头像（见 app.js）
 */

const LOOKUP_API_URL = 'https://api.minecraftservices.com/minecraft/profile/lookup/name/';
const PROFILE_API_URL = 'https://sessionserver.mojang.com/session/minecraft/profile/';
const USERNAME_PATTERN = /^[A-Za-z0-9_]{1,16}$/;

const DEFAULT_OPTIONS = {
  lookupTtlMs: 24 * 60 * 60 * 1000,   // 用户名 -> 皮肤 URL 缓存时长
  skinTtlMs: 24 * 60 * 60 * 1000,     // 皮肤 PNG 字节缓存时长
  failureTtlMs: 5 * 60 * 1000,        // 查询失败冷却（防打爆 Mojang）
  fetchTimeoutMs: 15000               // 上游请求超时
};

/** 判断用户名是否合法（MC 正版名规则）。 */
function isValidUsername(username) {
  return USERNAME_PATTERN.test(String(username || '').trim());
}

/** http 皮肤 URL 强制转 https。 */
function normalizeSkinUrl(url) {
  const text = String(url || '').trim();
  if (!text) return '';
  if (text.startsWith('http://')) return 'https://' + text.slice('http://'.length);
  return text;
}

/** 从 session profile 的 base64 textures 中解出皮肤 URL。 */
function decodeSkinTextures(base64Value) {
  if (!base64Value || typeof base64Value !== 'string') return '';
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(base64Value, 'base64').toString('utf8'));
  } catch (error) {
    return '';
  }
  const url = parsed && parsed.textures && parsed.textures.SKIN && parsed.textures.SKIN.url;
  return normalizeSkinUrl(url);
}

/** 带超时的 Promise。 */
function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('avatar fetch timeout')), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * 创建头像服务实例。
 * @returns {{ getSkinPng: (username:string)=>Promise<Buffer>, getStats: ()=>object, clearCache: ()=>void }}
 */
function createAvatarService(options = {}) {
  const fetcher = options.fetcher || globalThis.fetch;
  const now = options.now || (() => Date.now());
  const lookupTtlMs = options.lookupTtlMs || DEFAULT_OPTIONS.lookupTtlMs;
  const skinTtlMs = options.skinTtlMs || DEFAULT_OPTIONS.skinTtlMs;
  const failureTtlMs = options.failureTtlMs || DEFAULT_OPTIONS.failureTtlMs;
  const fetchTimeoutMs = options.fetchTimeoutMs || DEFAULT_OPTIONS.fetchTimeoutMs;

  const skinUrlCache = new Map();   // 用户名 -> { skinUrl, expiresAt }
  const skinBytesCache = new Map(); // 皮肤URL -> { bytes, expiresAt }
  const failureCache = new Map();   // 用户名 -> expiresAt（失败冷却）
  const inflight = new Map();       // 用户名 -> 进行中的 Promise（并发合并）

  async function fetchJson(url, timestamp) {
    let response;
    try {
      response = await withTimeout(fetcher(url, { headers: { accept: 'application/json' } }), fetchTimeoutMs);
    } catch (error) {
      throw Object.assign(new Error('upstream_error: ' + error.message), { status: 502 });
    }
    if (response.status === 404) throw Object.assign(new Error('not_found'), { status: 404 });
    if (response.status === 429) throw Object.assign(new Error('rate_limited'), { status: 503 });
    if (!response.ok) throw Object.assign(new Error('upstream_error: HTTP ' + response.status), { status: 502 });
    try {
      return await response.json();
    } catch (error) {
      throw Object.assign(new Error('upstream_error: bad json'), { status: 502 });
    }
  }

  async function fetchSkinUrl(name, timestamp) {
    const lookup = await fetchJson(LOOKUP_API_URL + encodeURIComponent(name), timestamp);
    const uuid = lookup && lookup.id;
    if (!uuid) throw Object.assign(new Error('not_found'), { status: 404 });
    const profile = await fetchJson(PROFILE_API_URL + uuid, timestamp);
    const properties = profile && Array.isArray(profile.properties) ? profile.properties : [];
    const skinUrl = decodeSkinTextures(properties[0] && properties[0].value);
    if (!skinUrl) throw Object.assign(new Error('not_found'), { status: 404 });
    skinUrlCache.set(name, { skinUrl, expiresAt: timestamp + lookupTtlMs });
    return skinUrl;
  }

  async function fetchSkinBytes(skinUrl) {
    let response;
    try {
      response = await withTimeout(fetcher(skinUrl), fetchTimeoutMs);
    } catch (error) {
      throw Object.assign(new Error('upstream_error: ' + error.message), { status: 502 });
    }
    if (!response.ok) throw Object.assign(new Error('upstream_error: HTTP ' + response.status), { status: 502 });
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) throw Object.assign(new Error('upstream_error: empty'), { status: 502 });
    return buffer;
  }

  async function resolveSkin(name, timestamp) {
    const cachedUrl = skinUrlCache.get(name);
    const skinUrl = cachedUrl && cachedUrl.expiresAt > timestamp
      ? cachedUrl.skinUrl
      : await fetchSkinUrl(name, timestamp);

    const cachedBytes = skinBytesCache.get(skinUrl);
    if (cachedBytes && cachedBytes.expiresAt > timestamp) return cachedBytes.bytes;

    const bytes = await fetchSkinBytes(skinUrl);
    skinBytesCache.set(skinUrl, { bytes, expiresAt: timestamp + skinTtlMs });
    return bytes;
  }

  async function getSkinPng(username) {
    const name = String(username || '').trim();
    if (!isValidUsername(name)) throw Object.assign(new Error('invalid_username'), { status: 400 });

    const timestamp = now();
    const failed = failureCache.get(name);
    if (failed && failed.expiresAt > timestamp) throw Object.assign(new Error('not_found'), { status: 404 });

    if (inflight.has(name)) return inflight.get(name);

    const pending = resolveSkin(name, timestamp)
      .catch((error) => {
        failureCache.set(name, { expiresAt: timestamp + failureTtlMs });
        throw error;
      })
      .finally(() => inflight.delete(name));
    inflight.set(name, pending);
    return pending;
  }

  return {
    getSkinPng,
    getStats: () => ({
      skinUrlEntries: skinUrlCache.size,
      skinBytesEntries: skinBytesCache.size,
      failureEntries: failureCache.size,
      inflight: inflight.size
    }),
    clearCache: () => {
      skinUrlCache.clear();
      skinBytesCache.clear();
      failureCache.clear();
    }
  };
}

module.exports = {
  LOOKUP_API_URL,
  PROFILE_API_URL,
  DEFAULT_OPTIONS,
  isValidUsername,
  normalizeSkinUrl,
  decodeSkinTextures,
  createAvatarService
};
