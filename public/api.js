(function (global) {
  'use strict';

  const namespace = global.MccPanel = global.MccPanel || {};

  const SESSION_KEY = 'mcc_panel_session';
  let sessionToken = localStorage.getItem(SESSION_KEY) || '';

  function setSession(token) {
    sessionToken = token || '';
    if (sessionToken) localStorage.setItem(SESSION_KEY, sessionToken);
    else localStorage.removeItem(SESSION_KEY);
  }

  function getSession() {
    return sessionToken;
  }

  async function request(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (sessionToken) headers['Authorization'] = 'Bearer ' + sessionToken;

    const options = { method, headers };
    if (body !== undefined) options.body = JSON.stringify(body);

    let response;
    try {
      response = await fetch(path, options);
    } catch (error) {
      throw new ApiError('网络错误，无法连接面板服务', 0);
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      payload = null;
    }

    if (response.status === 401) {
      setSession('');
      throw new ApiError(payload && payload.error ? payload.error : '未登录', 401, { authRequired: true });
    }
    if (!response.ok) {
      throw new ApiError((payload && payload.error) || `请求失败 (${response.status})`, response.status, payload);
    }
    return payload;
  }

  function ApiError(message, status, extra) {
    const err = new Error(message);
    err.name = 'ApiError';
    err.status = status;
    Object.assign(err, extra || {});
    return err;
  }

  const api = {
    // ---- 认证 ----
    async login(username, password) {
      const r = await request('POST', '/api/auth/login', { username, password });
      setSession(r.token || '');
      return r;
    },
    async logout() {
      try { await request('POST', '/api/auth/logout'); } catch (e) { /* 忽略 */ }
      setSession('');
    },
    async authStatus() {
      return request('GET', '/api/auth/status');
    },
    async config() {
      return request('GET', '/api/config');
    },

    // ---- MCSM 代理 ----
    async daemons() {
      return request('GET', '/api/daemons');
    },
    async daemonSystem() {
      return request('GET', '/api/daemon-system');
    },
    async instances(params) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(params || {})) {
        if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
      }
      return request('GET', '/api/instances?' + qs.toString());
    },
    async instance(daemonId, uuid) {
      return request('GET', '/api/instance?' + new URLSearchParams({ daemonId, uuid }));
    },
    async action(daemonId, uuid, action) {
      return request('POST', '/api/instance/action', { daemonId, uuid, action });
    },
    async command(daemonId, uuid, command) {
      return request('POST', '/api/instance/command', { daemonId, uuid, command });
    },
    async outputlog(daemonId, uuid, size) {
      const qs = new URLSearchParams({ daemonId, uuid });
      if (size) qs.set('size', String(size));
      return request('GET', '/api/instance/outputlog?' + qs.toString());
    },
    async updateConfig(daemonId, uuid, config) {
      return request('PUT', '/api/instance/config', { daemonId, uuid, config });
    },
    async fileList(daemonId, uuid, target) {
      const qs = new URLSearchParams({ daemonId, uuid, target: target || '/' });
      return request('GET', '/api/files/list?' + qs.toString());
    },
    async fileRead(daemonId, uuid, target) {
      return request('GET', '/api/files/read?' + new URLSearchParams({ daemonId, uuid, target }));
    },
    async fileWrite(daemonId, uuid, target, text) {
      return request('POST', '/api/files/write', { daemonId, uuid, target, text });
    },
    async fileTouch(daemonId, uuid, target) {
      return request('POST', '/api/files/touch', { daemonId, uuid, target });
    },
    async fileMkdir(daemonId, uuid, target) {
      return request('POST', '/api/files/mkdir', { daemonId, uuid, target });
    },
    async fileDelete(daemonId, uuid, targets) {
      return request('POST', '/api/files/delete', { daemonId, uuid, targets });
    },
    async fileCopy(daemonId, uuid, targets) {
      return request('POST', '/api/files/copy', { daemonId, uuid, targets });
    },
    async fileMove(daemonId, uuid, targets) {
      return request('POST', '/api/files/move', { daemonId, uuid, targets });
    },
    async createInstance(payload) {
      return request('POST', '/api/instance/create', payload);
    },
    async deleteInstance(daemonId, uuids, deleteFile) {
      return request('POST', '/api/instance/delete', { daemonId, uuids, deleteFile });
    },
    async inventory(daemonId, uuid) {
      return request('POST', '/api/instance/inventory', { daemonId, uuid });
    },
    async username(daemonId, uuid) {
      return request('GET', '/api/instance/username?' + new URLSearchParams({ daemonId, uuid }));
    },
    async operationLogs() {
      return request('GET', '/api/operation-logs');
    },
    // ---- 内置 MCC 模板 ----
    async templateList() {
      return request('GET', '/api/template/list');
    },
    async templateUpload(name, blob) {
      const headers = { Authorization: sessionToken ? 'Bearer ' + sessionToken : '' };
      const r = await fetch('/api/template/upload?name=' + encodeURIComponent(name), {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/octet-stream' },
        body: blob
      });
      let payload = null;
      try { payload = await r.json(); } catch (e) { /* 忽略 */ }
      if (r.status === 401) { setSession(''); throw new ApiError('未登录', 401, { authRequired: true }); }
      if (!r.ok) throw new ApiError((payload && payload.error) || '上传失败 (' + r.status + ')', r.status, payload);
      return payload;
    },
    async templateDelete(name) {
      return request('DELETE', '/api/template/file?' + new URLSearchParams({ name }));
    },
    async templateInit(source, container) {
      return request('POST', '/api/template/init', { source, container });
    }
  };

  namespace.api = api;
  namespace.getSession = getSession;
  namespace.setSession = setSession;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
