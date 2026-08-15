(function (global) {
  'use strict';

  /**
   * v3.js — v3 增强面板前端逻辑（自包含，挂载到 MccPanel.v3）。
   * 依赖 api.js 提供的 MccPanel.api；视图切换由 app.js 触发（onShown）。
   */

  const api = global.MccPanel && global.MccPanel.api;
  const V3 = {};

  const $ = (sel) => document.querySelector(sel);
  const STATUS = { '-1': '忙碌', '0': '已停止', '1': '停止中', '2': '启动中', '3': '运行中' };
  const STATUS_CLS = { '-1': 'busy', '0': 'stopped', '1': 'stopped', '2': 'busy', '3': 'running' };
  const ACTION_NAMES = { start: '启动', stop: '停止', restart: '重启', command: '发命令' };

  let currentUser = '';
  let currentRole = 'admin';
  let healthData = [];

  // ---------------------------------------------------------------------------
  // 工具
  // ---------------------------------------------------------------------------
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function toast(msg, type) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast ' + (type === 'ok' ? 'ok' : 'err');
    el.classList.remove('hidden', 'closing');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      el.classList.add('closing');
      setTimeout(() => el.classList.add('hidden'), 300);
    }, 2400);
  }

  function fmtTime(ms) {
    if (!ms) return '-';
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  function fmtDuration(sec) {
    sec = Math.max(0, Number(sec) || 0);
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (d > 0) return `${d}天${h}小时`;
    if (h > 0) return `${h}小时${m}分`;
    return `${m}分${sec % 60}秒`;
  }

  function badge(status) {
    const cls = STATUS_CLS[String(status)] || 'stopped';
    const label = STATUS[String(status)] || '未知';
    return `<span class="v3-badge ${cls}">${label}</span>`;
  }

  function setUser(user, role) {
    currentUser = user || '';
    currentRole = role || 'admin';
    // 角色 class：readonly 隐藏写按钮（need-admin），user 隐藏全局管理功能（need-global 由 CSS 控制）
    document.body.classList.toggle('readonly', currentRole === 'readonly');
    document.body.classList.toggle('role-user', currentRole === 'user');
    const el = $('#v3-user');
    if (el) {
      const roleText = currentRole === 'readonly' ? '只读' : (currentRole === 'user' ? '普通用户' : '管理员');
      el.innerHTML = escapeHtml(currentUser) + `<span class="v3-role ${currentRole === 'readonly' ? 'readonly' : ''}">${roleText}</span>`;
    }
  }

  // 通用模态（动态创建，用完移除）
  function openModal(title, bodyHTML, footerHTML) {
    closeModal();
    const overlay = document.createElement('div');
    overlay.id = 'v3-modal-overlay';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal modal-wide v3-modal">
        <div class="modal-head"><h2 class="modal-title">${escapeHtml(title)}</h2>
          <button class="btn btn-ghost v3-modal-close">关闭</button></div>
        <div class="v3-modal-body">${bodyHTML}</div>
        ${footerHTML ? `<div class="v3-modal-foot">${footerHTML}</div>` : ''}
      </div>`;
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.classList.contains('v3-modal-close')) closeModal();
    });
    document.body.appendChild(overlay);
    return overlay;
  }
  function closeModal() {
    const el = $('#v3-modal-overlay');
    if (el) el.remove();
  }

  // ---------------------------------------------------------------------------
  // 实例选择器（MCC 魔改 / 克隆 / 定时任务目标）
  // ---------------------------------------------------------------------------
  async function loadInstanceOptions(selectEl, keepValue) {
    const prev = keepValue ? selectEl.value : '';
    selectEl.innerHTML = '';
    try {
      const dR = await api.daemons();
      const daemons = (dR && dR.data) || [];
      for (const d of daemons) {
        const iR = await api.instances({ daemonId: d.uuid, page: 1, page_size: 100 });
        const list = (iR.data && iR.data.data) || [];
        for (const inst of list) {
          const opt = document.createElement('option');
          opt.value = d.uuid + '::' + inst.instanceUuid;
          // 实例名在 config.nickname（MCSM 列表接口无顶层 name 字段，直接取 inst.name 会显示 undefined）
          const nick = (inst.config && inst.config.nickname) || inst.nickname || inst.name || inst.instanceUuid;
          opt.textContent = nick + ' (' + (d.remarks || d.name || d.uuid) + ')';
          opt.dataset.daemonId = d.uuid;
          opt.dataset.uuid = inst.instanceUuid;
          selectEl.appendChild(opt);
        }
      }
    } catch (e) {
      toast('实例列表加载失败: ' + e.message, 'err');
    }
    if (prev) selectEl.value = prev;
    return selectEl;
  }

  function selValue(selectEl) {
    if (!selectEl) return null;
    const opt = selectEl.selectedOptions && selectEl.selectedOptions[0];
    if (!opt) return null;
    return { daemonId: opt.dataset.daemonId, uuid: opt.dataset.uuid, name: opt.textContent.split(' (')[0] };
  }

  // ---- 当前抽屉实例（MCC 魔改功能已移入实例抽屉，由 app.js 在打开抽屉时设置）----
  let drawerModInstance = null;

  /** 魔改操作的目标实例：优先取抽屉实例，兼容旧的下拉选择。 */
  function modTarget() {
    return drawerModInstance || null;
  }

  /** app.js 打开实例抽屉时调用，设置魔改面板的目标实例。 */
  V3.setDrawerInstance = function (inst) {
    drawerModInstance = inst ? { daemonId: inst.daemonId, uuid: inst.uuid, name: inst.nickname || inst.uuid } : null;
  };

  /** app.js 切换到抽屉「魔改」tab 时调用，加载当前实例的魔改配置。 */
  V3.loadDrawerMod = function () {
    return loadModData();
  };

  // ---------------------------------------------------------------------------
  // 视图生命周期（app.js 调用）
  // 单页滚动布局：所有面板章节同时可见，进入时一次性加载全部数据
  // ---------------------------------------------------------------------------
  V3.onShown = function () {
    loadOverview();
    loadSchedules();
    loadAutomationConfig();
    loadGroups();
    loadTransferTab();
    loadOpLogs();
  };

  V3.setUser = setUser;

  // ---------------------------------------------------------------------------
  // Tab：总览（健康监控 + 消息统计）
  // ---------------------------------------------------------------------------
  async function loadOverview() {
    try {
      const ov = await api.v3Get('overview');
      const d = ov.data || {};
      $('#v3o-total').textContent = d.instances ? d.instances.total : 0;
      $('#v3o-running').textContent = d.instances ? d.instances.running : 0;
      $('#v3o-msgs').textContent = d.stats ? d.stats.todayMessages : 0;
      $('#v3o-sched').textContent = d.schedules ? d.schedules.enabled + '/' + d.schedules.total : 0;
    } catch (e) { /* 忽略 */ }
    await Promise.all([loadHealth(), loadStats()]);
  }

  async function loadHealth() {
    const tbody = $('#v3-health-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="10" class="v3-panel-hint">加载中…</td></tr>';
    try {
      const r = await api.v3Get('health');
      healthData = (r.data || []).slice().sort((a, b) => (b.status === '3' ? 1 : 0) - (a.status === '3' ? 1 : 0));
      if (healthData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="v3-panel-hint">暂无数据（自动化引擎启动后自动采集，等待下一轮轮询）</td></tr>';
        return;
      }
      tbody.innerHTML = healthData.map((h) => `
        <tr>
          <td><strong>${escapeHtml(h.nickname || h.uuid)}</strong></td>
          <td>${badge(h.status)}</td>
          <td>${h.status === '3' ? fmtDuration(h.onlineSeconds) : '-'}</td>
          <td>${fmtDuration(h.onlineSeconds)}</td>
          <td>${fmtDuration(h.maxOnlineSeconds)}</td>
          <td>${h.restarts}${h.lastRestartAt ? `<span class="v3-panel-hint">(${fmtTime(h.lastRestartAt)})</span>` : ''}</td>
          <td>${h.disconnects}${h.lastDisconnectAt ? `<span class="v3-panel-hint">(${fmtTime(h.lastDisconnectAt)})</span>` : ''}</td>
          <td>${h.todayMessages}</td>
          <td>${h.totalMessages}</td>
          <td>${fmtTime(h.lastActiveAt)}</td>
        </tr>`).join('');
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="10" class="v3-panel-hint">加载失败: ${escapeHtml(e.message)}</td></tr>`;
    }
  }

  async function loadStats() {
    const wrap = $('#v3-stats-bars');
    if (!wrap) return;
    try {
      const r = await api.v3Get('stats');
      const byDay = (r.data && r.data.byDay) || [];
      if (byDay.length === 0) {
        wrap.innerHTML = '<div class="v3-bars-empty">暂无消息统计</div>';
        return;
      }
      const max = Math.max(1, ...byDay.map((d) => d.messages + d.commands));
      wrap.innerHTML = '<div class="v3-bars">' + byDay.map((d) => `
        <div class="v3-bar" style="height:${Math.max(3, Math.round(((d.messages + d.commands) / max) * 78))}%">
          <span class="v3-bar-tip">${d.date}<br>消息 ${d.messages} / 命令 ${d.commands}</span>
        </div>`).join('') + '</div>';
    } catch (e) {
      wrap.innerHTML = '<div class="v3-bars-empty">加载失败</div>';
    }
  }

  // ---------------------------------------------------------------------------
  // Tab：自动化（定时任务 / 掉线检测 / 防AFK / 自启组）
  // ---------------------------------------------------------------------------
  async function loadSchedules() {
    const tbody = $('#v3-sched-table tbody');
    if (!tbody) return;
    try {
      const r = await api.v3Get('schedules');
      const list = (r.data || []).slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      tbody.innerHTML = list.map((s) => `
        <tr>
          <td><strong>${escapeHtml(s.name)}</strong></td>
          <td class="mono">${escapeHtml(s.cron)}</td>
          <td>${ACTION_NAMES[s.action && s.action.type] || escapeHtml(s.action && s.action.type)}${s.action && s.action.command ? `<span class="v3-panel-hint"> ${escapeHtml(String(s.action.command).slice(0, 24))}</span>` : ''}</td>
          <td class="mono">${escapeHtml((s.action && s.action.uuid) || '-')}</td>
          <td>${s.enabled ? '<span class="v3-badge ok">启用</span>' : '<span class="v3-badge stopped">停用</span>'}</td>
          <td>${s.runCount || 0}</td>
          <td>${s.lastError ? `<span class="v3-badge err">${escapeHtml(String(s.lastError).slice(0, 40))}</span>` : (s.lastResult ? escapeHtml(String(s.lastResult).slice(0, 40)) : '-')}</td>
          <td>
            <div class="v3-actions">
              <button class="btn btn-sm need-admin" data-sched-toggle="${s.id}">${s.enabled ? '停用' : '启用'}</button>
              <button class="btn btn-sm need-admin" data-sched-edit="${s.id}">编辑</button>
              <button class="btn btn-sm btn-danger need-admin" data-sched-del="${s.id}">删除</button>
            </div>
          </td>
        </tr>`).join('') || '<tr><td colspan="8" class="v3-panel-hint">暂无定时任务</td></tr>';
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="8" class="v3-panel-hint">加载失败: ${escapeHtml(e.message)}</td></tr>`;
    }
  }

  function scheduleModal(existing) {
    const s = existing || {};
    const body = `
      <form id="v3-sched-form" class="v3-form">
        <label class="form-label">任务名称 <input type="text" id="v3-sched-name" class="input" required value="${escapeHtml(s.name || '')}" placeholder="如 每日3点重启"></label>
        <label class="form-label">cron 表达式（分 时 日 月 周）<input type="text" id="v3-sched-cron" class="input mono-input" required value="${escapeHtml(s.cron || '0 3 * * *')}" placeholder="0 3 * * *"></label>
        <label class="form-label">动作类型
          <select id="v3-sched-type" class="select">
            <option value="restart" ${(s.action && s.action.type) === 'restart' ? 'selected' : ''}>重启实例</option>
            <option value="start" ${(s.action && s.action.type) === 'start' ? 'selected' : ''}>启动实例</option>
            <option value="stop" ${(s.action && s.action.type) === 'stop' ? 'selected' : ''}>停止实例</option>
            <option value="command" ${(s.action && s.action.type) === 'command' ? 'selected' : ''}>发送命令/消息</option>
          </select>
        </label>
        <label class="form-label">目标实例 <select id="v3-sched-instance" class="select"></select></label>
        <label class="form-label">命令/消息内容（动作=发送命令时）<input type="text" id="v3-sched-command" class="input mono-input" value="${escapeHtml((s.action && s.action.command) || '')}" placeholder="如 /send /home 或 大家好"></label>
        <label class="check-all"><input type="checkbox" id="v3-sched-enabled" ${s.enabled === false ? '' : 'checked'}><span>启用</span></label>
        <div id="v3-sched-error" class="command-result"></div>
      </form>`;
    const foot = `<button class="btn btn-primary" id="v3-sched-save">保存</button><button class="btn btn-ghost v3-modal-close">取消</button>`;
    openModal(existing ? '编辑定时任务' : '新建定时任务', body, foot);
    const instSel = $('#v3-sched-instance');
    loadInstanceOptions(instSel, true).then(() => {
      if (s.action && s.action.daemonId && s.action.uuid) {
        instSel.value = s.action.daemonId + '::' + s.action.uuid;
      }
    });
    $('#v3-sched-save').addEventListener('click', async () => {
      const inst = selValue(instSel);
      const payload = {
        id: s.id,
        name: $('#v3-sched-name').value.trim(),
        cron: $('#v3-sched-cron').value.trim(),
        type: $('#v3-sched-type').value,
        enabled: $('#v3-sched-enabled').checked,
        action: {
          type: $('#v3-sched-type').value,
          daemonId: inst ? inst.daemonId : '',
          uuid: inst ? inst.uuid : '',
          command: $('#v3-sched-command').value.trim()
        }
      };
      if (!payload.name || !payload.cron) { $('#v3-sched-error').textContent = '名称与 cron 不能为空'; return; }
      try {
        if (s.id) await api.v3Put('schedules', payload);
        else await api.v3Post('schedules', payload);
        closeModal();
        toast('定时任务已保存');
        loadSchedules();
      } catch (e) {
        $('#v3-sched-error').textContent = e.message;
      }
    });
  }

  async function loadAutomationConfig() {
    try {
      const r = await api.v3Get('automation');
      const a = r.data || {};
      const rc = a.autoreconnect || {};
      const afk = a.afk || {};
      $('#v3-reco-enabled').checked = !!rc.enabled;
      $('#v3-reco-keywords').value = (rc.keywords || []).join(', ');
      $('#v3-reco-strategy').value = rc.strategy === 'restart' ? 'restart' : 'reco';
      $('#v3-reco-max').value = rc.maxRecoFailures || 3;
      $('#v3-reco-cooldown').value = Math.round((rc.cooldownMs || 60000) / 1000);
      $('#v3-afk-enabled').checked = !!afk.enabled;
      $('#v3-afk-interval').value = Math.round((afk.intervalMs || 300000) / 1000);
      $('#v3-afk-command').value = afk.command || '/ping';
    } catch (e) { /* 忽略 */ }
  }

  async function loadGroups() {
    const tbody = $('#v3-group-table tbody');
    if (!tbody) return;
    try {
      const r = await api.v3Get('autostart-groups');
      const list = (r.data || []).slice();
      tbody.innerHTML = list.map((g) => {
        const running = (g.items || []).filter((i) => i.status === '3').length;
        return `
        <tr>
          <td><strong>${escapeHtml(g.name)}</strong></td>
          <td>${(g.instances || []).length}（运行 ${running}）</td>
          <td>${Math.round((g.startDelayMs || 0) / 1000)}</td>
          <td>${Math.round((g.instanceDelayMs || 0) / 1000)}</td>
          <td>${g.enabled ? '<span class="v3-badge ok">启用</span>' : '<span class="v3-badge stopped">停用</span>'}</td>
          <td>
            <div class="v3-actions">
              <button class="btn btn-sm need-admin" data-group-run="${g.id}">触发</button>
              <button class="btn btn-sm need-admin" data-group-edit="${g.id}">编辑</button>
              <button class="btn btn-sm btn-danger need-admin" data-group-del="${g.id}">删除</button>
            </div>
          </td>
        </tr>`;
      }).join('') || '<tr><td colspan="6" class="v3-panel-hint">暂无自启组</td></tr>';
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="6" class="v3-panel-hint">加载失败: ${escapeHtml(e.message)}</td></tr>`;
    }
  }

  function groupModal(existing) {
    const g = existing || {};
    const body = `
      <form id="v3-group-form" class="v3-form">
        <label class="form-label">组名 <input type="text" id="v3-group-name" class="input" required value="${escapeHtml(g.name || '')}" placeholder="如 主城挂机组"></label>
        <label class="form-label">面板启动后延迟（秒）<input type="number" id="v3-group-startdelay" class="input" value="${Math.round((g.startDelayMs || 0) / 1000)}"></label>
        <label class="form-label">实例间启动间隔（秒）<input type="number" id="v3-group-stepdelay" class="input" value="${Math.round((g.instanceDelayMs || 8000) / 1000)}"></label>
        <label class="form-label">包含实例（多选）<select id="v3-group-instances" class="select" multiple size="8"></select></label>
        <label class="check-all"><input type="checkbox" id="v3-group-enabled" ${g.enabled === false ? '' : 'checked'}><span>启用（面板启动时自动触发）</span></label>
        <div id="v3-group-error" class="command-result"></div>
      </form>`;
    const foot = `<button class="btn btn-primary" id="v3-group-save">保存</button><button class="btn btn-ghost v3-modal-close">取消</button>`;
    openModal(existing ? '编辑自启组' : '新建自启组', body, foot);
    const instSel = $('#v3-group-instances');
    const chosen = new Set((g.instances || []).map((i) => i.daemonId + '::' + i.uuid));
    loadInstanceOptions(instSel, false).then(() => {
      for (const opt of instSel.options) {
        if (chosen.has(opt.value)) opt.selected = true;
      }
    });
    $('#v3-group-save').addEventListener('click', async () => {
      const instances = Array.from(instSel.selectedOptions).map((o) => ({
        daemonId: o.dataset.daemonId, uuid: o.dataset.uuid
      }));
      const payload = {
        id: g.id,
        name: $('#v3-group-name').value.trim(),
        startDelayMs: Math.round(Number($('#v3-group-startdelay').value || 0) * 1000),
        instanceDelayMs: Math.round(Number($('#v3-group-stepdelay').value || 8) * 1000),
        enabled: $('#v3-group-enabled').checked,
        instances
      };
      if (!payload.name) { $('#v3-group-error').textContent = '组名不能为空'; return; }
      try {
        if (g.id) await api.v3Put('autostart-groups', payload);
        else await api.v3Post('autostart-groups', payload);
        closeModal();
        toast('自启组已保存');
        loadGroups();
      } catch (e) {
        $('#v3-group-error').textContent = e.message;
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Tab：MCC 魔改
  // ---------------------------------------------------------------------------
  async function loadModTab() {
    const sel = $('#v3-mod-instance');
    if (sel) {
      await loadInstanceOptions(sel, false);
      if (sel.options.length > 0) await loadModData();
      else if ($('#v3-mod-instance-info')) $('#v3-mod-instance-info').textContent = '（无实例可选）';
    } else {
      // 魔改面板已移入实例抽屉：直接加载抽屉实例数据
      await loadModData();
    }
  }

  async function loadModData() {
    const target = modTarget();
    if ($('#v3-mod-instance-info')) $('#v3-mod-instance-info').textContent = target ? '当前实例: ' + target.name : '';
    if (!target) return;
    // 指令
    try {
      const r = await api.v3Get('mcc/commands', { daemonId: target.daemonId, uuid: target.uuid });
      renderCommands((r.data && r.data.commands) || []);
    } catch (e) {
      renderCommands([]);
    }
    // 服务器
    try {
      const r = await api.v3Get('mcc/servers', { daemonId: target.daemonId, uuid: target.uuid });
      renderServers((r.data && r.data.servers) || []);
    } catch (e) {
      renderServers([]);
    }
    // mod 段
    try {
      const r = await api.v3Get('mcc/mod', { daemonId: target.daemonId, uuid: target.uuid });
      const m = r.data || {};
      const afk = m.antiAfk || {};
      const relog = m.autoRelog || {};
      // 新版 MCC 段键为大写（Enabled/Delay/Command/Retries/Ignore_Kick_Message）
      const afkDelayMatch = /\bmin\s*=\s*([\d.]+)/.exec(String(afk.Delay || ''));
      $('#v3-mod-antiafk').checked = afk.Enabled !== 'false' && afk.Enabled !== undefined;
      $('#v3-mod-antiafk-delay').value = afkDelayMatch ? afkDelayMatch[1] : 600;
      $('#v3-mod-antiafk-cmd').value = String(afk.Command || '/ping').replace(/"/g, '');
      $('#v3-mod-autorelog').checked = relog.Enabled !== 'false' && relog.Enabled !== undefined;
      $('#v3-mod-autorelog-retries').value = relog.Retries == null ? 5 : relog.Retries;
      $('#v3-mod-autorelog-ignore').checked = relog.Ignore_Kick_Message === 'true';
    } catch (e) {
      $('#v3-mod-antiafk').checked = false;
      $('#v3-mod-autorelog').checked = false;
    }
  }

  function renderCommands(commands) {
    const tbody = $('#v3-cmd-table tbody');
    const list = commands.slice();
    if (list.length === 0) list.push({ trigger: '!home', action: 'send /home', cooldown: 5, enabled: true });
    tbody.innerHTML = list.map((c, i) => `
      <tr data-cmd-row="${i}">
        <td><input type="text" class="input mono-input cmd-trigger" value="${escapeHtml(c.trigger || '')}" placeholder="!home"></td>
        <td><input type="text" class="input mono-input cmd-action" value="${escapeHtml(c.action || '')}" placeholder="send /home"></td>
        <td><input type="number" class="input cmd-cooldown" style="width:70px" value="${Number(c.cooldown) || 0}"></td>
        <td><input type="text" class="input cmd-whitelist" value="${escapeHtml((c.whitelist || []).join(', '))}" placeholder="留空=所有人"></td>
        <td><label class="check-all"><input type="checkbox" class="cmd-enabled" ${c.enabled === false ? '' : 'checked'}></label></td>
        <td><button class="btn btn-sm btn-danger need-admin cmd-del">删除</button></td>
      </tr>`).join('');
  }

  function renderServers(servers) {
    const tbody = $('#v3-server-table tbody');
    const list = servers.slice();
    if (list.length === 0) list.push({ alias: 'main', host: 'mc.example.com', port: 25565 });
    tbody.innerHTML = list.map((s, i) => `
      <tr data-srv-row="${i}">
        <td><input type="text" class="input mono-input srv-alias" value="${escapeHtml(s.alias || '')}" placeholder="main"></td>
        <td><input type="text" class="input mono-input srv-host" value="${escapeHtml(s.host || '')}" placeholder="mc.example.com"></td>
        <td><input type="number" class="input srv-port" style="width:80px" value="${s.port || ''}"></td>
        <td><button class="btn btn-sm need-admin srv-switch" title="切换到该服务器">切换</button></td>
        <td><button class="btn btn-sm btn-danger need-admin srv-del">删除</button></td>
      </tr>`).join('');
  }

  // ---------------------------------------------------------------------------
  // Tab：导入导出
  // ---------------------------------------------------------------------------
  async function loadTransferTab() {
    await loadInstanceOptions($('#v3-clone-instance'), false);
    await loadTransferDaemons();
    renderTransferDaemonSelect();
    await loadExportList();
  }

  // ---- 导入导出：节点列表 / 导出勾选表格 / 导入解析预览 ----
  let transferDaemons = []; // 当前 MCSM 节点列表（导出表格与导入兜底节点共用）
  let importParsed = [];    // 解析预览对应的实例数组

  async function loadTransferDaemons() {
    try {
      const r = await api.daemons();
      transferDaemons = (r && r.data) || [];
    } catch (e) {
      transferDaemons = [];
    }
  }

  function renderTransferDaemonSelect() {
    const sel = $('#v3-import-fallback-daemon');
    if (!sel) return;
    sel.innerHTML = transferDaemons.map((d) =>
      `<option value="${escapeHtml(d.uuid)}">${escapeHtml(d.remarks || d.ip || d.uuid)}</option>`
    ).join('') || '<option value="">（无可用节点）</option>';
  }

  function transferDaemonName(daemonId) {
    const d = transferDaemons.find((x) => x.uuid === daemonId);
    return d ? (d.remarks || d.ip || d.uuid) : '';
  }

  async function loadExportList() {
    const tbody = $('#v3-export-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="4" class="v3-panel-hint">加载中…</td></tr>';
    try {
      await loadTransferDaemons();
      const rows = [];
      for (const d of transferDaemons) {
        const iR = await api.instances({ daemonId: d.uuid, page: 1, page_size: 100 });
        const list = (iR.data && iR.data.data) || [];
        for (const inst of list) {
          const nick = (inst.config && inst.config.nickname) || inst.nickname || inst.name || inst.instanceUuid;
          rows.push({
            key: d.uuid + '::' + inst.instanceUuid,
            node: d.remarks || d.ip || d.uuid,
            name: nick,
            status: String(inst.status == null ? '' : inst.status)
          });
        }
      }
      if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="v3-panel-hint">无实例</td></tr>';
        updateExportSelCount();
        return;
      }
      tbody.innerHTML = rows.map((r) => `
        <tr>
          <td><input type="checkbox" class="v3-export-row" value="${escapeHtml(r.key)}" checked></td>
          <td>${escapeHtml(r.node)}</td>
          <td>${escapeHtml(r.name)}</td>
          <td>${badge(r.status)}</td>
        </tr>`).join('');
      updateExportSelCount();
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="4" class="v3-panel-hint">加载失败: ${escapeHtml(e.message)}</td></tr>`;
    }
  }

  function exportCheckedKeys() {
    return Array.from(document.querySelectorAll('#v3-export-table .v3-export-row:checked')).map((c) => c.value);
  }

  function updateExportSelCount() {
    const rows = document.querySelectorAll('#v3-export-table .v3-export-row');
    const n = document.querySelectorAll('#v3-export-table .v3-export-row:checked').length;
    const btn = $('#v3-export-sel');
    if (btn) btn.textContent = '导出所选' + (n ? ' (' + n + ')' : '');
    const all = $('#v3-export-sel-all');
    if (all) all.checked = rows.length > 0 && n === rows.length;
  }

  /** 解析导入输入框内容：支持 {instances:[...]} 或直接数组。 */
  function parseImportInput() {
    const raw = $('#v3-import-in').value.trim();
    if (!raw) return { error: '请先粘贴 JSON 或选择 JSON 文件' };
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return { error: 'JSON 解析失败: ' + e.message };
    }
    const arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.instances) ? parsed.instances : null);
    if (!arr) return { error: '未找到 instances 数组（支持 {instances:[...]} 或直接数组）' };
    if (arr.length === 0) return { error: 'instances 为空' };
    return { list: arr };
  }

  function renderImportPreview(list) {
    const wrap = $('#v3-import-preview-wrap');
    const tbody = $('#v3-import-preview tbody');
    if (!wrap || !tbody) return;
    wrap.classList.remove('hidden');
    importParsed = list;
    tbody.innerHTML = list.map((it, idx) => {
      const name = String(it.name || '').trim();
      const serverIp = String(it.serverIp || '').trim();
      const login = String(it.accountLogin || '').trim();
      const port = it.serverPort == null ? '' : String(it.serverPort);
      const accountType = it.accountType === 'offline' ? '离线' : '微软';
      const knownNode = transferDaemonName(it.daemonId);
      const errors = [];
      if (!name) errors.push('缺实例名');
      if (!serverIp) errors.push('缺服务器地址');
      if (!login) errors.push('缺登录名');
      const okRow = errors.length === 0;
      const nodeCell = knownNode ? escapeHtml(knownNode) : '（下方节点）';
      return `<tr>
        <td><input type="checkbox" class="v3-import-row" data-idx="${idx}" ${okRow ? 'checked' : 'disabled'}></td>
        <td>${escapeHtml(name || '-')}</td>
        <td>${escapeHtml(serverIp || '-')}${port ? ':' + escapeHtml(port) : ''}</td>
        <td>${escapeHtml(accountType)}${login ? ' ' + escapeHtml(login) : ''}</td>
        <td>${nodeCell}</td>
        <td>${errors.length ? '<span class="command-result">' + escapeHtml(errors.join('、')) + '</span>' : '可导入'}</td>
      </tr>`;
    }).join('');
    updateImportSelCount();
  }

  function importCheckedItems() {
    const idxs = Array.from(document.querySelectorAll('#v3-import-preview .v3-import-row:checked'))
      .map((c) => Number(c.dataset.idx));
    return idxs.map((i) => importParsed[i]).filter(Boolean);
  }

  function updateImportSelCount() {
    const rows = document.querySelectorAll('#v3-import-preview .v3-import-row:not([disabled])');
    const n = document.querySelectorAll('#v3-import-preview .v3-import-row:checked').length;
    const btn = $('#v3-import-sel');
    if (btn) btn.textContent = '导入所选' + (n ? ' (' + n + ')' : '');
    const all = $('#v3-import-sel-all');
    if (all) all.checked = rows.length > 0 && n === rows.length;
  }

  async function importSelected() {
    const items = importCheckedItems();
    if (items.length === 0) { toast('没有勾选可导入的实例', 'err'); return; }
    const fallback = $('#v3-import-fallback-daemon').value;
    // 原 daemonId 在当前节点列表找不到时清空，交给 defaultDaemonId 兜底节点创建
    const payload = items.map((it) => (transferDaemonName(it.daemonId) ? it : Object.assign({}, it, { daemonId: '' })));
    if (!confirm(`将导入所选 ${payload.length} 个实例，确认继续？`)) return;
    try {
      $('#v3-import-sel-result').textContent = '导入中…';
      const r = await api.v3Post('instances/import', { instances: payload, defaultDaemonId: fallback });
      const d = r.data || {};
      $('#v3-import-sel-result').textContent = `成功 ${d.created.length}，失败 ${d.failed.length}` +
        (d.failed.length ? '。' + d.failed.map((f) => f.name + ': ' + f.error).join('；').slice(0, 200) : '');
      toast(`导入完成：成功 ${d.created.length}，失败 ${d.failed.length}`);
      loadExportList();
    } catch (e) { $('#v3-import-sel-result').textContent = e.message; }
  }

  function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime || 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // ---------------------------------------------------------------------------
  // Tab：操作日志
  // ---------------------------------------------------------------------------
  async function loadOpLogs() {
    const tbody = $('#v3-ol-table tbody');
    if (!tbody) return;
    const from = $('#v3-ol-from').value ? new Date($('#v3-ol-from').value + 'T00:00:00').getTime() : 0;
    const to = $('#v3-ol-to').value ? new Date($('#v3-ol-to').value + 'T23:59:59').getTime() : 0;
    tbody.innerHTML = '<tr><td colspan="4" class="v3-panel-hint">加载中…</td></tr>';
    try {
      const r = await api.v3Get('operation-logs', {
        user: $('#v3-ol-user').value.trim(),
        action: $('#v3-ol-action').value.trim(),
        from: from || '',
        to: to || '',
        limit: 500
      });
      const logs = (r.data && r.data.logs) || [];
      tbody.innerHTML = logs.map((l) => `
        <tr>
          <td>${escapeHtml(fmtTime(l.time))}</td>
          <td>${escapeHtml(l.user || '-')}</td>
          <td>${escapeHtml(l.action || '')}</td>
          <td>${escapeHtml(l.detail || '')}</td>
        </tr>`).join('') || '<tr><td colspan="4" class="v3-panel-hint">无匹配记录</td></tr>';
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="4" class="v3-panel-hint">加载失败: ${escapeHtml(e.message)}</td></tr>`;
    }
  }

  // ---------------------------------------------------------------------------
  // 事件绑定
  // ---------------------------------------------------------------------------
  function bindEvents() {
    // tab 切换
    document.querySelectorAll('.v3-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.v3-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        document.querySelectorAll('.v3-panel').forEach((p) => p.classList.add('hidden'));
        const panel = $('#v3-' + tab.dataset.v3tab);
        if (panel) panel.classList.remove('hidden');
        if (tab.dataset.v3tab === 'automation') { loadSchedules(); loadAutomationConfig(); loadGroups(); }
        if (tab.dataset.v3tab === 'mccmod') loadModTab();
        if (tab.dataset.v3tab === 'transfer') loadTransferTab();
        if (tab.dataset.v3tab === 'oplog') loadOpLogs();
      });
    });

    // 总览
    $('#v3-health-refresh').addEventListener('click', () => { loadHealth(); loadStats(); });
    $('#v3-health-prune').addEventListener('click', async () => {
      if (!confirm('清理已删除实例的历史健康统计？只移除 MCSM 中已不存在的实例条目，其余统计保留。')) return;
      try {
        const r = await api.v3Post('health/prune');
        toast(r.data && r.data.removed ? '已清理 ' + r.data.removed + ' 条残留' : '没有需要清理的条目');
        loadHealth();
        loadOverview();
      } catch (e) { toast(e.message, 'err'); }
    });
    $('#v3-health-reset').addEventListener('click', async () => {
      if (!confirm('确定清空全部健康监控统计？此操作不可恢复。')) return;
      try { await api.v3Post('health/reset'); toast('已重置'); loadOverview(); } catch (e) { toast(e.message, 'err'); }
    });

    // 定时任务
    $('#v3-sched-new').addEventListener('click', () => scheduleModal(null));
    $('#v3-sched-table').addEventListener('click', async (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const id = btn.dataset.schedToggle || btn.dataset.schedEdit || btn.dataset.schedDel;
      if (!id) return;
      try {
        const list = ((await api.v3Get('schedules')).data || []);
        const s = list.find((x) => x.id === id);
        if (btn.dataset.schedToggle) {
          await api.v3Put('schedules', { id, enabled: !s.enabled });
          toast(s.enabled ? '已停用' : '已启用');
        } else if (btn.dataset.schedDel) {
          if (!confirm('删除定时任务「' + s.name + '」？')) return;
          await api.v3Delete('schedules', { id });
          toast('已删除');
        } else if (btn.dataset.schedEdit) {
          scheduleModal(s);
        }
        loadSchedules();
      } catch (err) { toast(err.message, 'err'); }
    });

    // 掉线检测 / 防AFK
    $('#v3-reco-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api.v3Put('automation', {
          autoreconnect: {
            enabled: $('#v3-reco-enabled').checked,
            keywords: $('#v3-reco-keywords').value.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
            strategy: $('#v3-reco-strategy').value,
            maxRecoFailures: Number($('#v3-reco-max').value) || 3,
            cooldownMs: (Number($('#v3-reco-cooldown').value) || 60) * 1000
          }
        });
        $('#v3-reco-result').textContent = '已保存';
        toast('掉线检测配置已保存');
      } catch (err) { $('#v3-reco-result').textContent = err.message; }
    });
    $('#v3-afk-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api.v3Put('automation', {
          afk: {
            enabled: $('#v3-afk-enabled').checked,
            intervalMs: (Number($('#v3-afk-interval').value) || 300) * 1000,
            command: $('#v3-afk-command').value.trim()
          }
        });
        $('#v3-afk-result').textContent = '已保存';
        toast('防 AFK 配置已保存');
      } catch (err) { $('#v3-afk-result').textContent = err.message; }
    });

    // 自启组
    $('#v3-group-new').addEventListener('click', () => groupModal(null));
    $('#v3-group-table').addEventListener('click', async (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const id = btn.dataset.groupRun || btn.dataset.groupEdit || btn.dataset.groupDel;
      if (!id) return;
      try {
        const list = (await api.v3Get('autostart-groups')).data || [];
        const g = list.find((x) => x.id === id);
        if (btn.dataset.groupRun) {
          toast('正在触发自启组…');
          const r = await api.v3Post('autostart-groups/trigger', { id });
          const d = r.data || {};
          toast(`触发完成：启动 ${d.started ? d.started.length : 0}，跳过 ${d.skipped ? d.skipped.length : 0}${d.failed && d.failed.length ? '，失败 ' + d.failed.length : ''}`);
        } else if (btn.dataset.groupDel) {
          if (!confirm('删除自启组「' + g.name + '」？')) return;
          await api.v3Delete('autostart-groups', { id });
          toast('已删除');
        } else if (btn.dataset.groupEdit) {
          groupModal(g);
        }
        loadGroups();
      } catch (err) { toast(err.message, 'err'); }
    });

    // MCC 魔改
    if ($('#v3-mod-reload')) $('#v3-mod-reload').addEventListener('click', () => loadModTab());
    if ($('#v3-mod-instance')) $('#v3-mod-instance').addEventListener('change', () => loadModData());
    $('#v3-cmd-add').addEventListener('click', () => {
      const tbody = $('#v3-cmd-table tbody');
      const row = document.createElement('tr');
      row.dataset.cmdRow = 'new';
      row.innerHTML = `
        <td><input type="text" class="input mono-input cmd-trigger" placeholder="!ping"></td>
        <td><input type="text" class="input mono-input cmd-action" placeholder="send /ping"></td>
        <td><input type="number" class="input cmd-cooldown" style="width:70px" value="0"></td>
        <td><input type="text" class="input cmd-whitelist" placeholder="留空=所有人"></td>
        <td><label class="check-all"><input type="checkbox" class="cmd-enabled" checked></label></td>
        <td><button class="btn btn-sm btn-danger need-admin cmd-del">删除</button></td>`;
      tbody.appendChild(row);
    });
    $('#v3-cmd-save').addEventListener('click', async () => {
      const target = modTarget();
      if (!target) { toast('请先选择实例', 'err'); return; }
      const commands = Array.from(document.querySelectorAll('#v3-cmd-table tbody tr')).map((tr) => ({
        trigger: tr.querySelector('.cmd-trigger').value.trim(),
        action: tr.querySelector('.cmd-action').value.trim(),
        cooldown: Number(tr.querySelector('.cmd-cooldown').value) || 0,
        whitelist: (tr.querySelector('.cmd-whitelist').value || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean),
        enabled: tr.querySelector('.cmd-enabled').checked
      })).filter((c) => c.trigger);
      try {
        const r = await api.v3Put('mcc/commands', { daemonId: target.daemonId, uuid: target.uuid, commands });
        $('#v3-cmd-result').textContent = `已保存 ${r.data.count} 条指令`;
        toast('聊天指令已保存');
      } catch (e) { $('#v3-cmd-result').textContent = e.message; }
    });
    $('#v3-cmd-table').addEventListener('click', (e) => {
      const btn = e.target.closest('.cmd-del');
      if (!btn) return;
      const tr = btn.closest('tr');
      if (tr) tr.remove();
    });

    $('#v3-server-add').addEventListener('click', () => {
      const tbody = $('#v3-server-table tbody');
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input type="text" class="input mono-input srv-alias" placeholder="main"></td>
        <td><input type="text" class="input mono-input srv-host" placeholder="mc.example.com"></td>
        <td><input type="number" class="input srv-port" style="width:80px"></td>
        <td><button class="btn btn-sm need-admin srv-switch">切换</button></td>
        <td><button class="btn btn-sm btn-danger need-admin srv-del">删除</button></td>`;
      tbody.appendChild(tr);
    });
    $('#v3-server-save').addEventListener('click', async () => {
      const target = modTarget();
      if (!target) { toast('请先选择实例', 'err'); return; }
      const servers = Array.from(document.querySelectorAll('#v3-server-table tbody tr')).map((tr) => ({
        alias: tr.querySelector('.srv-alias').value.trim(),
        host: tr.querySelector('.srv-host').value.trim(),
        port: Number(tr.querySelector('.srv-port').value) || undefined
      })).filter((s) => s.alias && s.host);
      try {
        const r = await api.v3Put('mcc/servers', { daemonId: target.daemonId, uuid: target.uuid, servers });
        $('#v3-server-result').textContent = `已保存 ${r.data.count} 个服务器`;
        toast('服务器列表已保存');
      } catch (e) { $('#v3-server-result').textContent = e.message; }
    });
    $('#v3-server-table').addEventListener('click', async (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const tr = btn.closest('tr');
      if (!tr) return;
      const target = modTarget();
      if (!target) return;
      const alias = tr.querySelector('.srv-alias').value.trim();
      const host = tr.querySelector('.srv-host').value.trim();
      const port = Number(tr.querySelector('.srv-port').value) || undefined;
      if (btn.classList.contains('srv-del')) {
        tr.remove();
        return;
      }
      if (btn.classList.contains('srv-switch')) {
        if (!alias || !host) { toast('请填写别名与地址', 'err'); return; }
        try {
          const r = await api.v3Post('mcc/switch-server', { daemonId: target.daemonId, uuid: target.uuid, alias, host, port });
          toast(r.data.viaConnect ? '已切换到 ' + alias + '（运行中即时切换）' : '已更新配置，启动后生效');
        } catch (err) { toast(err.message, 'err'); }
      }
    });

    $('#v3-mod-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const target = modTarget();
      if (!target) { toast('请先选择实例', 'err'); return; }
      try {
        const payload = {
          daemonId: target.daemonId,
          uuid: target.uuid,
          antiAfk: {
            enabled: $('#v3-mod-antiafk').checked,
            delay: Number($('#v3-mod-antiafk-delay').value) || 600,
            command: $('#v3-mod-antiafk-cmd').value.trim() || '/ping'
          },
          autoRelog: {
            enabled: $('#v3-mod-autorelog').checked,
            retries: Number($('#v3-mod-autorelog-retries').value) || 5,
            ignoreKickMessage: $('#v3-mod-autorelog-ignore').checked,
            kickMessages: []
          },
          scriptScheduler: null
        };
        if ($('#v3-mod-autorelog').checked) {
          payload.autoRelog.kickMessages = ['Connection has been lost', 'Login failed', 'Failed to ping this IP', 'Restarting'];
        }
        const r = await api.v3Post('mcc/apply-mod', payload);
        $('#v3-mod-result').textContent = '已应用，需重启实例生效 附加文件: ' + (r.data.files || []).join(', ');
        toast('MCC 原生功能配置已写入');
      } catch (err) { $('#v3-mod-result').textContent = err.message; }
    });

    $('#v3-script-idle').addEventListener('click', async () => {
      const target = modTarget();
      if (!target) { toast('请先选择实例', 'err'); return; }
      try {
        const tpl = (await api.v3Get('mcc/templates')).data;
        await api.v3Post('mcc/scripts', { daemonId: target.daemonId, uuid: target.uuid, name: 'idle.txt', content: tpl.idle.content });
        $('#v3-script-result').textContent = '已生成 idle.txt 可在实例「脚本」tab 中运行 /script idle';
        toast('挂机脚本已生成');
      } catch (e) { $('#v3-script-result').textContent = e.message; }
    });
    $('#v3-script-tasks').addEventListener('click', async () => {
      const target = modTarget();
      if (!target) { toast('请先选择实例', 'err'); return; }
      try {
        const tpl = (await api.v3Get('mcc/templates')).data;
        await api.v3Post('mcc/scripts', { daemonId: target.daemonId, uuid: target.uuid, name: 'tasks.txt', content: tpl.tasks.content });
        $('#v3-script-result').textContent = '已生成 tasks.txt 配合「应用原生功能配置」中的脚本调度使用';
        toast('任务模板已生成');
      } catch (e) { $('#v3-script-result').textContent = e.message; }
    });

    // 导入导出
    $('#v3-export').addEventListener('click', async () => {
      try {
        $('#v3-export-result').textContent = '导出中…';
        const r = await api.v3Get('instances/export', { includeIni: $('#v3-export-ini').checked });
        const text = JSON.stringify(r.data, null, 2);
        $('#v3-export-out').value = text;
        $('#v3-export-result').textContent = `已导出 ${r.data.instances.length} 个实例`;
      } catch (e) { $('#v3-export-result').textContent = e.message; }
    });
    $('#v3-export-sel').addEventListener('click', async () => {
      const keys = exportCheckedKeys();
      if (keys.length === 0) { toast('请勾选要导出的实例', 'err'); return; }
      try {
        $('#v3-export-result').textContent = '导出中…';
        const r = await api.v3Get('instances/export', { includeIni: $('#v3-export-ini').checked, uuids: keys.join(',') });
        $('#v3-export-out').value = JSON.stringify(r.data, null, 2);
        $('#v3-export-result').textContent = `已导出 ${r.data.instances.length} 个实例`;
      } catch (e) { $('#v3-export-result').textContent = e.message; }
    });
    $('#v3-export-sel-all').addEventListener('change', (e) => {
      document.querySelectorAll('#v3-export-table .v3-export-row').forEach((c) => { c.checked = e.target.checked; });
      updateExportSelCount();
    });
    $('#v3-export-table').addEventListener('change', (e) => {
      if (e.target.classList.contains('v3-export-row')) updateExportSelCount();
    });
    $('#v3-export-download').addEventListener('click', () => {
      const text = $('#v3-export-out').value;
      if (!text) { toast('请先导出', 'err'); return; }
      download('mcc-panel-instances-export.json', text, 'application/json');
    });
    $('#v3-import-file-btn').addEventListener('click', () => $('#v3-import-file').click());
    $('#v3-import-file').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        $('#v3-import-in').value = String(reader.result || '');
        $('#v3-import-parse-result').textContent = '已读取 ' + f.name + '，点击「解析预览」查看';
        e.target.value = '';
      };
      reader.onerror = () => toast('文件读取失败', 'err');
      reader.readAsText(f);
    });
    $('#v3-import-parse').addEventListener('click', async () => {
      await loadTransferDaemons();
      renderTransferDaemonSelect();
      const res = parseImportInput();
      if (res.error) {
        $('#v3-import-parse-result').textContent = res.error;
        $('#v3-import-preview-wrap').classList.add('hidden');
        return;
      }
      renderImportPreview(res.list);
      $('#v3-import-parse-result').textContent = `已解析 ${res.list.length} 个实例，勾选后点「导入所选」`;
    });
    $('#v3-import-sel-all').addEventListener('change', (e) => {
      document.querySelectorAll('#v3-import-preview .v3-import-row:not([disabled])').forEach((c) => { c.checked = e.target.checked; });
      updateImportSelCount();
    });
    $('#v3-import-preview').addEventListener('change', (e) => {
      if (e.target.classList.contains('v3-import-row')) updateImportSelCount();
    });
    $('#v3-import-sel').addEventListener('click', importSelected);
    $('#v3-import').addEventListener('click', async () => {
      const raw = $('#v3-import-in').value.trim();
      if (!raw) { toast('请粘贴导入 JSON', 'err'); return; }
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        toast('JSON 解析失败: ' + e.message, 'err');
        return;
      }
      const instances = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.instances) ? parsed.instances : null);
      if (!instances) { toast('未找到 instances 数组', 'err'); return; }
      if (!confirm(`将按配置创建 ${instances.length} 个实例，确认继续？`)) return;
      try {
        $('#v3-import-result').textContent = '导入中…';
        const r = await api.v3Post('instances/import', { instances });
        const d = r.data || {};
        $('#v3-import-result').textContent = `成功 ${d.created.length}，失败 ${d.failed.length}` +
          (d.failed.length ? '。' + d.failed.map((f) => f.name + ': ' + f.error).join('；').slice(0, 200) : '');
        toast(`导入完成：成功 ${d.created.length}，失败 ${d.failed.length}`);
        loadExportList();
      } catch (e) { $('#v3-import-result').textContent = e.message; }
    });
    $('#v3-clone').addEventListener('click', async () => {
      const target = selValue($('#v3-clone-instance'));
      const newName = $('#v3-clone-name').value.trim();
      if (!target) { toast('请选择源实例', 'err'); return; }
      if (!newName) { toast('请填写新实例名', 'err'); return; }
      try {
        const r = await api.v3Post('instance/clone', { daemonId: target.daemonId, uuid: target.uuid, newName });
        $('#v3-clone-result').textContent = `克隆成功：${r.data.nickname}（复制 ${r.data.copied} 个文件）`;
        toast('克隆完成');
        $('#v3-clone-name').value = '';
      } catch (e) { $('#v3-clone-result').textContent = e.message; }
    });

    // 操作日志
    $('#v3-ol-search').addEventListener('click', loadOpLogs);
    $('#v3-ol-user').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadOpLogs(); });
    $('#v3-ol-action').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadOpLogs(); });
    $('#v3-ol-export-csv').addEventListener('click', async () => {
      try {
        const r = await api.v3Get('operation-logs/export', {
          user: $('#v3-ol-user').value.trim(), action: $('#v3-ol-action').value.trim(),
          from: $('#v3-ol-from').value ? new Date($('#v3-ol-from').value + 'T00:00:00').getTime() : '',
          to: $('#v3-ol-to').value ? new Date($('#v3-ol-to').value + 'T23:59:59').getTime() : '',
          format: 'csv'
        });
        download(r.data.filename, '\ufeff' + r.data.content, r.data.mime);
      } catch (e) { toast(e.message, 'err'); }
    });
    $('#v3-ol-export-json').addEventListener('click', async () => {
      try {
        const r = await api.v3Get('operation-logs/export', {
          user: $('#v3-ol-user').value.trim(), action: $('#v3-ol-action').value.trim(),
          from: $('#v3-ol-from').value ? new Date($('#v3-ol-from').value + 'T00:00:00').getTime() : '',
          to: $('#v3-ol-to').value ? new Date($('#v3-ol-to').value + 'T23:59:59').getTime() : '',
          format: 'json'
        });
        download(r.data.filename, r.data.content, r.data.mime);
      } catch (e) { toast(e.message, 'err'); }
    });
  }

  // ---------------------------------------------------------------------------
  // 初始化
  // ---------------------------------------------------------------------------
  function init() {
    bindEvents();
    // 若当前已有会话（app.js 之后可能进入），尝试同步用户信息
    try {
      api.authStatus().then((s) => {
        if (s.role) setUser(s.user, s.role);
      }).catch(() => {});
    } catch (e) { /* 忽略 */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.MccPanel = global.MccPanel || {};
  global.MccPanel.v3 = V3;
})(typeof window !== 'undefined' ? window : globalThis);
