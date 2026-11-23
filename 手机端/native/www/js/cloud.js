/* 优日 · 坚果云 WebDAV 备份与恢复 */

/* ---------------------------- 坚果云 WebDAV 同步 ---------------------------- */

const CLOUD_KEY = 'youri.cloud.v1';
const DAV_BASE = String(window.__YOURI_DAV_BASE__ || 'https://dav.jianguoyun.com/dav').replace(/\/+$/, '');
const DAV_DEFAULT_PATH = '/youri-backup.json';

function defaultCloudConfig() {
  return { email: '', password: '', path: DAV_DEFAULT_PATH, auto: false, lastSync: 0, lastCount: 0, lastError: '' };
}

function normalizeDavPath(value) {
  let p = String(value || '').trim() || DAV_DEFAULT_PATH;
  if (!p.startsWith('/')) p = `/${p}`;
  p = p.replace(/\/{2,}/g, '/');
  if (p.endsWith('/')) p += 'youri-backup.json';
  if (!/\.json$/i.test(p)) p += '.json';
  return p;
}

function loadCloudConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(CLOUD_KEY) || 'null');
    if (saved && saved.email && saved.password) {
      return {
        email: String(saved.email),
        password: String(saved.password),
        path: normalizeDavPath(saved.path),
        auto: !!saved.auto,
        lastSync: Number(saved.lastSync) || 0,
        lastCount: Number(saved.lastCount) || 0,
        lastError: ''
      };
    }
  } catch (err) {
    /* 本地配置损坏时当作未连接 */
  }
  return defaultCloudConfig();
}

let cloud = loadCloudConfig();
let cloudBusy = false;
let cloudPending = false;
let cloudAutoTimer = 0;
let syncDraft = null;
let skipNextAuto = false;

function saveCloudConfig() {
  if (DEMO) return;
  try {
    localStorage.setItem(CLOUD_KEY, JSON.stringify({
      email: cloud.email,
      password: cloud.password,
      path: cloud.path,
      auto: cloud.auto,
      lastSync: cloud.lastSync,
      lastCount: cloud.lastCount
    }));
  } catch (err) {
    /* 忽略存储失败 */
  }
}

function syncState() {
  if (cloudBusy) return 'busy';
  if (cloud.lastError) return 'error';
  if (!cloud.email) return 'off';
  if (cloudPending) return 'dirty';
  return 'on';
}

function isSyncOpen() {
  const el = $('#syncLayer');
  return !!el && !el.hidden && el.classList.contains('open');
}

function basicAuth(user, pass) {
  const bytes = new TextEncoder().encode(`${user}:${pass}`);
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return `Basic ${btoa(binary)}`;
}

function davErrorText(status) {
  if (status === 401) return '账号或应用密码不正确';
  if (status === 403) return '没有访问权限，或坚果云流量 / 空间不足';
  if (status === 404) return '云端文件不存在';
  if (status === 405) return '坚果云不支持这个操作';
  if (status === 409) return '备份文件所在的文件夹不存在';
  if (status === 507) return '坚果云空间不足';
  if (status >= 500) return '坚果云服务暂时不可用';
  return `请求失败（HTTP ${status}）`;
}

async function davRequest(draft, { method, path = '/', body = null, headers = {} }) {
  const encodedPath = path.split('/').map((part) => encodeURIComponent(part)).join('/');
  const url = `${DAV_BASE}${encodedPath}`;
  const allHeaders = { Authorization: basicAuth(draft.email, draft.password), ...headers };
  const nativeHttp = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp;
  try {
    if (nativeHttp) {
      const res = await nativeHttp.request({
        url,
        method,
        headers: allHeaders,
        data: body,
        responseType: 'text',
        connectTimeout: 15000,
        readTimeout: 25000
      });
      const text = typeof res.data === 'string' ? res.data : res.data == null ? '' : JSON.stringify(res.data);
      return { status: res.status, text };
    }
    const res = await fetch(url, { method, headers: allHeaders, body });
    return { status: res.status, text: await res.text() };
  } catch (err) {
    throw new Error(nativeHttp
      ? '网络连接失败，请检查网络后重试'
      : '浏览器预览无法直连坚果云（跨域限制），请在手机 App 中使用');
  }
}

async function testDavConnection(draft) {
  // 用 GET 探测：文件存在返回 200，尚未备份返回 404，都能证明账号可用。
  // 不使用 PROPFIND，因为 Android 的 HttpURLConnection 不支持自定义方法。
  const file = await davRequest(draft, { method: 'GET', path: draft.path });
  if (file.status === 200 || file.status === 204 || file.status === 404) return;
  throw new Error(davErrorText(file.status));
}

function makeCloudSnapshot() {
  return {
    app: 'youri',
    version: 2,
    savedAt: new Date().toISOString(),
    events: state.events,
    cats: state.cats,
    birthdays: state.birthdays,
    todos: state.todos
  };
}

function parseCloudSnapshot(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error('云端文件不是有效的 JSON');
  }
  if (!data || data.app !== 'youri' || !Array.isArray(data.events) || !Array.isArray(data.cats)) {
    throw new Error('云端文件不是「优日」的备份');
  }
  return {
    events: sanitizeEvents(data.events),
    cats: sanitizeCats(data.cats),
    birthdays: sanitizeBirthdays(data.birthdays),
    todos: sanitizeTodos(data.todos),
    savedAt: data.savedAt
  };
}

function formatSyncTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const hh = pad2(d.getHours());
  const mm = pad2(d.getMinutes());
  if (d.toDateString() === now.toDateString()) return `今天 ${hh}:${mm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`;
}

function setCloudMsg(text, tone = 'info') {
  const el = $('#cloudMsg');
  if (!text) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.hidden = false;
  el.textContent = text;
  el.dataset.tone = tone;
}

function renderCloudStatus() {
  const status = $('#cloudStatus');
  if (!status) return;
  status.dataset.state = syncState();
  const title = $('#cloudStatusTitle');
  const sub = $('#cloudStatusSub');
  if (cloudBusy) {
    title.textContent = '正在同步…';
    sub.textContent = '请稍候，不要关闭页面';
  } else if (cloud.lastError) {
    title.textContent = '同步遇到问题';
    sub.textContent = cloud.lastError;
  } else if (cloud.email) {
    title.textContent = '已连接坚果云';
    const last = cloud.lastSync ? `最近备份 ${formatSyncTime(cloud.lastSync)}` : '还没有备份';
    sub.textContent = `${cloud.email} · ${last}`;
  } else {
    title.textContent = '未连接';
    sub.textContent = '填写坚果云账号与应用密码';
  }
  const connected = !!cloud.email;
  $('#davConnectBtn').disabled = cloudBusy;
  $('#davUploadBtn').disabled = cloudBusy || !connected;
  $('#davRestoreBtn').disabled = cloudBusy || !connected;
  $('#davDisconnectBtn').hidden = !connected;
  $('#davDisconnectBtn').disabled = cloudBusy;
}

function renderSyncSheet(fillInputs) {
  if (!syncDraft) syncDraft = { ...cloud };
  if (fillInputs) {
    $('#davUser').value = syncDraft.email;
    $('#davPass').value = syncDraft.password;
    $('#davPath').value = syncDraft.path;
    $('#davPass').type = 'password';
    $('#passToggle').textContent = '显示';
  }
  const auto = syncDraft ? syncDraft.auto : cloud.auto;
  $('#autoRow').setAttribute('aria-checked', String(auto));
  $('#autoRow').querySelector('.switch').dataset.on = String(auto);
  renderCloudStatus();
}

function openSyncSheet() {
  syncDraft = { ...cloud };
  setCloudMsg('');
  renderSyncSheet(true);
  openLayer($('#syncLayer'));
}

function closeSyncSheet() {
  closeLayer($('#syncLayer'));
  syncDraft = null;
  blurActive();
}

function readSyncDraft() {
  if (!syncDraft) syncDraft = { ...cloud };
  syncDraft.email = $('#davUser').value.trim();
  syncDraft.password = $('#davPass').value;
  syncDraft.path = normalizeDavPath($('#davPath').value);
  return syncDraft;
}

function validateSyncDraft(draft) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email)) return '请填写正确的坚果云账号（邮箱）';
  if (!draft.password) return '请填写坚果云应用密码';
  return '';
}

async function connectCloud() {
  if (cloudBusy) return;
  const draft = readSyncDraft();
  const problem = validateSyncDraft(draft);
  if (problem) {
    setCloudMsg(problem, 'error');
    return;
  }
  cloudBusy = true;
  cloud.lastError = '';
  cloudPending = false;
  setCloudMsg('正在测试连接…', 'info');
  renderSyncSheet(false);
  renderTopbar();
  try {
    await testDavConnection(draft);
    cloud = { ...draft, lastSync: cloud.lastSync, lastCount: cloud.lastCount, lastError: '' };
    saveCloudConfig();
    $('#davPath').value = cloud.path;
    setCloudMsg('连接成功，可以点「立即上传」开始备份', 'success');
  } catch (err) {
    cloud.lastError = err.message || '连接失败';
    setCloudMsg(cloud.lastError, 'error');
  } finally {
    cloudBusy = false;
    renderTopbar();
    renderSyncSheet(false);
  }
}

async function uploadCloud(silent = false) {
  if (cloudBusy || !cloud.email) {
    if (!silent) setCloudMsg('请先保存并测试连接', 'error');
    return;
  }
  cloudPending = false;
  cloud.lastError = '';
  cloudBusy = true;
  if (!silent) setCloudMsg('正在上传备份…', 'info');
  renderTopbar();
  if (isSyncOpen()) renderCloudStatus();
  try {
    const res = await davRequest(cloud, {
      method: 'PUT',
      path: cloud.path,
      body: JSON.stringify(makeCloudSnapshot()),
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
    if (![200, 201, 204].includes(res.status)) throw new Error(davErrorText(res.status));
    cloud.lastSync = Date.now();
    cloud.lastCount = state.events.length;
    saveCloudConfig();
    if (silent) {
      if (isSyncOpen()) renderCloudStatus();
    } else {
      setCloudMsg(`已备份 ${state.events.length} 个日子、${state.birthdays.length} 个生日、${state.todos.length} 条待办`, 'success');
    }
  } catch (err) {
    cloud.lastError = err.message || '上传失败';
    if (silent) toast(`自动备份失败：${cloud.lastError}`);
    else setCloudMsg(cloud.lastError, 'error');
  } finally {
    cloudBusy = false;
    renderTopbar();
    if (isSyncOpen()) renderSyncSheet(false);
  }
}

function queueAutoBackup() {
  if (DEMO) return;
  if (skipNextAuto) {
    skipNextAuto = false;
    return;
  }
  if (!cloud.auto || !cloud.email) return;
  cloudPending = true;
  renderTopbar();
  if (isSyncOpen()) renderCloudStatus();
  window.clearTimeout(cloudAutoTimer);
  cloudAutoTimer = window.setTimeout(() => {
    if (!cloud.auto || !cloud.email) {
      cloudPending = false;
      renderTopbar();
      return;
    }
    if (cloudBusy) {
      cloudAutoTimer = window.setTimeout(() => uploadCloud(true), 1600);
      return;
    }
    uploadCloud(true);
  }, 2200);
}

async function restoreCloud() {
  if (cloudBusy || !cloud.email) return;
  cloudBusy = true;
  cloud.lastError = '';
  setCloudMsg('正在读取云端备份…', 'info');
  renderCloudStatus();
  renderTopbar();
  let snap;
  try {
    const res = await davRequest(cloud, { method: 'GET', path: cloud.path });
    if (res.status === 404) {
      cloudBusy = false;
      setCloudMsg('云端还没有备份文件，请先上传一次', 'error');
      renderTopbar();
      renderCloudStatus();
      return;
    }
    if (res.status !== 200) throw new Error(davErrorText(res.status));
    snap = parseCloudSnapshot(res.text);
  } catch (err) {
    cloud.lastError = err.message || '读取失败';
    cloudBusy = false;
    setCloudMsg(cloud.lastError, 'error');
    renderTopbar();
    renderCloudStatus();
    return;
  }
  cloudBusy = false;
  renderTopbar();
  renderCloudStatus();

  const when = snap.savedAt ? formatSyncTime(Date.parse(snap.savedAt)) : '';
  const ok = await askConfirm({
    title: '从云端恢复？',
    text: `云端备份有 ${snap.events.length} 个日子、${snap.birthdays.length} 个生日、${snap.todos.length} 条待办${when ? `（${when}）` : ''}，恢复后会覆盖本机现在的 ${state.events.length} 个日子、${state.birthdays.length} 个生日、${state.todos.length} 条待办。`,
    okText: '恢复'
  });
  if (!ok) {
    setCloudMsg('已取消恢复', 'info');
    return;
  }
  state.cats = snap.cats;
  state.events = snap.events;
  state.birthdays = snap.birthdays;
  state.todos = snap.todos;
  state.collapsed = {};
  skipNextAuto = true;
  window.clearTimeout(cloudAutoTimer);
  cloudPending = false;
  persist();
  cloud.lastSync = Date.now();
  cloud.lastCount = state.events.length;
  saveCloudConfig();
  renderAll();
  renderCloudStatus();
  setCloudMsg(`已恢复 ${state.events.length} 个日子、${state.birthdays.length} 个生日、${state.todos.length} 条待办`, 'success');
}

async function disconnectCloud() {
  if (cloudBusy) return;
  const ok = await askConfirm({
    title: '断开坚果云？',
    text: '本机数据会保留，只清除同步账号和自动备份设置。',
    okText: '断开'
  });
  if (!ok) return;
  window.clearTimeout(cloudAutoTimer);
  cloud = defaultCloudConfig();
  cloudBusy = false;
  cloudPending = false;
  try {
    localStorage.removeItem(CLOUD_KEY);
  } catch (err) {
    /* 忽略 */
  }
  syncDraft = { ...cloud };
  $('#davUser').value = '';
  $('#davPass').value = '';
  $('#davPath').value = DAV_DEFAULT_PATH;
  setCloudMsg('已断开连接', 'info');
  renderSyncSheet(true);
  renderTopbar();
}

function toggleCloudAuto() {
  if (!syncDraft) syncDraft = { ...cloud };
  syncDraft.auto = !syncDraft.auto;
  if (cloud.email) {
    cloud.auto = syncDraft.auto;
    saveCloudConfig();
    if (cloud.auto) queueAutoBackup();
    else {
      window.clearTimeout(cloudAutoTimer);
      cloudPending = false;
    }
  }
  renderSyncSheet(false);
  renderTopbar();
}

function togglePasswordVisible() {
  const input = $('#davPass');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  $('#passToggle').textContent = show ? '隐藏' : '显示';
}

