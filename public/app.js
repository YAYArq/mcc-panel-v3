(function () {
  'use strict';

  const { api } = window.MccPanel;

  // ---- 状态常量 ----
  const STATUS = {
    '-1': { label: '忙碌', cls: 'status-busy' },
    '0': { label: '已停止', cls: 'status-stopped' },
    '1': { label: '停止中', cls: 'status-stopping' },
    '2': { label: '启动中', cls: 'status-starting' },
    '3': { label: '运行中', cls: 'status-running' }
  };

  const TEXT_FILE_EXTS = ['.json', '.txt', '.ini', '.yml', '.yaml', '.cfg', '.conf', '.log', '.md', '.js', '.ts', '.properties', '.mcmeta', '.toml', '.sh', '.bat', '.xml', '.csv', '.lang'];

  // ---- DOM ----
  const $ = (sel) => document.querySelector(sel);
  const loginOverlay = $('#login-overlay');
  const loginForm = $('#login-form');
  const loginUser = $('#login-user');
  const loginPass = $('#login-pass');
  const loginError = $('#login-error');
  const loginTitle = $('#login-title');
  const appEl = $('#app');
  const brandTitle = $('#brand-title');
  const connStatus = $('#conn-status');
  const daemonSelect = $('#daemon-select');
  const searchInput = $('#search-input');
  const refreshBtn = $('#refresh-btn');
  const logoutBtn = $('#logout-btn');
  const selectAll = $('#select-all');
  const selectedCount = $('#selected-count');
  const listSummary = $('#list-summary');
  const instanceGrid = $('#instance-grid');
  const emptyState = $('#empty-state');
  const emptyText = $('#empty-text');
  const batchStart = $('#batch-start');
  const batchStop = $('#batch-stop');
  const batchRestart = $('#batch-restart');
  const createInstanceBtn = $('#create-instance-btn');

  const createOverlay = $('#create-overlay');
  const createForm = $('#create-form');
  const createName = $('#create-name');
  const createIp = $('#create-ip');
  const createPort = $('#create-port');
  const createAcctype = $('#create-acctype');
  const createLogin = $('#create-login');
  const createTpa = $('#create-tpa');
  const createResult = $('#create-result');
  const createCancel = $('#create-cancel');
  const themeToggle = $('#theme-toggle');
  const nodeFileBtn = $('#node-file-btn');
  const nodefileOverlay = $('#nodefile-overlay');
  const nodefileClose = $('#nodefile-close');
  const nodefilePath = $('#nodefile-path');
  const nodefileUp = $('#nodefile-up');
  const nodefileRefresh = $('#nodefile-refresh');
  const nodefileList = $('#nodefile-list');
  const nodefileEditorWrap = $('#nodefile-editor-wrap');
  const nodefileEditorName = $('#nodefile-editor-name');
  const nodefileSave = $('#nodefile-save');
  const nodefileCloseEditor = $('#nodefile-close-editor');
  const nodefileEditorResult = $('#nodefile-editor-result');
  const nodefileEditor = $('#nodefile-editor');
  const nodefileNew = $('#nodefile-new');
  const nodefileMkdir = $('#nodefile-mkdir');
  const nodefileRename = $('#nodefile-rename');
  const nodefileCopy = $('#nodefile-copy');
  const nodefilePaste = $('#nodefile-paste');
  const nodefileDelete = $('#nodefile-delete');
  const nodefileResult = $('#nodefile-result');
  const invRefresh = $('#inv-refresh');
  const invEnable = $('#inv-enable');
  const invDisable = $('#inv-disable');
  const invStatus = $('#inv-status');
  const invOffhand = $('#inv-offhand');
  const invArmor = $('#inv-armor');
  const invMainGrid = $('#inv-main-grid');
  const invHotbar = $('#inv-hotbar');
  const invDetail = $('#inv-detail');
  const invDetailText = $('#inv-detail-text');
  const invDropOne = $('#inv-drop-one');
  const invDropAll = $('#inv-drop-all');
  const invTimestamp = $('#inv-timestamp');
  const scriptNew = $('#script-new');
  const scriptRefresh = $('#script-refresh');
  const scriptStatus = $('#script-status');
  const scriptList = $('#script-list');
  const scriptEditorWrap = $('#script-editor-wrap');
  const scriptEditorName = $('#script-editor-name');
  const scriptSave = $('#script-save');
  const scriptRun = $('#script-run');
  const scriptClose = $('#script-close');
  const scriptEditorResult = $('#script-editor-result');
  const scriptEditor = $('#script-editor');
  const oplogRefresh = $('#oplog-refresh');
  const oplogList = $('#oplog-list');
  const oplogBtn = $('#oplog-btn');
  const oplogOverlay = $('#oplog-overlay');
  const oplogClose = $('#oplog-close');
  const perfStatus = $('#perf-status');
  const templateBtn = $('#template-btn');
  const templateOverlay = $('#template-overlay');
  const templateClose = $('#template-close');
  const templateList = $('#template-list');
  const templateInit = $('#template-init');
  const templateUploadBtn = $('#template-upload-btn');
  const templateFileInput = $('#template-file-input');

  const drawerOverlay = $('#drawer-overlay');
  const drawer = $('#drawer');
  const drawerStatusDot = $('#drawer-status-dot');
  const drawerTitle = $('#drawer-title');
  const drawerMeta = $('#drawer-meta');
  const drawerStart = $('#drawer-start');
  const drawerStop = $('#drawer-stop');
  const drawerRestart = $('#drawer-restart');
  const drawerKill = $('#drawer-kill');
  const drawerDelete = $('#drawer-delete');
  const drawerClose = $('#drawer-close');
  const batchDelete = $('#batch-delete');
  const tabs = document.querySelectorAll('.tab');
  const tabPanels = document.querySelectorAll('.tab-panel');

  const logAutoscroll = $('#log-autoscroll');
  const logLive = $('#log-live');
  const logSize = $('#log-size');
  const logClear = $('#log-clear');
  const logOutput = $('#log-output');
  const logChatInput = $('#log-chat-input');
  const logChatSend = $('#log-chat-send');

  const commandForm = $('#command-form');
  const commandInput = $('#command-input');
  const commandResult = $('#command-result');
  const commandHistory = $('#command-history');

  const configReload = $('#config-reload');
  const configSave = $('#config-save');
  const configResult = $('#config-result');
  const configEditor = $('#config-editor');
  const configSaveJson = $('#config-save-json');
  const configJsonResult = $('#config-json-result');
  const cfgNickname = $('#cfg-nickname');
  const cfgStart = $('#cfg-start');
  const cfgStop = $('#cfg-stop');
  const cfgCwd = $('#cfg-cwd');
  const cfgStopTimeout = $('#cfg-stop-timeout');
  const cfgAutostart = $('#cfg-autostart');
  const cfgAutorestart = $('#cfg-autorestart');
  const cfgAutorestartMax = $('#cfg-autorestart-max');
  const cfgColor = $('#cfg-color');

  const filePathEl = $('#file-path');
  const fileUp = $('#file-up');
  const fileRefresh = $('#file-refresh');
  const fileListEl = $('#file-list');
  const fileEditorWrap = $('#file-editor-wrap');
  const fileEditorName = $('#file-editor-name');
  const fileSave = $('#file-save');
  const fileClose = $('#file-close');
  const fileResult = $('#file-result');
  const fileEditor = $('#file-editor');
  const fileNew = $('#file-new');
  const fileMkdir = $('#file-mkdir');
  const fileRename = $('#file-rename');
  const fileCopyBtn = $('#file-copy');
  const filePaste = $('#file-paste');
  const fileDelete = $('#file-delete');
  const fileOpResult = $('#file-op-result');

  const toastEl = $('#toast');

  // ---- 主题切换（黑夜/白天）----
  const THEME_KEY = 'yayabot_theme';
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    if (themeToggle) themeToggle.textContent = theme === 'light' ? '☀️' : '🌙';
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* 忽略 */ }
  }
  (function initTheme() {
    let saved = 'dark';
    try { saved = localStorage.getItem(THEME_KEY) || 'dark'; } catch (e) { /* 忽略 */ }
    applyTheme(saved);
  })();
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme');
      applyTheme(cur === 'light' ? 'dark' : 'light');
    });
  }

  // ---- 应用状态 ----
  let config = null;
  let daemons = [];
  let currentDaemonId = '';
  let instances = [];
  let selected = new Set();
  let currentInstance = null; // { daemonId, uuid, nickname, status, detail }
  let listTimer = null;
  let logTimer = null;
  let logFetching = false;
  let fileTarget = '';
  let fileEditing = null; // 正在编辑的文件名
  let fileClipboard = null; // { dir, names } 复制/粘贴
  let nodeFileTarget = '/mcc'; // 节点文件浏览器当前路径
  let nodeFileClipboard = null;
  let nodeFileEditing = null;
  let commandHistoryData = loadCommandHistory();
  let currentConfig = null; // 当前实例的完整配置（表单保存时合并用）
  let lastLogText = ''; // 上次日志内容（前端时间戳用）

  function loadCommandHistory() {
    try {
      return JSON.parse(localStorage.getItem('mcc_cmd_history') || '[]');
    } catch (e) {
      return [];
    }
  }
  function saveCommandHistory() {
    localStorage.setItem('mcc_cmd_history', JSON.stringify(commandHistoryData.slice(0, 20)));
  }
  function pushCommandHistory(cmd) {
    commandHistoryData = [cmd].concat(commandHistoryData.filter((c) => c !== cmd)).slice(0, 20);
    saveCommandHistory();
    renderCommandHistory();
  }

  // ---- 工具 ----
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // 去掉 ANSI 转义序列（颜色/样式控制码）。MCC 输出的日志带这些码，
  // 用于在终端里上色，网页不会解释它们，会显示成 [90m、[0m、[38;2;...m 之类的乱码。
  function stripAnsi(text) {
    if (typeof text !== 'string') return text;
    // 兼容 ESC(1B) 与 CSI 8-bit(9B)，覆盖 SGR 颜色及常见 CSI 序列
    // eslint-disable-next-line no-control-regex
    return text.replace(/[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, '');
  }

  function statusOf(code) {
    return STATUS[String(code)] || { label: '未知', cls: 'status-stopped' };
  }

  function toast(message, type = 'ok') {
    toastEl.textContent = message;
    toastEl.className = 'toast ' + (type === 'ok' ? 'ok' : 'err');
    toastEl.classList.remove('hidden', 'closing');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toastEl.classList.add('closing');
      setTimeout(() => toastEl.classList.add('hidden'), 300);
    }, 2200);
  }

  // 模态打开/关闭（带淡出过渡）
  function openModal(overlay) {
    overlay.classList.remove('hidden', 'closing');
  }
  function closeModal(overlay) {
    if (overlay.classList.contains('closing')) return;
    overlay.classList.add('closing');
    setTimeout(() => {
      overlay.classList.add('hidden');
      overlay.classList.remove('closing');
    }, 250);
  }

  function setConnStatus(text, isErr) {
    connStatus.textContent = text;
    connStatus.className = 'conn-status ' + (isErr ? 'err' : 'ok');
  }

  function formatBytes(n) {
    if (!Number.isFinite(n) || n <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return n.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
  }

  // ---- 认证 ----
  async function init() {
    try {
      const status = await api.authStatus();
      if (status.authed) { await enterApp(); } else { showLogin(); }
    } catch (error) {
      showLogin();
    }
  }

  function showLogin() {
    appEl.classList.add('hidden');
    loginOverlay.classList.remove('hidden');
    loginUser.focus();
  }

  async function enterApp() {
    loginOverlay.classList.add('hidden');
    appEl.classList.remove('hidden');
    try {
      config = await api.config();
    } catch (e) {
      config = {};
    }
    brandTitle.textContent = config.title || 'YAYA MCC BOT';
    loginTitle.textContent = config.title || 'YAYA MCC BOT';
    document.title = config.title || 'YAYA MCC BOT';

    await loadDaemons();
    startPolling();
    startPerfPolling();
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = loginUser.value.trim();
    const password = loginPass.value;
    if (!username || !password) return;
    loginError.classList.add('hidden');
    try {
      const r = await api.login(username, password);
      if (r.ok) { loginUser.value = ''; loginPass.value = ''; await enterApp(); }
      else {
        loginError.textContent = r.error || '登录失败';
        loginError.classList.remove('hidden');
      }
    } catch (error) {
      loginError.textContent = error.message || '登录失败';
      loginError.classList.remove('hidden');
    }
  });

  logoutBtn.addEventListener('click', async () => {
    await api.logout();
    stopPolling();
    closeDrawer();
    showLogin();
  });

  // ---- daemon 列表 ----
  async function loadDaemons() {
    let list = [];
    try {
      const r = await api.daemons();
      list = (r && r.data) || [];
    } catch (error) {
      setConnStatus('节点加载失败', true);
      list = [];
    }
    daemons = Array.isArray(list) ? list : [];

    daemonSelect.innerHTML = '';
    if (daemons.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '无可用节点';
      daemonSelect.appendChild(opt);
      currentDaemonId = '';
      instances = [];
      renderInstances();
      setConnStatus('未找到 MCSM 节点', true);
      return;
    }

    daemons.forEach((d) => {
      const opt = document.createElement('option');
      opt.value = d.uuid || '';
      opt.textContent = daemonLabel(d);
      daemonSelect.appendChild(opt);
    });

    // 默认选第一个 available 的
    const firstAvailable = daemons.find((d) => d.available !== false) || daemons[0];
    currentDaemonId = firstAvailable.uuid || '';
    daemonSelect.value = currentDaemonId;

    setConnStatus(`${daemons.length} 个节点已就绪`, false);
    await loadInstances();
  }

  function daemonLabel(d) {
    if (d.remarks) return d.remarks;
    if (d.ip && d.port) return `${d.ip}:${d.port}`;
    return (d.uuid || '').slice(0, 8);
  }

  daemonSelect.addEventListener('change', () => {
    currentDaemonId = daemonSelect.value;
    selected.clear();
    renderSelectedCount();
    loadInstances();
    refreshPerf();
  });

  // ---- 实例列表 ----
  async function loadInstances() {
    if (!currentDaemonId) { instances = []; renderInstances(); return; }
    try {
      const r = await api.instances({
        daemonId: currentDaemonId,
        page: 1,
        page_size: 50,
        instance_name: searchInput.value.trim() || undefined
      });
      const payload = (r && r.data) || {};
      instances = Array.isArray(payload.data) ? payload.data : [];
      setConnStatus('已连接', false);
    } catch (error) {
      setConnStatus('实例加载失败: ' + error.message, true);
      instances = [];
    }
    renderInstances();
  }

  function renderInstances() {
    instanceGrid.innerHTML = '';
    const hasAny = instances.length > 0;
    emptyState.classList.toggle('hidden', hasAny);

    if (!hasAny) {
      emptyText.textContent = searchInput.value.trim()
        ? '没有匹配的实例'
        : (currentDaemonId ? '该节点暂无实例' : '请先在 MCSM 中创建实例');
      listSummary.textContent = '共 0 个实例';
      return;
    }

    let running = 0;
    instances.forEach((inst) => {
      const code = Number(inst.status);
      if (code === 3) running++;
      instanceGrid.appendChild(renderCard(inst));
    });
    listSummary.textContent = `共 ${instances.length} 个实例 · 运行中 ${running}`;
    renderSelectedCount();
  }

  const renderedCards = new Set();

  function renderCard(inst) {
    const card = document.createElement('div');
    const isNewCard = !renderedCards.has(inst.instanceUuid);
    renderedCards.add(inst.instanceUuid);
    card.className = 'instance-card' + (isNewCard ? ' card-enter' : '') +
      (selected.has(inst.instanceUuid) ? ' selected' : '');
    card.dataset.uuid = inst.instanceUuid;

    const status = statusOf(inst.status);
    const nickname = (inst.config && inst.config.nickname) || inst.instanceUuid;
    const startCommand = (inst.config && inst.config.startCommand) || '';

    card.innerHTML = `
      <div class="card-top">
        <img class="card-avatar" alt="头像">
        <div class="card-head">
          <span class="card-name">${escapeHtml(nickname)}</span>
          <span class="badge ${status.cls}"><span class="status-dot"></span>${status.label}</span>
        </div>
        <input type="checkbox" class="card-check" ${selected.has(inst.instanceUuid) ? 'checked' : ''}>
      </div>
      <div class="card-meta">
        <span>启动 <b>${Number(inst.started) || 0}</b></span>
        <span>自动重启 <b>${Number(inst.autoRestarted) || 0}</b></span>
      </div>
      <div class="card-cmd" title="${escapeHtml(startCommand)}">${escapeHtml(truncate(startCommand, 44))}</div>
      <div class="card-actions">
        <button class="btn btn-sm act-start" data-action="open">启动</button>
        <button class="btn btn-sm act-stop" data-action="stop">停止</button>
        <button class="btn btn-sm act-restart" data-action="restart">重启</button>
      </div>
    `;

    loadAvatar(inst.instanceUuid, card.querySelector('.card-avatar'));

    // 复选框
    card.querySelector('.card-check').addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.target.checked) selected.add(inst.instanceUuid);
      else selected.delete(inst.instanceUuid);
      card.classList.toggle('selected', selected.has(inst.instanceUuid));
      renderSelectedCount();
      syncSelectAll();
    });

    // 操作按钮
    card.querySelectorAll('.act-start, .act-stop, .act-restart').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        doAction(inst.instanceUuid, btn.dataset.action);
      });
    });

    // 卡片点击打开详情
    card.addEventListener('click', () => openDrawer(inst.instanceUuid));
    return card;
  }

  const avatarCache = new Map();

  function loadAvatar(uuid, img) {
    img.onerror = () => { img.onerror = null; img.src = ''; img.classList.add('avatar-fallback'); };
    if (avatarCache.has(uuid)) {
      const name = avatarCache.get(uuid);
      if (name) img.src = 'https://minotar.net/helm/' + encodeURIComponent(name) + '/64.png';
      else img.classList.add('avatar-fallback');
      return;
    }
    api.username(currentDaemonId, uuid).then((r) => {
      const name = (r && r.data) || null;
      avatarCache.set(uuid, name);
      if (name) img.src = 'https://minotar.net/helm/' + encodeURIComponent(name) + '/64.png';
      else img.classList.add('avatar-fallback');
    }).catch(() => { img.classList.add('avatar-fallback'); });
  }

  function truncate(s, n) {
    s = String(s || '');
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  // ---- 操作 ----
  async function doAction(uuid, action, silent) {
    if (!uuid || !currentDaemonId) return;
    try {
      await api.action(currentDaemonId, uuid, action);
      if (!silent) toast(actionLabel(action) + '指令已发送');
      await loadInstances();
      if (currentInstance && currentInstance.uuid === uuid) {
        await refreshDrawerMeta();
      }
    } catch (error) {
      toast('操作失败: ' + error.message, 'err');
    }
  }

  function actionLabel(action) {
    return { open: '启动', stop: '停止', restart: '重启', kill: '强杀' }[action] || action;
  }

  // ---- 批量 ----
  function renderSelectedCount() {
    const n = selected.size;
    selectedCount.textContent = n > 0 ? `已选 ${n} 个` : '未选择';
    batchStart.disabled = batchStop.disabled = batchRestart.disabled = n === 0;
    syncSelectAll();
  }

  function syncSelectAll() {
    const all = instances.map((i) => i.instanceUuid);
    const allSelected = all.length > 0 && all.every((id) => selected.has(id));
    selectAll.checked = allSelected;
  }

  selectAll.addEventListener('change', () => {
    if (selectAll.checked) instances.forEach((i) => selected.add(i.instanceUuid));
    else instances.forEach((i) => selected.delete(i.instanceUuid));
    renderInstances();
  });

  function selectedInCurrentDaemon() {
    return instances.filter((i) => selected.has(i.instanceUuid));
  }

  async function batchAction(action) {
    const targets = selectedInCurrentDaemon();
    if (targets.length === 0) return toast('请先选择实例', 'err');
    for (const inst of targets) {
      await doAction(inst.instanceUuid, action, true);
    }
    toast(`已对 ${targets.length} 个实例发送「${actionLabel(action)}」`);
    loadInstances();
  }

  batchStart.addEventListener('click', () => batchAction('open'));
  batchStop.addEventListener('click', () => batchAction('stop'));
  batchRestart.addEventListener('click', () => batchAction('restart'));

  batchDelete.addEventListener('click', () => {
    const targets = selectedInCurrentDaemon();
    if (targets.length === 0) return toast('请先勾选要删除的实例', 'err');
    const uuids = targets.map((i) => i.instanceUuid);
    deleteInstances(uuids, null);
  });
  refreshBtn.addEventListener('click', loadInstances);
  searchInput.addEventListener('input', debounce(() => loadInstances(), 300));

  function debounce(fn, ms) {
    let t;
    return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  // ---- 轮询 ----
  function startPolling() {
    stopPolling();
    const listInterval = (config && config.listPollIntervalMs) || 4000;
    listTimer = setInterval(() => loadInstances(), listInterval);
  }
  function stopPolling() {
    if (listTimer) clearInterval(listTimer);
    if (logTimer) clearInterval(logTimer);
    listTimer = null;
    logTimer = null;
  }

  // ---- 详情抽屉 ----
  async function openDrawer(uuid) {
    const inst = instances.find((i) => i.instanceUuid === uuid);
    if (!inst) return;
    currentInstance = {
      daemonId: currentDaemonId,
      uuid,
      nickname: (inst.config && inst.config.nickname) || uuid,
      status: inst.status,
      detail: inst
    };

    drawerTitle.textContent = currentInstance.nickname;
    updateDrawerStatus(inst.status);
    drawer.classList.remove('hidden', 'closing');
    drawerOverlay.classList.remove('hidden', 'closing');
    document.body.style.overflow = 'hidden';

    // 重置子面板
    resetTabsToLog();
    fileTarget = '';
    fileEditing = null;
    fileEditorWrap.classList.add('hidden');
    fileListEl.innerHTML = '';
    configResult.textContent = '';
    commandResult.textContent = '';
    logOutput.textContent = '';

    await refreshDrawerMeta();
    startLogPolling();
    loadConfigTab();
    loadFilesTab();
  }

  function updateDrawerStatus(code) {
    const colors = {
      running: 'var(--green)',
      starting: 'var(--yellow)',
      stopping: 'var(--orange)',
      stopped: 'var(--gray)',
      busy: 'var(--purple)'
    };
    drawerStatusDot.className = 'status-dot';
    drawerStatusDot.style.background = colors[statusOf(code).cls.replace('status-', '')] || 'var(--gray)';
  }

  async function refreshDrawerMeta() {
    if (!currentInstance) return;
    try {
      const r = await api.instance(currentInstance.daemonId, currentInstance.uuid);
      const detail = (r && r.data) || null;
      if (detail) {
        currentInstance.detail = detail;
        currentInstance.status = detail.status;
        updateDrawerStatus(detail.status);
        const cfg = detail.config || {};
        const info = detail.info || {};
        drawerMeta.innerHTML = `
          <span>状态 <b>${statusOf(detail.status).label}</b></span>
          <span>UUID <b>${escapeHtml(detail.instanceUuid || currentInstance.uuid)}</b></span>
          <span>启动次数 <b>${Number(detail.started) || 0}</b></span>
          <span>cwd <b>${escapeHtml(cfg.cwd || '-')}</b></span>
          ${info.currentPlayers !== undefined ? `<span>在线 <b>${info.currentPlayers}/${info.maxPlayers || 0}</b></span>` : ''}
        `;
      }
    } catch (error) {
      // 静默
    }
  }

  function closeDrawer() {
    if (drawer.classList.contains('closing')) return;
    drawer.classList.add('closing');
    drawerOverlay.classList.add('closing');
    document.body.style.overflow = '';
    currentInstance = null;
    if (logTimer) clearInterval(logTimer);
    logTimer = null;
    setTimeout(() => {
      drawer.classList.add('hidden');
      drawerOverlay.classList.add('hidden');
      drawer.classList.remove('closing');
      drawerOverlay.classList.remove('closing');
    }, 280);
  }

  drawerClose.addEventListener('click', closeDrawer);
  drawerOverlay.addEventListener('click', closeDrawer);

  drawerStart.addEventListener('click', () => currentInstance && doAction(currentInstance.uuid, 'open'));
  drawerStop.addEventListener('click', () => currentInstance && doAction(currentInstance.uuid, 'stop'));
  drawerRestart.addEventListener('click', () => currentInstance && doAction(currentInstance.uuid, 'restart'));
  drawerKill.addEventListener('click', () => {
    if (!currentInstance) return;
    if (confirm('确定强制终止该实例进程？')) doAction(currentInstance.uuid, 'kill');
  });

  // 删除实例（支持：是否连文件一起删除）
  async function deleteInstances(uuids, nickname) {
    if (!uuids.length || !currentDaemonId) return;
    if (!confirm('确定删除实例' + (nickname ? '「' + nickname + '」' : '（' + uuids.length + ' 个）') + '？')) return;
    const deleteFile = confirm('同时删除实例文件（含 MCC 程序与配置，不可恢复）？\n\n点「确定」= 连文件删除\n点「取消」= 仅删除实例记录，保留文件');
    try {
      await api.deleteInstance(currentDaemonId, uuids, deleteFile);
      toast('已删除 ' + (nickname || uuids.length + ' 个实例'));
      selected.clear();
      closeDrawer();
      await loadInstances();
    } catch (error) {
      toast('删除失败: ' + error.message, 'err');
    }
  }

  drawerDelete.addEventListener('click', () => {
    if (!currentInstance) return;
    deleteInstances([currentInstance.uuid], currentInstance.nickname);
  });

  // ---- 标签页 ----
  function resetTabsToLog() {
    switchTab('log');
  }
  function switchTab(name) {
    tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    tabPanels.forEach((p) => p.classList.toggle('hidden', p.id !== 'tab-' + name));
    if (name === 'inventory') refreshInventory();
    if (name === 'scripts') loadScripts();
  }
  tabs.forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));

  // ---- 日志 ----
  function startLogPolling() {
    if (logTimer) clearInterval(logTimer);
    const interval = (config && config.logPollIntervalMs) || 2000;
    fetchLog();
    logTimer = setInterval(() => {
      if (logLive.checked) fetchLog();
    }, interval);
  }

  async function fetchLog() {
    if (!currentInstance || logFetching) return;
    logFetching = true;
    try {
      const r = await api.outputlog(currentInstance.daemonId, currentInstance.uuid, 65536);
      const raw = typeof r.data === 'string' ? r.data : JSON.stringify(r.data || '');
      const text = stripAnsi(raw);
      const shouldScroll = logAutoscroll.checked &&
        (logOutput.scrollTop + logOutput.clientHeight >= logOutput.scrollHeight - 40);

      // 前端时间戳：日志累积时，给新增行加上时间
      let display = text;
      if (lastLogText && text.length > lastLogText.length && text.startsWith(lastLogText)) {
        const newPart = text.slice(lastLogText.length);
        const t = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        const stamped = newPart.split('\n').filter((l) => l.trim()).map((l) => '[' + t + '] ' + l).join('\n');
        display = logOutput.textContent + (stamped ? '\n' + stamped : '');
        if (display.length > 300000) display = display.slice(-300000);
      }
      lastLogText = text;
      logOutput.textContent = display;
      logSize.textContent = formatBytes(new Blob([display]).size);
      if (shouldScroll || logAutoscroll.checked) {
        logOutput.scrollTop = logOutput.scrollHeight;
      }
    } catch (error) {
      logOutput.textContent = '日志加载失败: ' + error.message;
    } finally {
      logFetching = false;
    }
  }

  logClear.addEventListener('click', () => { logOutput.textContent = ''; lastLogText = ''; });

  // 日志面板快捷发消息（不带 / 的文本 = 游戏聊天消息）
  logChatSend.addEventListener('click', () => {
    const msg = logChatInput.value.trim();
    if (!msg || !currentInstance) return;
    sendCommand(msg);
    logChatInput.value = '';
  });
  logChatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); logChatSend.click(); }
  });

  // ---- 命令 ----
  async function sendCommand(cmd) {
    if (!cmd || !currentInstance) return false;
    commandResult.textContent = '发送中…';
    commandResult.className = 'command-result';
    try {
      await api.command(currentInstance.daemonId, currentInstance.uuid, cmd);
      commandResult.textContent = '已发送';
      commandResult.className = 'command-result ok';
      pushCommandHistory(cmd);
      return true;
    } catch (error) {
      commandResult.textContent = '发送失败: ' + error.message;
      commandResult.className = 'command-result err';
      return false;
    }
  }

  commandForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const cmd = commandInput.value.trim();
    if (!cmd || !currentInstance) return;
    const ok = await sendCommand(cmd);
    if (ok) commandInput.value = '';
  });

  // 快捷命令按钮：data-cmd 直接发送，data-fill 填入输入框（需补充参数）
  document.querySelectorAll('.qcmd').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!currentInstance) { toast('请先选择一个实例', 'err'); return; }
      const direct = btn.dataset.cmd;
      const fill = btn.dataset.fill;
      if (fill !== undefined) {
        commandInput.value = fill;
        commandInput.focus();
      } else if (direct) {
        sendCommand(direct);
      }
    });
  });

  function renderCommandHistory() {
    commandHistory.innerHTML = '';
    if (commandHistoryData.length === 0) {
      commandHistory.innerHTML = '<li style="cursor:default;color:var(--text-dim)">暂无历史</li>';
      return;
    }
    commandHistoryData.forEach((cmd) => {
      const li = document.createElement('li');
      li.textContent = cmd;
      li.title = '点击填入';
      li.addEventListener('click', () => { commandInput.value = cmd; commandInput.focus(); });
      commandHistory.appendChild(li);
    });
  }

  // ---- 配置 ----
  async function loadConfigTab() {
    if (!currentInstance) return;
    try {
      const r = await api.instance(currentInstance.daemonId, currentInstance.uuid);
      const detail = (r && r.data) || null;
      const cfg = (detail && detail.config) || {};
      currentConfig = cfg; // 保留原始配置，表单保存时在它基础上合并
      // 填充表单
      cfgNickname.value = cfg.nickname || '';
      cfgStart.value = cfg.startCommand || '';
      cfgStop.value = cfg.stopCommand || '';
      cfgCwd.value = cfg.cwd || '';
      cfgStopTimeout.value = cfg.stopTimeout || 0;
      cfgAutostart.checked = !!(cfg.eventTask && cfg.eventTask.autoStart);
      cfgAutorestart.checked = !!(cfg.eventTask && cfg.eventTask.autoRestart);
      cfgAutorestartMax.value = (cfg.eventTask && cfg.eventTask.autoRestartMaxTimes) || 3;
      cfgColor.checked = !!(cfg.terminalOption && cfg.terminalOption.haveColor);
      configEditor.value = JSON.stringify(cfg, null, 2);
      configResult.textContent = '';
    } catch (error) {
      configResult.textContent = '配置加载失败: ' + error.message;
      configResult.className = 'command-result err';
    }
  }

  // 从表单收集配置（在原始配置上合并，保留表单未涉及的字段）
  function collectConfigFromForm() {
    const cfg = { ...(currentConfig || {}) };
    cfg.nickname = cfgNickname.value.trim();
    cfg.startCommand = cfgStart.value;
    cfg.stopCommand = cfgStop.value;
    cfg.cwd = cfgCwd.value;
    cfg.stopTimeout = Number(cfgStopTimeout.value) || 0;
    cfg.eventTask = {
      ...(cfg.eventTask || {}),
      autoStart: cfgAutostart.checked,
      autoRestart: cfgAutorestart.checked,
      autoRestartMaxTimes: Number(cfgAutorestartMax.value) || 3
    };
    cfg.terminalOption = {
      ...(cfg.terminalOption || {}),
      haveColor: cfgColor.checked
    };
    return cfg;
  }

  configReload.addEventListener('click', loadConfigTab);

  configSave.addEventListener('click', async () => {
    if (!currentInstance) return;
    const cfg = collectConfigFromForm();
    try {
      await api.updateConfig(currentInstance.daemonId, currentInstance.uuid, cfg);
      configResult.textContent = '已保存';
      configResult.className = 'command-result ok';
      await refreshDrawerMeta();
      loadInstances();
    } catch (error) {
      configResult.textContent = '保存失败: ' + error.message;
      configResult.className = 'command-result err';
    }
  });

  configSaveJson.addEventListener('click', async () => {
    if (!currentInstance) return;
    let cfg;
    try {
      cfg = JSON.parse(configEditor.value);
    } catch (error) {
      configJsonResult.textContent = 'JSON 格式错误: ' + error.message;
      configJsonResult.className = 'command-result err';
      return;
    }
    try {
      await api.updateConfig(currentInstance.daemonId, currentInstance.uuid, cfg);
      configJsonResult.textContent = '已保存';
      configJsonResult.className = 'command-result ok';
      await refreshDrawerMeta();
      loadInstances();
    } catch (error) {
      configJsonResult.textContent = '保存失败: ' + error.message;
      configJsonResult.className = 'command-result err';
    }
  });

  // ---- 文件 ----
  async function loadFilesTab() {
    if (!currentInstance) return;
    filePathEl.textContent = fileTarget || '/';
    fileListEl.innerHTML = '<div class="panel-hint">加载中…</div>';
    fileEditorWrap.classList.add('hidden');
    fileEditing = null;
    try {
      const r = await api.fileList(currentInstance.daemonId, currentInstance.uuid, fileTarget);
      const payload = (r && r.data) || {};
      const items = Array.isArray(payload.items) ? payload.items : [];
      renderFileList(items);
      filePathEl.textContent = payload.absolutePath || fileTarget || '/';
    } catch (error) {
      fileListEl.innerHTML = '<div class="panel-hint">文件列表加载失败: ' + escapeHtml(error.message) + '</div>';
    }
  }

  function renderFileList(items) {
    fileListEl.innerHTML = '';
    if (items.length === 0) {
      fileListEl.innerHTML = '<div class="panel-hint">（空目录）</div>';
      return;
    }
    items.forEach((item) => {
      const row = document.createElement('div');
      const isDir = Number(item.type) === 0;
      row.className = 'file-row ' + (isDir ? 'dir' : 'file');
      row.innerHTML = `
        <input type="checkbox" class="file-check" value="${escapeHtml(item.name)}">
        <span class="file-icon">${isDir ? '📁' : '📄'}</span>
        <span class="file-name">${escapeHtml(item.name)}</span>
        <span class="file-size">${isDir ? '' : formatBytes(item.size)}</span>
      `;
      row.addEventListener('click', (e) => {
        if (e.target.classList.contains('file-check')) return; // 勾选不触发打开
        if (isDir) {
          fileTarget = joinPath(fileTarget, item.name);
          loadFilesTab();
        } else {
          openFileEditor(item.name);
        }
      });
      fileListEl.appendChild(row);
    });
  }

  function selectedFileNames() {
    return Array.from(fileListEl.querySelectorAll('.file-check:checked')).map((cb) => cb.value);
  }

  function doFileOp(fn, okMsg) {
    if (!currentInstance) return;
    fileOpResult.textContent = '处理中…';
    fileOpResult.className = 'command-result';
    fn().then(() => {
      fileOpResult.textContent = okMsg;
      fileOpResult.className = 'command-result ok';
      loadFilesTab();
    }).catch((error) => {
      fileOpResult.textContent = '操作失败: ' + error.message;
      fileOpResult.className = 'command-result err';
    });
  }

  fileNew.addEventListener('click', () => {
    const name = (prompt('新建文件名：') || '').trim();
    if (!name) return;
    doFileOp(() => api.fileTouch(currentInstance.daemonId, currentInstance.uuid, joinPath(fileTarget, name)), '已新建 ' + name);
  });

  fileMkdir.addEventListener('click', () => {
    const name = (prompt('新建目录名：') || '').trim();
    if (!name) return;
    doFileOp(() => api.fileMkdir(currentInstance.daemonId, currentInstance.uuid, joinPath(fileTarget, name)), '已新建目录 ' + name);
  });

  fileRename.addEventListener('click', () => {
    const sel = selectedFileNames();
    if (sel.length !== 1) return toast('请选中一个文件/目录', 'err');
    const oldName = sel[0];
    const newName = (prompt('重命名为：', oldName) || '').trim();
    if (!newName || newName === oldName) return;
    doFileOp(() => api.fileMove(currentInstance.daemonId, currentInstance.uuid, [[joinPath(fileTarget, oldName), joinPath(fileTarget, newName)]]), '已重命名');
  });

  fileCopyBtn.addEventListener('click', () => {
    const sel = selectedFileNames();
    if (sel.length === 0) return toast('请先勾选文件/目录', 'err');
    fileClipboard = { dir: fileTarget, names: sel };
    toast('已复制 ' + sel.length + ' 项到剪贴板');
  });

  filePaste.addEventListener('click', () => {
    if (!fileClipboard || !fileClipboard.names.length) return toast('剪贴板为空', 'err');
    const targets = fileClipboard.names.map((n) => [joinPath(fileClipboard.dir, n), joinPath(fileTarget, n)]);
    doFileOp(() => api.fileCopy(currentInstance.daemonId, currentInstance.uuid, targets), '已粘贴 ' + targets.length + ' 项');
  });

  fileDelete.addEventListener('click', () => {
    const sel = selectedFileNames();
    if (sel.length === 0) return toast('请先勾选文件/目录', 'err');
    if (!confirm('确定删除 ' + sel.length + ' 个文件/目录？此操作不可恢复。')) return;
    const targets = sel.map((n) => joinPath(fileTarget, n));
    doFileOp(() => api.fileDelete(currentInstance.daemonId, currentInstance.uuid, targets), '已删除 ' + sel.length + ' 项');
  });

  function joinPath(base, name) {
    base = base || '';
    base = base.replace(/\/+$/, '');
    return base ? base + '/' + name : name;
  }

  function parentPath(p) {
    p = (p || '').replace(/\/+$/, '');
    const idx = p.lastIndexOf('/');
    return idx <= 0 ? '' : p.slice(0, idx);
  }

  async function openFileEditor(name) {
    if (!currentInstance) return;
    const target = joinPath(fileTarget, name);
    fileResult.textContent = '读取中…';
    fileResult.className = 'command-result';
    try {
      const r = await api.fileRead(currentInstance.daemonId, currentInstance.uuid, target);
      const text = typeof r.data === 'string' ? r.data : JSON.stringify(r.data || '', null, 2);
      fileEditing = target;
      fileEditorName.textContent = target;
      fileEditor.value = text;
      fileEditorWrap.classList.remove('hidden');
      fileResult.textContent = '';
    } catch (error) {
      fileResult.textContent = '读取失败: ' + error.message;
      fileResult.className = 'command-result err';
    }
  }

  fileClose.addEventListener('click', () => {
    fileEditing = null;
    fileEditorWrap.classList.add('hidden');
    fileEditor.value = '';
  });

  fileSave.addEventListener('click', async () => {
    if (!currentInstance || !fileEditing) return;
    try {
      await api.fileWrite(currentInstance.daemonId, currentInstance.uuid, fileEditing, fileEditor.value);
      fileResult.textContent = '已保存';
      fileResult.className = 'command-result ok';
    } catch (error) {
      fileResult.textContent = '保存失败: ' + error.message;
      fileResult.className = 'command-result err';
    }
  });

  fileUp.addEventListener('click', () => {
    fileTarget = parentPath(fileTarget);
    loadFilesTab();
  });
  fileRefresh.addEventListener('click', loadFilesTab);

  // ---- 节点文件管理 ----
  const GLOBAL_INSTANCE = 'global0001';

  function openNodeFiles() {
    nodeFileTarget = '/'; // 自适应：从根目录开始，不同节点路径不同
    nodeFileClipboard = null;
    nodefileResult.textContent = '';
    nodefileOverlay.classList.remove('hidden');
    nodefileOverlay.classList.remove('closing');
    loadNodeFiles();
  }

  async function loadNodeFiles() {
    if (!currentDaemonId) return;
    nodefilePath.textContent = nodeFileTarget || '/';
    nodefileList.innerHTML = '<div class="panel-hint">加载中…</div>';
    nodefileEditorWrap.classList.add('hidden');
    nodeFileEditing = null;
    try {
      const r = await api.fileList(currentDaemonId, GLOBAL_INSTANCE, nodeFileTarget);
      const payload = (r && r.data) || {};
      const items = Array.isArray(payload.items) ? payload.items : [];
      renderNodeFiles(items);
      if (payload.absolutePath) nodeFileTarget = payload.absolutePath;
      nodefilePath.textContent = nodeFileTarget || '/';
    } catch (error) {
      nodefileList.innerHTML = '<div class="panel-hint">加载失败: ' + escapeHtml(error.message) + '</div>';
    }
  }

  function renderNodeFiles(items) {
    nodefileList.innerHTML = '';
    if (items.length === 0) {
      nodefileList.innerHTML = '<div class="panel-hint">（空目录）</div>';
      return;
    }
    items.forEach((item) => {
      const row = document.createElement('div');
      const isDir = Number(item.type) === 0;
      row.className = 'file-row ' + (isDir ? 'dir' : 'file');
      row.innerHTML = `
        <input type="checkbox" class="file-check" value="${escapeHtml(item.name)}">
        <span class="file-icon">${isDir ? '📁' : '📄'}</span>
        <span class="file-name">${escapeHtml(item.name)}</span>
        <span class="file-size">${isDir ? '' : formatBytes(item.size)}</span>
      `;
      row.addEventListener('click', (e) => {
        if (e.target.classList.contains('file-check')) return;
        if (isDir) {
          nodeFileTarget = joinPath(nodeFileTarget, item.name);
          loadNodeFiles();
        } else {
          openNodeFileEditor(item.name);
        }
      });
      nodefileList.appendChild(row);
    });
  }

  function selectedNodeFiles() {
    return Array.from(nodefileList.querySelectorAll('.file-check:checked')).map((cb) => cb.value);
  }

  function doNodeFileOp(fn, okMsg) {
    if (!currentDaemonId) return;
    nodefileResult.textContent = '处理中…';
    nodefileResult.className = 'command-result';
    fn().then(() => {
      nodefileResult.textContent = okMsg;
      nodefileResult.className = 'command-result ok';
      loadNodeFiles();
    }).catch((error) => {
      nodefileResult.textContent = '操作失败: ' + error.message;
      nodefileResult.className = 'command-result err';
    });
  }

  async function openNodeFileEditor(name) {
    if (!currentDaemonId) return;
    const target = joinPath(nodeFileTarget, name);
    nodefileEditorResult.textContent = '读取中…';
    nodefileEditorResult.className = 'command-result';
    try {
      const r = await api.fileRead(currentDaemonId, GLOBAL_INSTANCE, target);
      const text = typeof r.data === 'string' ? r.data : JSON.stringify(r.data || '', null, 2);
      nodeFileEditing = target;
      nodefileEditorName.textContent = target;
      nodefileEditor.value = text;
      nodefileEditorWrap.classList.remove('hidden');
      nodefileEditorResult.textContent = '';
    } catch (error) {
      nodefileEditorResult.textContent = '读取失败: ' + error.message;
      nodefileEditorResult.className = 'command-result err';
    }
  }

  nodeFileBtn.addEventListener('click', openNodeFiles);
  nodefileClose.addEventListener('click', () => closeModal(nodefileOverlay));
  nodefileOverlay.addEventListener('click', (e) => { if (e.target === nodefileOverlay) closeModal(nodefileOverlay); });
  nodefileUp.addEventListener('click', () => { nodeFileTarget = parentPath(nodeFileTarget); loadNodeFiles(); });
  nodefileRefresh.addEventListener('click', loadNodeFiles);
  nodefileCloseEditor.addEventListener('click', () => { nodeFileEditing = null; nodefileEditorWrap.classList.add('hidden'); nodefileEditor.value = ''; });
  nodefileSave.addEventListener('click', async () => {
    if (!currentDaemonId || !nodeFileEditing) return;
    try {
      await api.fileWrite(currentDaemonId, GLOBAL_INSTANCE, nodeFileEditing, nodefileEditor.value);
      nodefileEditorResult.textContent = '已保存';
      nodefileEditorResult.className = 'command-result ok';
    } catch (error) {
      nodefileEditorResult.textContent = '保存失败: ' + error.message;
      nodefileEditorResult.className = 'command-result err';
    }
  });
  nodefileNew.addEventListener('click', () => {
    const name = (prompt('新建文件名：') || '').trim();
    if (!name) return;
    doNodeFileOp(() => api.fileTouch(currentDaemonId, GLOBAL_INSTANCE, joinPath(nodeFileTarget, name)), '已新建 ' + name);
  });
  nodefileMkdir.addEventListener('click', () => {
    const name = (prompt('新建目录名：') || '').trim();
    if (!name) return;
    doNodeFileOp(() => api.fileMkdir(currentDaemonId, GLOBAL_INSTANCE, joinPath(nodeFileTarget, name)), '已新建目录 ' + name);
  });
  nodefileRename.addEventListener('click', () => {
    const sel = selectedNodeFiles();
    if (sel.length !== 1) return toast('请选中一个文件/目录', 'err');
    const oldName = sel[0];
    const newName = (prompt('重命名为：', oldName) || '').trim();
    if (!newName || newName === oldName) return;
    doNodeFileOp(() => api.fileMove(currentDaemonId, GLOBAL_INSTANCE, [[joinPath(nodeFileTarget, oldName), joinPath(nodeFileTarget, newName)]]), '已重命名');
  });
  nodefileCopy.addEventListener('click', () => {
    const sel = selectedNodeFiles();
    if (sel.length === 0) return toast('请先勾选文件/目录', 'err');
    nodeFileClipboard = { dir: nodeFileTarget, names: sel };
    toast('已复制 ' + sel.length + ' 项到剪贴板');
  });
  nodefilePaste.addEventListener('click', () => {
    if (!nodeFileClipboard || !nodeFileClipboard.names.length) return toast('剪贴板为空', 'err');
    const targets = nodeFileClipboard.names.map((n) => [joinPath(nodeFileClipboard.dir, n), joinPath(nodeFileTarget, n)]);
    doNodeFileOp(() => api.fileCopy(currentDaemonId, GLOBAL_INSTANCE, targets), '已粘贴 ' + targets.length + ' 项');
  });
  nodefileDelete.addEventListener('click', () => {
    const sel = selectedNodeFiles();
    if (sel.length === 0) return toast('请先勾选文件/目录', 'err');
    if (!confirm('确定删除 ' + sel.length + ' 个文件/目录？此操作不可恢复。')) return;
    const targets = sel.map((n) => joinPath(nodeFileTarget, n));
    doNodeFileOp(() => api.fileDelete(currentDaemonId, GLOBAL_INSTANCE, targets), '已删除 ' + sel.length + ' 项');
  });

  // ---- 背包 ----
  // 英文物品名（驼峰/下划线）→ [中文, emoji]
  const ITEM_MAP = {
    diamond: ['钻石', '💎'], diamond_sword: ['钻石剑', '🗡️'], diamond_pickaxe: ['钻石镐', '⛏️'],
    diamond_axe: ['钻石斧', '🪓'], diamond_shovel: ['钻石锹', '🪏'], diamond_hoe: ['钻石锄', '🌾'],
    diamond_helmet: ['钻石头盔', '🪖'], diamond_chestplate: ['钻石胸甲', '👕'], diamond_leggings: ['钻石护腿', '👖'], diamond_boots: ['钻石靴子', '🥾'],
    iron_ingot: ['铁锭', '🔩'], iron_sword: ['铁剑', '🗡️'], iron_pickaxe: ['铁镐', '⛏️'], iron_axe: ['铁斧', '🪓'],
    gold_ingot: ['金锭', '🟨'], golden_apple: ['金苹果', '🍎'], golden_carrot: ['金胡萝卜', '🥕'],
    emerald: ['绿宝石', '💚'], netherite_ingot: ['下界合金锭', '🖤'], netherite_scrap: ['下界合金碎片', '⬛'],
    coal: ['煤炭', '⚫'], charcoal: ['木炭', '🪵'], raw_iron: ['粗铁', '🪨'], raw_gold: ['粗金', '🪨'], raw_copper: ['粗铜', '🪨'],
    copper_ingot: ['铜锭', '🟧'], lapis_lazuli: ['青金石', '🔵'], redstone: ['红石', '🔴'], quartz: ['下界石英', '⚪'],
    stick: ['木棍', '🥢'], flint: ['燧石', '🪨'], string: ['线', '🧵'], feather: ['羽毛', '🪶'],
    bone: ['骨头', '🦴'], gunpowder: ['火药', '🧨'], leather: ['皮革', '🟫'], paper: ['纸', '📄'], book: ['书', '📕'],
    ender_pearl: ['末影珍珠', '🟢'], blaze_rod: ['烈焰棒', '🔥'], ender_eye: ['末影之眼', '👁️'],
    arrow: ['箭', '🏹'], bow: ['弓', '🏹'], crossbow: ['弩', '🏹'], shield: ['盾牌', '🛡️'], trident: ['三叉戟', '🔱'],
    fishing_rod: ['钓鱼竿', '🎣'], carrot: ['胡萝卜', '🥕'], potato: ['马铃薯', '🥔'], baked_potato: ['烤马铃薯', '🥔'],
    apple: ['苹果', '🍎'], bread: ['面包', '🍞'], cooked_beef: ['牛排', '🥩'], cooked_porkchop: ['熟猪排', '🥩'],
    cooked_chicken: ['熟鸡肉', '🍗'], beef: ['生牛肉', '🥩'], porkchop: ['生猪排', '🥩'], chicken: ['生鸡肉', '🍗'],
    mutton: ['生羊肉', '🍖'], cooked_mutton: ['熟羊肉', '🍖'], rotten_flesh: ['腐肉', '🥩'], spider_eye: ['蜘蛛眼', '👁️'],
    oak_log: ['橡木原木', '🪵'], spruce_log: ['云杉原木', '🪵'], birch_log: ['白桦原木', '🪵'], jungle_log: ['丛林原木', '🪵'],
    oak_planks: ['橡木木板', '🪵'], spruce_planks: ['云杉木板', '🪵'], birch_planks: ['白桦木板', '🪵'],
    cobblestone: ['圆石', '🪨'], stone: ['石头', '🪨'], dirt: ['泥土', '🟫'], grass_block: ['草方块', '🟩'],
    sand: ['沙子', '🟨'], gravel: ['沙砾', '🟫'], obsidian: ['黑曜石', '⬛'], bedrock: ['基岩', '⬛'],
    water_bucket: ['水桶', '🪣'], lava_bucket: ['熔岩桶', '🪣'], bucket: ['桶', '🪣'],
    torch: ['火把', '🔥'], crafting_table: ['工作台', '🛠️'], furnace: ['熔炉', '🔥'], chest: ['箱子', '📦'],
    ender_chest: ['末影箱', '📦'], anvil: ['铁砧', '🔨'], enchanting_table: ['附魔台', '📖'],
    wheat: ['小麦', '🌾'], wheat_seeds: ['小麦种子', '🌱'], sugar_cane: ['甘蔗', '🎋'], bamboo: ['竹子', '🎋'],
    melon_slice: ['西瓜片', '🍉'], pumpkin: ['南瓜', '🎃'], cocoa_beans: ['可可豆', '🫘'],
    slime_ball: ['粘液球', '🟢'], snowball: ['雪球', '⚪'], egg: ['鸡蛋', '🥚'], honey_bottle: ['蜂蜜瓶', '🍯'],
    experience_bottle: ['附魔之瓶', '🧪'], potion: ['药水', '🧪'], splash_potion: ['喷溅药水', '🧪'],
    name_tag: ['命名牌', '🏷️'], saddle: ['鞍', '🐎'], elytra: ['鞘翅', '🪽'], totem_of_undying: ['不死图腾', '🗿'],
    shulker_shell: ['潜影壳', '🟣'], phantom_membrane: ['幻翼膜', '🟦'], heart_of_the_sea: ['海洋之心', '💙'],
    amethyst_shard: ['紫水晶碎片', '🟣'], echo_shard: ['回响碎片', '🟦'], sculk: ['幽匿块', '🟦']
  };

  let invData = {};       // slot -> {name, count}
  let invSelectedSlot = null;

  function normItemKey(name) {
    return String(name).replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase().replace(/[^a-z0-9_]/g, '');
  }

  function itemDisplay(name) {
    const entry = ITEM_MAP[normItemKey(name)];
    if (entry) return { zh: entry[0], emoji: entry[1] };
    if (/[\u4e00-\u9fa5]/.test(name)) return { zh: name, emoji: '📦' };
    return { zh: name, emoji: '📦' };
  }

  function makeInvSlot(slotId) {
    const el = document.createElement('div');
    el.className = 'inv-slot';
    el.dataset.slot = slotId;
    const item = invData[slotId];
    if (item) {
      const d = itemDisplay(item.name);
      el.innerHTML = `<span class="inv-name">${escapeHtml(d.zh)}</span><span class="inv-count">${item.count > 1 ? 'x' + item.count : ''}</span>`;
      el.title = d.zh + ' x' + item.count;
    }
    el.addEventListener('click', () => selectInvSlot(slotId, el));
    return el;
  }

  function renderInvGrid(slots) {
    invData = slots || {};
    invMainGrid.innerHTML = '';
    invHotbar.innerHTML = '';
    invArmor.innerHTML = '';
    invOffhand.innerHTML = '';
    for (let s = 9; s <= 35; s++) invMainGrid.appendChild(makeInvSlot(s));
    for (let s = 0; s <= 8; s++) invHotbar.appendChild(makeInvSlot(s));
    for (let s = 36; s <= 39; s++) invArmor.appendChild(makeInvSlot(s));
    invOffhand.appendChild(makeInvSlot(40));
  }

  function selectInvSlot(slotId, el) {
    invSelectedSlot = slotId;
    document.querySelectorAll('.inv-slot.sel').forEach((e) => e.classList.remove('sel'));
    el.classList.add('sel');
    const item = invData[slotId];
    if (item) {
      const d = itemDisplay(item.name);
      invDetailText.textContent = `#${slotId} · ${d.zh} x${item.count}`;
      invDetail.classList.remove('hidden');
    } else {
      invDetail.classList.add('hidden');
    }
  }

  async function refreshInventory() {
    if (!currentInstance) return;
    invStatus.textContent = '读取中…';
    invStatus.className = 'command-result';
    invDetail.classList.add('hidden');
    invSelectedSlot = null;
    try {
      const r = await api.inventory(currentInstance.daemonId, currentInstance.uuid);
      if (!r.ok) {
        invStatus.textContent = r.error || '读取失败';
        invStatus.className = 'command-result err';
        renderInvGrid({});
        return;
      }
      const slots = (r.data && r.data.slots) || [];
      if (slots.length === 0) {
        invStatus.textContent = '未获取到背包（需启用 InventoryHandling 且已连接服务器）';
        invStatus.className = 'command-result err';
        renderInvGrid({});
        return;
      }
      invStatus.textContent = '已刷新 · ' + slots.length + ' 个物品';
      invStatus.className = 'command-result ok';
      renderInvGrid(Object.fromEntries(slots.map((s) => [s.slot, s])));
    } catch (error) {
      invStatus.textContent = '读取失败: ' + error.message;
      invStatus.className = 'command-result err';
    }
  }

  invRefresh.addEventListener('click', refreshInventory);

  invEnable.addEventListener('click', async () => {
    if (!currentInstance) return toast('请先选择一个实例', 'err');
    invStatus.textContent = '启用中…';
    invStatus.className = 'command-result';
    try {
      const r = await api.fileRead(currentInstance.daemonId, currentInstance.uuid, 'MinecraftClient.ini');
      let ini = typeof r.data === 'string' ? r.data : '';
      if (!/InventoryHandling\s*=/.test(ini)) {
        invStatus.textContent = '未找到 InventoryHandling 配置项';
        invStatus.className = 'command-result err';
        return;
      }
      ini = ini.replace(/InventoryHandling\s*=\s*\w+/, 'InventoryHandling = true');
      await api.fileWrite(currentInstance.daemonId, currentInstance.uuid, 'MinecraftClient.ini', ini);
      invStatus.textContent = '已开启，请重启实例后生效';
      invStatus.className = 'command-result ok';
    } catch (error) {
      invStatus.textContent = '启用失败: ' + error.message;
      invStatus.className = 'command-result err';
    }
  });

  invDisable.addEventListener('click', async () => {
    if (!currentInstance) return toast('请先选择一个实例', 'err');
    invStatus.textContent = '关闭中…';
    invStatus.className = 'command-result';
    try {
      const r = await api.fileRead(currentInstance.daemonId, currentInstance.uuid, 'MinecraftClient.ini');
      let ini = typeof r.data === 'string' ? r.data : '';
      if (!/InventoryHandling\s*=/.test(ini)) {
        invStatus.textContent = '未找到 InventoryHandling 配置项';
        invStatus.className = 'command-result err';
        return;
      }
      ini = ini.replace(/InventoryHandling\s*=\s*\w+/, 'InventoryHandling = false');
      await api.fileWrite(currentInstance.daemonId, currentInstance.uuid, 'MinecraftClient.ini', ini);
      invStatus.textContent = '已关闭，请重启实例后生效';
      invStatus.className = 'command-result ok';
    } catch (error) {
      invStatus.textContent = '关闭失败: ' + error.message;
      invStatus.className = 'command-result err';
    }
  });

  invDropOne.addEventListener('click', () => {
    if (invSelectedSlot === null) return toast('请先点击一个背包格子', 'err');
    sendCommand('/inventory player drop ' + invSelectedSlot);
  });
  invDropAll.addEventListener('click', () => {
    if (invSelectedSlot === null) return toast('请先点击一个背包格子', 'err');
    sendCommand('/inventory player drop ' + invSelectedSlot + ' all');
  });

  invTimestamp.addEventListener('click', async () => {
    if (!currentInstance) return toast('请先选择一个实例', 'err');
    invStatus.textContent = '开启时间戳中…';
    invStatus.className = 'command-result';
    try {
      const r = await api.fileRead(currentInstance.daemonId, currentInstance.uuid, 'MinecraftClient.ini');
      let ini = typeof r.data === 'string' ? r.data : '';
      if (!/Timestamps\s*=/.test(ini)) {
        invStatus.textContent = '未找到 Timestamps 配置项';
        invStatus.className = 'command-result err';
        return;
      }
      ini = ini.replace(/Timestamps\s*=\s*\w+/, 'Timestamps = true');
      await api.fileWrite(currentInstance.daemonId, currentInstance.uuid, 'MinecraftClient.ini', ini);
      invStatus.textContent = '已开启消息时间戳，请重启实例后生效';
      invStatus.className = 'command-result ok';
    } catch (error) {
      invStatus.textContent = '开启失败: ' + error.message;
      invStatus.className = 'command-result err';
    }
  });

  // ---- MCC 脚本 ----
  let scriptEditing = null; // 当前编辑的脚本文件名

  async function loadScripts() {
    if (!currentInstance) return;
    scriptList.innerHTML = '<div class="panel-hint">加载中…</div>';
    scriptEditorWrap.classList.add('hidden');
    scriptEditing = null;
    try {
      const r = await api.fileList(currentInstance.daemonId, currentInstance.uuid, '/');
      const items = ((r && r.data && r.data.items) || []).filter((i) => Number(i.type) === 1 && /\.(txt|mcc|script)$/i.test(i.name));
      scriptList.innerHTML = '';
      if (items.length === 0) {
        scriptList.innerHTML = '<div class="panel-hint">暂无脚本（新建后保存为 .txt 即可）</div>';
        return;
      }
      items.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'file-row script-row';
        row.innerHTML = `
          <span class="file-icon">📜</span>
          <span class="file-name">${escapeHtml(item.name)}</span>
          <span class="file-size">${formatBytes(item.size)}</span>
          <button class="btn btn-sm script-edit" title="快捷编辑">编辑</button>
          <button class="btn btn-sm script-run" title="运行脚本">运行</button>
          <button class="btn btn-sm btn-danger script-del" title="删除脚本">删除</button>
        `;
        row.querySelector('.script-edit').addEventListener('click', (e) => { e.stopPropagation(); toggleInlineScriptEditor(row, item.name); });
        row.querySelector('.script-run').addEventListener('click', (e) => { e.stopPropagation(); sendCommand('/script ' + item.name.replace(/\.txt$/i, '')); });
        row.querySelector('.script-del').addEventListener('click', (e) => {
          e.stopPropagation();
          if (!confirm('确定删除脚本 ' + item.name + '？')) return;
          api.fileDelete(currentInstance.daemonId, currentInstance.uuid, [item.name])
            .then(() => { toast('已删除'); loadScripts(); })
            .catch((er) => toast('删除失败: ' + er.message, 'err'));
        });
        row.addEventListener('click', () => openScriptEditor(item.name));
        scriptList.appendChild(row);
      });
    } catch (error) {
      scriptList.innerHTML = '<div class="panel-hint">加载失败: ' + escapeHtml(error.message) + '</div>';
    }
  }

  // 行内快捷编辑脚本内容
  function toggleInlineScriptEditor(row, name) {
    const existing = scriptList.querySelector('.script-inline');
    if (existing && existing._row === row) { existing.remove(); return; }
    if (existing) existing.remove();
    if (!currentInstance) return;
    const wrap = document.createElement('div');
    wrap.className = 'script-inline';
    wrap._row = row;
    wrap.innerHTML = `
      <textarea class="config-editor script-inline-editor" spellcheck="false" placeholder="加载中…"></textarea>
      <div class="config-toolbar">
        <button class="btn btn-sm btn-primary script-inline-save">保存</button>
        <button class="btn btn-sm btn-ghost script-inline-cancel">取消</button>
        <span class="command-result"></span>
      </div>
    `;
    wrap.querySelector('.script-inline-save').addEventListener('click', async () => {
      try {
        await api.fileWrite(currentInstance.daemonId, currentInstance.uuid, name, wrap.querySelector('.script-inline-editor').value);
        toast('已保存 ' + name);
        wrap.remove();
        loadScripts();
      } catch (er) { toast('保存失败: ' + er.message, 'err'); }
    });
    wrap.querySelector('.script-inline-cancel').addEventListener('click', () => wrap.remove());
    row.after(wrap);
    api.fileRead(currentInstance.daemonId, currentInstance.uuid, name).then((r) => {
      wrap.querySelector('.script-inline-editor').value = typeof r.data === 'string' ? r.data : '';
      wrap.querySelector('.script-inline-editor').focus();
    }).catch((er) => {
      wrap.querySelector('.script-inline-editor').placeholder = '读取失败: ' + er.message;
    });
  }

  async function openScriptEditor(name) {
    if (!currentInstance) return;
    scriptEditorResult.textContent = '读取中…';
    scriptEditorResult.className = 'command-result';
    try {
      const r = await api.fileRead(currentInstance.daemonId, currentInstance.uuid, name);
      const text = typeof r.data === 'string' ? r.data : '';
      scriptEditing = name;
      scriptEditorName.textContent = name;
      scriptEditor.value = text;
      scriptEditorWrap.classList.remove('hidden');
      scriptEditorResult.textContent = '';
    } catch (error) {
      scriptEditorResult.textContent = '读取失败: ' + error.message;
      scriptEditorResult.className = 'command-result err';
    }
  }

  scriptNew.addEventListener('click', () => {
    const name = (prompt('脚本文件名（.txt）：') || '').trim();
    if (!name) return;
    const fn = /\.txt$/i.test(name) ? name : name + '.txt';
    api.fileTouch(currentInstance.daemonId, currentInstance.uuid, fn).then(() => {
      toast('已创建 ' + fn);
      loadScripts();
      openScriptEditor(fn);
    }).catch((e) => toast('创建失败: ' + e.message, 'err'));
  });

  scriptRefresh.addEventListener('click', loadScripts);

  scriptClose.addEventListener('click', () => {
    scriptEditing = null;
    scriptEditorWrap.classList.add('hidden');
    scriptEditor.value = '';
  });

  scriptSave.addEventListener('click', async () => {
    if (!currentInstance || !scriptEditing) return;
    try {
      await api.fileWrite(currentInstance.daemonId, currentInstance.uuid, scriptEditing, scriptEditor.value);
      scriptEditorResult.textContent = '已保存';
      scriptEditorResult.className = 'command-result ok';
    } catch (error) {
      scriptEditorResult.textContent = '保存失败: ' + error.message;
      scriptEditorResult.className = 'command-result err';
    }
  });

  scriptRun.addEventListener('click', () => {
    if (!currentInstance || !scriptEditing) return toast('请先打开一个脚本', 'err');
    sendCommand('/script ' + scriptEditing.replace(/\.txt$/i, ''));
  });

  // ---- 操作日志 ----
  async function loadOperationLogs() {
    try {
      const r = await api.operationLogs();
      const logs = (r && r.data) || [];
      oplogList.innerHTML = '';
      if (logs.length === 0) {
        oplogList.innerHTML = '<div class="panel-hint">暂无操作记录</div>';
        return;
      }
      logs.forEach((l) => {
        const row = document.createElement('div');
        row.className = 'oplog-row';
        const t = new Date(l.time).toLocaleString('zh-CN', { hour12: false });
        row.innerHTML = `
          <span class="oplog-time">${escapeHtml(t)}</span>
          <span class="oplog-user">${escapeHtml(l.user || '-')}</span>
          <span class="oplog-action">${escapeHtml(l.action)}</span>
          <span class="oplog-detail">${escapeHtml(l.detail || '')}</span>
        `;
        oplogList.appendChild(row);
      });
    } catch (error) {
      oplogList.innerHTML = '<div class="panel-hint">加载失败: ' + escapeHtml(error.message) + '</div>';
    }
  }
  oplogRefresh.addEventListener('click', loadOperationLogs);
  oplogBtn.addEventListener('click', () => {
    openModal(oplogOverlay);
    loadOperationLogs();
  });
  oplogClose.addEventListener('click', () => closeModal(oplogOverlay));
  oplogOverlay.addEventListener('click', (e) => { if (e.target === oplogOverlay) closeModal(oplogOverlay); });

  // ---- 内置 MCC 模板管理 ----
  async function loadTemplateList() {
    try {
      const r = await api.templateList();
      const items = (r && r.data) || [];
      templateList.innerHTML = '';
      if (items.length === 0) {
        templateList.innerHTML = '<div class="panel-hint">模板为空。点「从实例初始化」拉取现有 MCC 文件，或「上传文件」添加。</div>';
        return;
      }
      items.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'file-row';
        row.innerHTML = `
          <span class="file-icon">${item.type === 0 ? '📁' : '📄'}</span>
          <span class="file-name">${escapeHtml(item.name)}</span>
          <span class="file-size">${item.type === 0 ? '' : formatBytes(item.size)}</span>
          <button class="btn btn-sm btn-danger tpl-del">删除</button>
        `;
        row.querySelector('.tpl-del').addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!confirm('确定从模板中删除 ' + item.name + '？')) return;
          try {
            await api.templateDelete(item.name);
            toast('已删除');
            loadTemplateList();
          } catch (er) { toast('删除失败: ' + er.message, 'err'); }
        });
        templateList.appendChild(row);
      });
    } catch (error) {
      templateList.innerHTML = '<div class="panel-hint">加载失败: ' + escapeHtml(error.message) + '</div>';
    }
  }

  templateBtn.addEventListener('click', () => {
    openModal(templateOverlay);
    loadTemplateList();
  });
  templateClose.addEventListener('click', () => closeModal(templateOverlay));
  templateOverlay.addEventListener('click', (e) => { if (e.target === templateOverlay) closeModal(templateOverlay); });

  templateInit.addEventListener('click', async () => {
    const src = (prompt('从哪个容器路径初始化模板？\n（默认 /mcc/tslYAYArq001，即从现有 MCC 实例拉取）', '/mcc/tslYAYArq001') || '').trim();
    if (!src) return;
    templateInit.textContent = '拉取中…';
    try {
      const r = await api.templateInit(src, '');
      if (r.ok) {
        toast('模板已初始化（' + (r.data || []).length + ' 项）');
        loadTemplateList();
      } else {
        toast('初始化失败: ' + (r.error || '未知错误'), 'err');
      }
    } catch (er) {
      toast('初始化失败: ' + er.message, 'err');
    } finally {
      templateInit.textContent = '从实例初始化';
    }
  });

  templateUploadBtn.addEventListener('click', () => templateFileInput.click());
  templateFileInput.addEventListener('change', async () => {
    const file = templateFileInput.files && templateFileInput.files[0];
    templateFileInput.value = '';
    if (!file) return;
    toast('上传中 ' + file.name + '…');
    try {
      const r = await api.templateUpload(file.name, file);
      toast('已上传 ' + (r && r.data && r.data.name) + '（' + formatBytes((r && r.data && r.data.size) || file.size) + '）');
      loadTemplateList();
    } catch (er) {
      toast('上传失败: ' + er.message, 'err');
    }
  });

  // ---- 节点性能（CPU/内存）----
  let perfTimer = null;
  async function refreshPerf() {
    try {
      const r = await api.daemonSystem();
      const list = (r && r.data) || [];
      // 按 uuid 精确匹配当前选中节点
      const cur = list.find((d) => d.uuid === currentDaemonId) || null;
      if (cur && cur.system) {
        const cpu = Number(cur.system.cpuUsage || 0);
        const cpuPct = cpu <= 1 ? (cpu * 100).toFixed(1) : cpu.toFixed(1);
        const memPct = (Number(cur.system.memUsage || 0) * 100).toFixed(1);
        perfStatus.innerHTML = `CPU <b>${cpuPct}%</b> · 内存 <b>${memPct}%</b>`;
      }
    } catch (e) { /* 忽略 */ }
  }
  function startPerfPolling() {
    if (perfTimer) clearInterval(perfTimer);
    refreshPerf();
    perfTimer = setInterval(refreshPerf, 10000);
  }

  // ---- 创建实例 ----
  createInstanceBtn.addEventListener('click', () => {
    createResult.textContent = '';
    createOverlay.classList.remove('hidden');
    createOverlay.classList.remove('closing');
    createName.focus();
  });

  createCancel.addEventListener('click', () => {
    closeModal(createOverlay);
  });

  createOverlay.addEventListener('click', (e) => {
    if (e.target === createOverlay) closeModal(createOverlay);
  });

  createForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = createName.value.trim();
    const serverIp = createIp.value.trim();
    const port = createPort.value.trim();
    const accountType = createAcctype.value;
    const login = createLogin.value.trim();

    if (!name || !serverIp || !login) {
      createResult.textContent = '请填写名称、服务器和登录名';
      createResult.className = 'command-result err';
      return;
    }
    if (!currentDaemonId) {
      createResult.textContent = '请先在顶部选择一个节点';
      createResult.className = 'command-result err';
      return;
    }

    createResult.textContent = '创建中…（复用现有 MCC 文件 + 生成配置）';
    createResult.className = 'command-result';
    try {
      const r = await api.createInstance({
        daemonId: currentDaemonId,
        name,
        serverIp,
        serverPort: port,
        accountType,
        accountLogin: login,
        autoAcceptTpa: createTpa.checked
      });
      if (r.ok) {
        createResult.textContent = `已创建 ${r.data.nickname}（未启动）`;
        createResult.className = 'command-result ok';
        closeModal(createOverlay);
        createForm.reset();
        createTpa.checked = true;
        await loadInstances();
        toast('实例已创建');
      } else {
        createResult.textContent = '创建失败: ' + (r.error || '未知错误');
        createResult.className = 'command-result err';
      }
    } catch (error) {
      createResult.textContent = '创建失败: ' + error.message;
      createResult.className = 'command-result err';
    }
  });

  // ---- 樱花与点击特效 ----
  (function sakuraFx() {
    const petals = ['🌸', '✿', '❀', '💮'];
    function spawnSakura() {
      const el = document.createElement('span');
      el.className = 'sakura';
      el.textContent = petals[Math.floor(Math.random() * petals.length)];
      el.style.left = Math.random() * 100 + 'vw';
      el.style.fontSize = (10 + Math.random() * 14) + 'px';
      el.style.animationDuration = (6 + Math.random() * 6) + 's';
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 13000);
    }
    setInterval(spawnSakura, 1800);
    for (let i = 0; i < 8; i++) setTimeout(spawnSakura, i * 300);

    // 漂浮光点粒子
    const pcolors = ['rgba(255,126,185,.75)', 'rgba(106,212,255,.75)', 'rgba(255,209,102,.75)', 'rgba(183,155,255,.65)'];
    function spawnParticle() {
      const el = document.createElement('span');
      el.className = 'particle';
      const size = 2 + Math.random() * 4;
      el.style.width = size + 'px';
      el.style.height = size + 'px';
      el.style.left = Math.random() * 100 + 'vw';
      const c = pcolors[Math.floor(Math.random() * pcolors.length)];
      el.style.background = c;
      el.style.boxShadow = '0 0 8px ' + c;
      el.style.setProperty('--drift', (Math.random() * 120 - 60) + 'px');
      el.style.animationDuration = (8 + Math.random() * 10) + 's';
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 19000);
    }
    setInterval(spawnParticle, 700);
    for (let i = 0; i < 10; i++) setTimeout(spawnParticle, i * 300);

    document.addEventListener('click', (e) => {
      // 按钮波纹
      const btn = e.target.closest('.btn');
      if (btn && btn.classList.contains('btn')) {
        const ripple = document.createElement('span');
        ripple.className = 'btn-ripple';
        const rect = btn.getBoundingClientRect();
        ripple.style.left = (e.clientX - rect.left) + 'px';
        ripple.style.top = (e.clientY - rect.top) + 'px';
        btn.appendChild(ripple);
        setTimeout(() => ripple.remove(), 600);
      }
      const el = document.createElement('span');
      el.className = 'click-burst';
      el.textContent = petals[Math.floor(Math.random() * petals.length)];
      el.style.left = e.clientX + 'px';
      el.style.top = e.clientY + 'px';
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 700);
    });
  })();

  // ---- 3D 倾斜卡片 ----
  instanceGrid.addEventListener('mousemove', (e) => {
    const card = e.target.closest('.instance-card');
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    card.style.transform = `rotateY(${(x * 10).toFixed(2)}deg) rotateX(${(-y * 10).toFixed(2)}deg) translateY(-4px)`;
  });
  instanceGrid.addEventListener('mouseleave', (e) => {
    const card = e.target.closest('.instance-card');
    if (card) card.style.transform = '';
  });

  // ---- 启动 ----
  init();
})();
