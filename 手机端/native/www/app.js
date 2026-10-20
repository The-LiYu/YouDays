'use strict';

/* ------------------------------------------------------------------ *
 *  优日 · 纪念日与倒数日
 *  纯前端单页应用：状态保存在 localStorage，日历只在新建/编辑时出现
 * ------------------------------------------------------------------ */

const STORAGE_KEY = 'youri.state.v1';
const DAY = 86400000;
const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];
const PALETTE = ['#C8553D', '#B8893B', '#6F8B6A', '#4F7396', '#A87B93', '#8A6F4E', '#5B6B7C', '#9B6A4F'];

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const ICONS = {
  chevron: '<svg class="folder-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m6.5 9.5 5.5 5 5.5-5"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5.5v13M5.5 12h13"/></svg>',
  cloud: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18.5h9.3a3.6 3.6 0 0 0 .5-7.2A5 5 0 0 0 7.3 10.2 4.1 4.1 0 0 0 7 18.5Z"/><path d="M12 15.2v-4M10.4 12.8 12 11.2l1.6 1.6"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 19.5h4l10-10a2.1 2.1 0 0 0-3-3l-10 10v3Z"/><path d="m14.5 7.5 2 2"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 7h15"/><path d="M9.5 7V4.8h5V7"/><path d="M6.5 7l.8 12.2h9.4L17.5 7"/><path d="M10.2 10.5v5.4M13.8 10.5v5.4"/></svg>'
};

const esc = (value) =>
  String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

const pad2 = (n) => String(n).padStart(2, '0');
const uid = (prefix = '') => prefix + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);

/* ---------------------------- 日期工具 ---------------------------- */

function ymd(y, m, d) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function parseYmd(str) {
  const [y, m, d] = String(str).split('-').map(Number);
  return { y, m, d };
}

function dayIndex(str) {
  const { y, m, d } = parseYmd(str);
  return Math.round(Date.UTC(y, m - 1, d) / DAY);
}

function todayStr() {
  const now = new Date();
  return ymd(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

function diffFromToday(str) {
  return dayIndex(str) - dayIndex(todayStr());
}

function weekdayOf(str) {
  const { y, m, d } = parseYmd(str);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function safeDate(y, m, d) {
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return ymd(y, m, Math.min(d, daysInMonth));
}

function nextRepeatDate(ev) {
  const orig = parseYmd(ev.date);
  const today = parseYmd(todayStr());
  let y = Math.max(orig.y, today.y);
  let cand = safeDate(y, orig.m, orig.d);
  for (let i = 0; i < 4 && dayIndex(cand) < dayIndex(todayStr()); i += 1) {
    y += 1;
    cand = safeDate(y, orig.m, orig.d);
  }
  return cand;
}

function infoOf(ev) {
  const diff = diffFromToday(ev.date);
  if (ev.repeatYearly) {
    const next = nextRepeatDate(ev);
    const days = diffFromToday(next);
    return { kind: days === 0 ? 'today' : 'count', days: Math.abs(days), next, diff };
  }
  if (diff === 0) return { kind: 'today', days: 0 };
  if (diff > 0) return { kind: 'count', days: diff };
  return { kind: 'past', days: -diff };
}

function sortValue(ev) {
  if (ev.repeatYearly) return diffFromToday(nextRepeatDate(ev));
  const diff = diffFromToday(ev.date);
  return diff >= 0 ? diff : 1e6 - diff;
}

function sortEvents(a, b) {
  return sortValue(a) - sortValue(b) || a.name.localeCompare(b.name, 'zh-Hans-CN');
}

const shortDate = (str) => {
  const { m, d } = parseYmd(str);
  return `${m}月${d}日`;
};

const fullDate = (str) => {
  const { y, m, d } = parseYmd(str);
  return `${y}年${m}月${d}日`;
};

const fullDateWeek = (str) => `${fullDate(str)} · 周${WEEK_CN[weekdayOf(str)]}`;

function longToday() {
  const now = new Date();
  return `${now.getMonth() + 1}月${now.getDate()}日 · 周${WEEK_CN[now.getDay()]}`;
}

const nf = (n) => Number(n).toLocaleString('zh-CN');

/* ---------------------------- 状态 ---------------------------- */

function defaultCats() {
  const lv1 = (name, color) => ({ id: uid('c_'), name, color, parent: null });
  const life = lv1('生活', '#C8553D');
  const family = lv1('家人', '#B8893B');
  const growth = lv1('成长', '#6F8B6A');
  const sub = (name, color, parent) => ({ id: uid('c_'), name, color, parent });
  return [
    life,
    family,
    growth,
    sub('生日', '#C8553D', life.id),
    sub('节日', '#B8893B', life.id),
    sub('旅行', '#4F7396', life.id),
    sub('纪念日', '#A87B93', family.id),
    sub('约定', '#8A6F4E', family.id),
    sub('里程碑', '#6F8B6A', growth.id),
    sub('目标', '#5B6B7C', growth.id)
  ];
}

function normalizeEvent(ev) {
  return {
    id: ev.id || uid('e_'),
    name: String(ev.name || '').slice(0, 24),
    date: ev.date,
    cat1: ev.cat1 || null,
    cat2: ev.cat2 || null,
    repeatYearly: !!ev.repeatYearly,
    note: String(ev.note || '').slice(0, 140),
    createdAt: ev.createdAt || Date.now()
  };
}

function sanitizeCats(list) {
  const cats = (Array.isArray(list) ? list : [])
    .filter((c) => c && c.id && c.name)
    .map((c) => ({
      id: c.id,
      name: String(c.name).slice(0, 8),
      color: /^#[0-9a-fA-F]{6}$/.test(c.color || '') ? c.color : PALETTE[0],
      parent: c.parent || null
    }));
  const roots = new Set(cats.filter((c) => !c.parent).map((c) => c.id));
  return cats.filter((c) => !c.parent || roots.has(c.parent));
}

function sanitizeEvents(list) {
  return (Array.isArray(list) ? list : [])
    .filter((e) => e && e.name && /^\d{4}-\d{2}-\d{2}$/.test(e.date || ''))
    .map(normalizeEvent);
}

function loadState() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  } catch (err) {
    saved = null;
  }
  if (!saved || !Array.isArray(saved.events) || !Array.isArray(saved.cats)) {
    return { v: 1, cats: defaultCats(), events: [], collapsed: {}, updatedAt: 0 };
  }
  return {
    v: 1,
    cats: sanitizeCats(saved.cats),
    events: sanitizeEvents(saved.events),
    collapsed: saved.collapsed && typeof saved.collapsed === 'object' ? saved.collapsed : {},
    updatedAt: Number(saved.updatedAt) || 0
  };
}

const params = new URLSearchParams(location.search);
const DEMO = params.has('demo');

function demoState() {
  const s = { v: 1, cats: defaultCats(), events: [], collapsed: {} };
  const catId = (name) => {
    const hit = s.cats.find((c) => c.name === name);
    return hit ? hit.id : null;
  };
  const offsetDate = (n) => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + n);
    return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());
  };
  const add = (name, offset, c1, c2, repeat = false, note = '') => {
    s.events.push({
      id: uid('e_'),
      name,
      date: offsetDate(offset),
      cat1: catId(c1),
      cat2: c2 ? catId(c2) : null,
      repeatYearly: repeat,
      note,
      createdAt: Date.now()
    });
  };
  add('小满的生日', 12, '生活', '生日', true, '记得提前订花，晚上回家吃饭');
  add('我们的纪念日', 26, '家人', '纪念日', true, '第七年');
  add('去看海', 5, '生活', '旅行', false, '高铁 09:12，带相机');
  add('考研初试', 61, '成长', '目标', false, '');
  add('搬进新家', -40, '生活', '', false, '那天下了小雨');
  add('毕业典礼', -380, '成长', '里程碑', false, '');
  add('第一次看雪山', -800, '生活', '旅行', false, '');
  return s;
}

let state = DEMO ? demoState() : loadState();

function persist(options = {}) {
  if (DEMO) return;
  try {
    state.updatedAt = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    toast('保存失败，存储空间不足');
  }
  if (!options.skipCloud) queueAutoBackup();
}

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
    version: 1,
    savedAt: new Date().toISOString(),
    events: state.events,
    cats: state.cats
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
  return { events: sanitizeEvents(data.events), cats: sanitizeCats(data.cats), savedAt: data.savedAt };
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
      setCloudMsg(`已备份 ${state.events.length} 个日子`, 'success');
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
    text: `云端备份有 ${snap.events.length} 个日子${when ? `（${when}）` : ''}，恢复后会覆盖本机现在的 ${state.events.length} 个日子。`,
    okText: '恢复'
  });
  if (!ok) {
    setCloudMsg('已取消恢复', 'info');
    return;
  }
  state.cats = snap.cats;
  state.events = snap.events;
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
  setCloudMsg(`已恢复 ${state.events.length} 个日子`, 'success');
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

/* ---------------------------- 视图与弹层 ---------------------------- */

let view = 'home';
const layerStack = [];
let currentDetailId = null;
let editor = null;
let catDraft = null;
let confirmResolver = null;
let toastTimer = 0;

function syncLock() {
  document.body.classList.toggle('locked', layerStack.length > 0);
}

function openLayer(el) {
  el.hidden = false;
  void el.offsetWidth;
  el.classList.add('open');
  const i = layerStack.indexOf(el);
  if (i > -1) layerStack.splice(i, 1);
  layerStack.push(el);
  syncLock();
}

function closeLayer(el) {
  el.classList.remove('open');
  const i = layerStack.indexOf(el);
  if (i > -1) layerStack.splice(i, 1);
  syncLock();
  window.setTimeout(() => {
    if (!el.classList.contains('open') && !layerStack.includes(el)) el.hidden = true;
  }, 280);
}

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 1900);
}

function blurActive() {
  if (document.activeElement && typeof document.activeElement.blur === 'function') {
    document.activeElement.blur();
  }
}

function switchView(next) {
  if (next === view) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  view = next;
  $('#viewHome').hidden = next !== 'home';
  $('#viewCats').hidden = next !== 'cats';
  $$('.tab').forEach((btn) => btn.setAttribute('aria-selected', String(btn.dataset.view === next)));
  renderTopbar();
  window.scrollTo(0, 0);
}

/* ---------------------------- 首页渲染 ---------------------------- */

function isCollapsed(key) {
  return !!state.collapsed[key];
}

function catPathOf(ev) {
  const c1 = state.cats.find((c) => c.id === ev.cat1 && !c.parent);
  if (!c1) return { text: '未分类', color: '#B3A897' };
  const c2 = ev.cat2 ? state.cats.find((c) => c.id === ev.cat2 && c.parent === c1.id) : null;
  return { text: c2 ? `${c1.name} / ${c2.name}` : c1.name, color: c2 ? c2.color : c1.color };
}

function buildGroups() {
  const lv1 = state.cats.filter((c) => !c.parent);
  const groups = [];
  lv1.forEach((cat) => {
    const all = state.events.filter((e) => e.cat1 === cat.id);
    if (!all.length) return;
    const own = all.filter((e) => !e.cat2 || !state.cats.some((c) => c.id === e.cat2 && c.parent === cat.id)).sort(sortEvents);
    const subs = state.cats
      .filter((c) => c.parent === cat.id)
      .map((sub) => ({ cat: sub, events: all.filter((e) => e.cat2 === sub.id).sort(sortEvents) }))
      .filter((sub) => sub.events.length);
    groups.push({ cat, key: `g:${cat.id}`, own, subs, events: all });
  });
  const validLv1 = new Set(lv1.map((c) => c.id));
  const uncat = state.events.filter((e) => !validLv1.has(e.cat1)).sort(sortEvents);
  if (uncat.length) groups.push({ cat: null, key: 'g:uncat', own: uncat, subs: [], events: uncat });
  return groups;
}

function heroPick() {
  const items = state.events.map((ev) => ({ ev, info: infoOf(ev) }));
  if (!items.length) return null;
  const todays = items.filter((it) => it.info.kind === 'today');
  if (todays.length) return { ...todays[0], todayCount: todays.length };
  const upcoming = items.filter((it) => it.info.kind === 'count').sort((a, b) => a.info.days - b.info.days);
  if (upcoming.length) return upcoming[0];
  const past = items.filter((it) => it.info.kind === 'past').sort((a, b) => a.info.days - b.info.days);
  return past[0] || null;
}

function heroHTML() {
  const pick = heroPick();
  if (!pick) return '';
  const { ev, info } = pick;
  const path = catPathOf(ev);
  const isToday = info.kind === 'today';
  const eyebrow = isToday ? '就是今天' : info.kind === 'count' ? '下一个日子' : '最近的纪念';
  const chip = pick.todayCount > 1 ? `今日 ${pick.todayCount}` : ev.repeatYearly ? '每年' : path.text;
  const numHTML = isToday
    ? '<div class="hero-count is-today"><b>今天</b></div>'
    : `<div class="hero-count"><b>${info.days}</b><span>${info.kind === 'count' ? '天后' : '天前'}</span></div>`;
  const meta = ev.repeatYearly ? `每年 ${shortDate(ev.date)} · ${path.text}` : `${shortDate(ev.date)} · ${path.text}`;
  return `<div class="hero" role="button" tabindex="0" data-act="open-event" data-id="${ev.id}">
    <div class="hero-top">
      <span class="hero-eyebrow">${eyebrow}</span>
      <span class="hero-chip">${esc(chip)}</span>
    </div>
    <div class="hero-body">
      <div class="hero-info">
        <h2 class="hero-name">${esc(ev.name)}</h2>
        <p class="hero-meta">${esc(meta)}</p>
      </div>
      ${numHTML}
    </div>
    <div class="hero-foot">
      <span>${fullDateWeek(ev.date)}${ev.repeatYearly ? ' · 每年重复' : ''}</span>
      <span class="arrow">查看 ›</span>
    </div>
  </div>`;
}

function eventHTML(ev) {
  const info = infoOf(ev);
  const meta = ev.repeatYearly
    ? `${shortDate(ev.date)} · 每年`
    : `${fullDate(ev.date)} · 周${WEEK_CN[weekdayOf(ev.date)]}`;
  let countHTML;
  if (info.kind === 'today') {
    countHTML = '<div class="event-count today"><span class="n">今天</span></div>';
  } else if (info.kind === 'count') {
    countHTML = `<div class="event-count"><span class="n">${info.days}</span><span class="u">天后</span></div>`;
  } else {
    countHTML = `<div class="event-count past"><span class="n">${info.days}</span><span class="u">天前</span></div>`;
  }
  return `<button class="event" data-act="open-event" data-id="${ev.id}">
    <div class="event-main">
      <div class="event-name"><span>${esc(ev.name)}</span>${ev.repeatYearly ? '<span class="tag">每年</span>' : ''}</div>
      <div class="event-meta">${meta}</div>
    </div>
    ${countHTML}
  </button>`;
}

function subfolderHTML(sub) {
  const key = `s:${sub.cat.id}`;
  const open = !isCollapsed(key);
  return `<div class="subfolder" data-open="${open}">
    <button class="sub-head" data-act="toggle-sub" data-key="${key}" aria-expanded="${open}">
      <span class="sub-dash"></span>
      <span class="sub-name">${esc(sub.cat.name)}</span>
      <span class="sub-count">${sub.events.length}</span>
      ${ICONS.chevron}
    </button>
    <div class="folder-body"><div class="folder-inner"><div class="events">${sub.events.map(eventHTML).join('')}</div></div></div>
  </div>`;
}

function groupHTML(group) {
  const open = !isCollapsed(group.key);
  const name = group.cat ? group.cat.name : '未分类';
  const color = group.cat ? group.cat.color : '#B3A897';
  let inner = '';
  if (group.own.length) inner += `<div class="events">${group.own.map(eventHTML).join('')}</div>`;
  inner += group.subs.map(subfolderHTML).join('');
  return `<section class="folder" data-open="${open}" data-key="${group.key}">
    <button class="folder-head" data-act="toggle-folder" data-key="${group.key}" aria-expanded="${open}">
      <span class="folder-swatch" style="--c:${color}"></span>
      <span class="folder-name">${esc(name)}</span>
      <span class="folder-count">${group.events.length} 个</span>
      ${ICONS.chevron}
    </button>
    <div class="folder-body"><div class="folder-inner"><div class="folder-pad">${inner}</div></div></div>
  </section>`;
}

function emptyHomeHTML() {
  return `<div class="empty" style="margin-top:18px">
    <div class="empty-mark">日</div>
    <h3>还没有记录的日子</h3>
    <p>选一个日期，给值得记住的日子起个名字。<br>未来的会倒数，过去的会纪念。</p>
    <button class="primary" data-act="new">添加第一个日子</button>
  </div>`;
}

function homeStats() {
  let up = 0;
  let past = 0;
  let today = 0;
  state.events.forEach((ev) => {
    const info = infoOf(ev);
    if (info.kind === 'count') up += 1;
    else if (info.kind === 'past') past += 1;
    else today += 1;
  });
  return { up, past, today };
}

function renderTopbar() {
  const title = $('#pageTitle');
  const sub = $('#pageSub');
  const actions = $('#topActions');
  const syncButton = `<button class="round-btn sync-btn" data-act="open-sync" data-sync="${syncState()}" aria-label="同步与备份">
    ${ICONS.cloud}
    <i class="sync-dot" aria-hidden="true"></i>
  </button>`;
  if (view === 'home') {
    title.textContent = '优日';
    sub.textContent = longToday();
    if (state.events.length) {
      const stats = homeStats();
      actions.innerHTML = `<div class="stat-pill" aria-label="倒数与纪念数量">
        <span><i class="up"></i><b>${stats.up}</b>倒数</span>
        <span><i class="past"></i><b>${stats.past}</b>纪念</span>
      </div>${syncButton}`;
    } else {
      actions.innerHTML = syncButton;
    }
  } else {
    title.textContent = '分类';
    sub.textContent = '用文件夹整理你的日子';
    actions.innerHTML = `<button class="round-btn" data-act="add-cat1" aria-label="新建一级分类">${ICONS.plus}</button>${syncButton}`;
  }
}

function renderHome() {
  const host = $('#homeContent');
  if (!state.events.length) {
    host.innerHTML = emptyHomeHTML();
    return;
  }
  const groups = buildGroups();
  const anyOpen = groups.some(
    (g) => !isCollapsed(g.key) || g.subs.some((sub) => !isCollapsed(`s:${sub.cat.id}`))
  );
  host.innerHTML = `${heroHTML()}
    <div class="section-head">
      <h2>我的日子<span class="sub">共 ${state.events.length} 个</span></h2>
      <button class="link-btn" data-act="toggle-all">${anyOpen ? '全部收起' : '全部展开'}</button>
    </div>
    ${groups.map(groupHTML).join('')}`;
}

function updateToggleAllLabel() {
  const btn = $('[data-act="toggle-all"]');
  if (!btn) return;
  const groups = buildGroups();
  const anyOpen = groups.some(
    (g) => !isCollapsed(g.key) || g.subs.some((sub) => !isCollapsed(`s:${sub.cat.id}`))
  );
  btn.textContent = anyOpen ? '全部收起' : '全部展开';
}

/* ---------------------------- 分类页 ---------------------------- */

function countEvents(cat) {
  if (cat.parent) return state.events.filter((e) => e.cat2 === cat.id).length;
  return state.events.filter((e) => e.cat1 === cat.id).length;
}

function catRowHTML(cat, isSub) {
  const subs = state.cats.filter((c) => c.parent === cat.id);
  const detail = isSub ? `${countEvents(cat)} 个日子` : `${countEvents(cat)} 个日子 · ${subs.length} 个二级`;
  return `<div class="cat-row ${isSub ? 'sub' : ''}">
    <span class="cat-swatch ${isSub ? 'tiny' : ''}" style="--c:${cat.color}"></span>
    <div class="cat-info">
      <b>${esc(cat.name)}</b>
      <small>${detail}</small>
    </div>
    <button class="mini-btn" data-act="edit-cat" data-id="${cat.id}" aria-label="编辑${esc(cat.name)}">${ICONS.edit}</button>
    <button class="mini-btn del" data-act="delete-cat" data-id="${cat.id}" aria-label="删除${esc(cat.name)}">${ICONS.trash}</button>
  </div>`;
}

function renderCats() {
  const host = $('#catsContent');
  const lv1 = state.cats.filter((c) => !c.parent);
  if (!lv1.length) {
    host.innerHTML = `<p class="cat-intro">两级分类：一级分类是首页的文件夹，二级分类是文件夹里的小分组。</p>
      <div class="empty">
        <div class="empty-mark">目</div>
        <h3>还没有分类</h3>
        <p>建一个文件夹，把日子分门别类收好。</p>
        <button class="primary" data-act="add-cat1">新建一级分类</button>
      </div>`;
    return;
  }
  const cards = lv1
    .map((cat) => {
      const subs = state.cats.filter((c) => c.parent === cat.id);
      const subHTML = subs.map((sub) => catRowHTML(sub, true)).join('');
      return `<div class="cat-card">
        ${catRowHTML(cat, false)}
        <div class="cat-subs">
          ${subHTML}
          <button class="cat-add-sub" data-act="add-cat2" data-parent="${cat.id}">＋ 新建二级分类</button>
        </div>
      </div>`;
    })
    .join('');
  host.innerHTML = `<p class="cat-intro">两级分类：一级分类是首页的文件夹，二级分类是文件夹里的小分组。点文件夹可以展开或收起。</p>
    ${cards}
    <button class="cat-add" data-act="add-cat1">${ICONS.plus} 新建一级分类</button>`;
}

/* ---------------------------- 详情 ---------------------------- */

function detailHTML(ev) {
  const info = infoOf(ev);
  const path = catPathOf(ev);
  const orig = parseYmd(ev.date);
  const diff = diffFromToday(ev.date);
  const isPast = diff < 0;
  let numHTML;
  let label;
  if (info.kind === 'today') {
    label = '就是今天';
    numHTML = '<div class="detail-num word">今天</div>';
  } else if (info.kind === 'count') {
    label = ev.repeatYearly ? '距离下一次' : '距离这一天';
    numHTML = `<div class="detail-num">${info.days}<span>天</span></div>`;
  } else {
    label = '已经过去';
    numHTML = `<div class="detail-num past">${info.days}<span>天</span></div>`;
  }

  const rows = [];
  rows.push(`<div class="d-row"><span>日期</span><b>${fullDateWeek(ev.date)}</b></div>`);
  if (info.kind === 'today') {
    rows.push('<div class="d-row"><span>状态</span><b>今天</b></div>');
  } else if (info.kind === 'count') {
    rows.push(`<div class="d-row"><span>状态</span><b>倒数日 · 还有 ${nf(info.days)} 天</b></div>`);
  } else {
    rows.push(`<div class="d-row"><span>状态</span><b>纪念日 · 已经 ${nf(info.days)} 天</b></div>`);
  }
  rows.push(`<div class="d-row"><span>分类</span><b>${esc(path.text)}</b></div>`);
  if (ev.repeatYearly) {
    const nth = parseYmd(info.next).y - orig.y;
    rows.push(`<div class="d-row"><span>周期</span><b>每年重复${nth > 0 ? ` · 第 ${nth} 个` : ' · 首次'}</b></div>`);
    rows.push(`<div class="d-row"><span>下次</span><b>${fullDateWeek(info.next)}（${info.kind === 'today' ? '今天' : `${info.days} 天后`}）</b></div>`);
    if (isPast) rows.push(`<div class="d-row"><span>已过</span><b>${nf(-diff)} 天</b></div>`);
  }
  if (ev.note) rows.push(`<div class="d-row"><span>备注</span><b>${esc(ev.note)}</b></div>`);

  return `<div class="detail-hero">
      <div class="detail-label">${label}</div>
      ${numHTML}
      <h2 class="detail-name" id="detailName">${esc(ev.name)}</h2>
      <span class="detail-cat" style="--c:${path.color}"><i class="chip-dot"></i>${esc(path.text)}</span>
    </div>
    <div class="detail-rows">${rows.join('')}</div>`;
}

function detailActionsHTML(ev) {
  return `<button class="ghost" data-act="edit-event" data-id="${ev.id}">编辑</button>
    <button class="ghost danger-text" data-act="delete-event" data-id="${ev.id}">删除</button>`;
}

function openDetail(id) {
  const ev = state.events.find((e) => e.id === id);
  if (!ev) return;
  currentDetailId = id;
  $('#detailBody').innerHTML = detailHTML(ev);
  $('#detailFoot').innerHTML = detailActionsHTML(ev);
  openLayer($('#detailLayer'));
}

function closeDetail() {
  closeLayer($('#detailLayer'));
  currentDetailId = null;
  blurActive();
}

/* ---------------------------- 事件编辑器 ---------------------------- */

function openEditor(ev) {
  const target = ev && ev.id ? ev : null;
  const date = target ? target.date : todayStr();
  const d = parseYmd(date);
  editor = {
    id: target ? target.id : null,
    date,
    name: target ? target.name : '',
    cat1: target ? target.cat1 : '',
    cat2: target ? target.cat2 : '',
    repeat: target ? target.repeatYearly : false,
    note: target ? target.note : '',
    calOpen: !target,
    viewY: d.y,
    viewM: d.m
  };
  $('#editorTitle').textContent = target ? '编辑日子' : '新建日子';
  $('#evName').value = editor.name;
  $('#evNote').value = editor.note;
  $('#jumpPanel').hidden = true;
  $('.cal-title').setAttribute('aria-expanded', 'false');
  renderEditor();
  $('#editorScroll').scrollTop = 0;
  openLayer($('#editorLayer'));
}

function closeEditor() {
  closeLayer($('#editorLayer'));
  editor = null;
  blurActive();
}

function renderEditor() {
  if (!editor) return;
  renderCalendar();
  renderPicked();
  renderChips();
  renderRepeat();
  renderCalWrap();
}

function renderCalWrap() {
  const wrap = $('#calWrap');
  wrap.dataset.open = String(!!editor.calOpen);
  wrap.querySelector('.cal').inert = !editor.calOpen;
}

function renderCalendar() {
  if (!editor) return;
  const { viewY, viewM } = editor;
  $('#calTitle').textContent = `${viewY}年${viewM}月`;

  const firstWeekday = new Date(Date.UTC(viewY, viewM - 1, 1)).getUTCDay();
  const lead = (firstWeekday + 6) % 7;
  const today = todayStr();
  let monthMarks = 0;
  const cells = [];
  for (let i = 0; i < 42; i += 1) {
    const dt = new Date(Date.UTC(viewY, viewM - 1, 1 - lead + i));
    const ds = ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
    const out = dt.getUTCMonth() !== viewM - 1;
    const marked = hasEventOn(ds);
    if (!out && marked) monthMarks += 1;
    const classes = ['cal-cell'];
    if (out) classes.push('out');
    if (ds === today) classes.push('today');
    if (ds === editor.date) classes.push('sel');
    cells.push(`<button class="${classes.join(' ')}" data-act="pick-date" data-date="${ds}" aria-label="${fullDateWeek(ds)}${ds === editor.date ? '，已选' : ''}">
      <span class="cal-day">${dt.getUTCDate()}</span>
      ${marked ? '<i class="dot"></i>' : ''}
    </button>`);
  }
  $('#calGrid').innerHTML = cells.join('');
  $('#calEventsHint').textContent = monthMarks ? `本月 ${monthMarks} 个日子` : '本月暂无日子';
}

function hasEventOn(ds) {
  return state.events.some((ev) => {
    if (ev.date === ds) return true;
    if (!ev.repeatYearly) return false;
    if (dayIndex(ds) < dayIndex(ev.date)) return false;
    const orig = parseYmd(ev.date);
    const cur = parseYmd(ds);
    return orig.m === cur.m && orig.d === cur.d;
  });
}

function renderPicked() {
  const ds = editor.date;
  const diff = diffFromToday(ds);
  const isPast = diff < 0;
  let tag;
  if (diff === 0) tag = '今天 · 就是这天';
  else if (diff > 0) tag = `倒数日 · ${diff} 天`;
  else tag = `纪念日 · ${-diff} 天`;
  $('#picked').className = `picked${isPast ? ' past' : ''}`;
  $('#picked').innerHTML = `<span class="picked-date">${fullDate(ds)}<small>周${WEEK_CN[weekdayOf(ds)]}</small></span>
    <span class="picked-tag">${tag}</span>
    <button class="picked-edit" data-act="toggle-cal" aria-label="${editor.calOpen ? '收起日历' : '修改日期'}">${editor.calOpen ? '收起' : '改日期'}</button>`;
}

function chipHTML(cat, active, small) {
  return `<button class="chip${active ? ' on' : ''}" style="--c:${cat.color}" data-act="${small ? 'pick-cat2' : 'pick-cat1'}" data-id="${cat.id}" aria-pressed="${active}">
    <i class="chip-dot"></i>${esc(cat.name)}
  </button>`;
}

function renderChips() {
  const lv1 = state.cats.filter((c) => !c.parent);
  if (editor.cat1 && !lv1.some((c) => c.id === editor.cat1)) {
    editor.cat1 = '';
    editor.cat2 = '';
  }
  $('#chip1').innerHTML = lv1.length
    ? lv1.map((c) => chipHTML(c, editor.cat1 === c.id, false)).join('')
    : '<span class="chips-empty">还没有分类，可在「分类」页添加</span>';

  const subs = lv1.length && editor.cat1 ? state.cats.filter((c) => c.parent === editor.cat1) : [];
  if (editor.cat2 && !subs.some((c) => c.id === editor.cat2)) editor.cat2 = '';
  $('#field2').hidden = !editor.cat1;
  if (editor.cat1) {
    $('#chip2').innerHTML = subs.length
      ? subs.map((c) => chipHTML(c, editor.cat2 === c.id, true)).join('')
      : '<span class="chips-empty">这个分类下还没有二级分类</span>';
  } else {
    $('#chip2').innerHTML = '';
  }
}

function renderRepeat() {
  $('#repeatRow').setAttribute('aria-checked', String(editor.repeat));
  $('#repeatRow').querySelector('.switch').dataset.on = String(editor.repeat);
}

function pickDate(ds) {
  editor.date = ds;
  const d = parseYmd(ds);
  editor.viewY = d.y;
  editor.viewM = d.m;
  editor.calOpen = false;
  $('#jumpPanel').hidden = true;
  $('.cal-title').setAttribute('aria-expanded', 'false');
  renderCalendar();
  renderPicked();
  renderCalWrap();
}

function toggleCal(force) {
  if (!editor) return;
  editor.calOpen = typeof force === 'boolean' ? force : !editor.calOpen;
  if (!editor.calOpen) {
    $('#jumpPanel').hidden = true;
    $('.cal-title').setAttribute('aria-expanded', 'false');
  }
  renderCalWrap();
  renderPicked();
  if (editor.calOpen) $('#editorScroll').scrollTo({ top: 0, behavior: 'smooth' });
}

function toggleJump(force) {
  const panel = $('#jumpPanel');
  const open = typeof force === 'boolean' ? force : panel.hidden;
  panel.hidden = !open;
  $('.cal-title').setAttribute('aria-expanded', String(open));
  if (open) renderJump();
}

function renderJump() {
  $('#jumpYear').textContent = editor.viewY;
  $('#jumpMonths').innerHTML = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    return `<button class="jump-month${m === editor.viewM ? ' on' : ''}" data-act="jump-month" data-month="${m}">${m}月</button>`;
  }).join('');
}

function saveEditor() {
  if (!editor) return;
  const name = $('#evName').value.trim();
  if (!name) {
    toast('请填写事件名称');
    $('#evName').focus();
    return;
  }
  const cat1Exists = state.cats.some((c) => c.id === editor.cat1 && !c.parent);
  const cat2Exists = state.cats.some((c) => c.id === editor.cat2 && c.parent === editor.cat1);
  const payload = {
    id: editor.id || uid('e_'),
    name: name.slice(0, 24),
    date: editor.date,
    cat1: cat1Exists ? editor.cat1 : null,
    cat2: cat2Exists ? editor.cat2 : null,
    repeatYearly: !!editor.repeat,
    note: $('#evNote').value.trim().slice(0, 140),
    createdAt: Date.now()
  };
  const isEdit = !!editor.id;
  const idx = state.events.findIndex((e) => e.id === payload.id);
  if (idx > -1) {
    payload.createdAt = state.events[idx].createdAt;
    state.events[idx] = normalizeEvent(payload);
  } else {
    state.events.push(normalizeEvent(payload));
  }
  persist();
  closeEditor();
  renderAll();
  if (view !== 'home') switchView('home');
  toast(isEdit ? '已保存' : '已添加');
}

/* ---------------------------- 分类编辑 ---------------------------- */

function openCatModal(id, parent) {
  const cat = id ? state.cats.find((c) => c.id === id) : null;
  if (cat) parent = cat.parent;
  const parentCat = parent ? state.cats.find((c) => c.id === parent) : null;
  catDraft = {
    id: cat ? cat.id : null,
    parent: parent || null,
    name: cat ? cat.name : '',
    color: cat ? cat.color : PALETTE[Math.floor(Math.random() * PALETTE.length)]
  };
  $('#catTitle').textContent = cat ? '编辑分类' : parent ? '新建二级分类' : '新建一级分类';
  $('#catName').value = catDraft.name;
  $('#catDeleteBtn').hidden = !cat;
  $('#catNote').textContent = parentCat
    ? `这个二级分类会收在「${parentCat.name}」文件夹里。`
    : '一级分类会作为首页的一个文件夹，可以展开和收起。';
  renderSwatches();
  openLayer($('#catLayer'));
}

function closeCatModal() {
  closeLayer($('#catLayer'));
  catDraft = null;
  blurActive();
}

function renderSwatches() {
  $('#catColors').innerHTML = PALETTE.map(
    (c) => `<button class="swatch${catDraft.color === c ? ' on' : ''}" style="--c:${c}" data-act="pick-color" data-color="${c}" aria-label="颜色 ${c}"></button>`
  ).join('');
}

function saveCategory() {
  if (!catDraft) return;
  const name = $('#catName').value.trim().slice(0, 8);
  if (!name) {
    toast('请填写分类名称');
    $('#catName').focus();
    return;
  }
  const siblings = state.cats.filter((c) => c.parent === catDraft.parent && c.id !== catDraft.id);
  if (siblings.some((c) => c.name === name)) {
    toast('已有同名分类');
    return;
  }
  const isEdit = !!catDraft.id;
  if (isEdit) {
    const cat = state.cats.find((c) => c.id === catDraft.id);
    if (cat) {
      cat.name = name;
      cat.color = catDraft.color;
    }
  } else {
    state.cats.push({ id: uid('c_'), name, color: catDraft.color, parent: catDraft.parent });
  }
  persist();
  closeCatModal();
  renderAll();
  toast(isEdit ? '分类已保存' : '分类已添加');
}

async function removeCategory(id) {
  const cat = state.cats.find((c) => c.id === id);
  if (!cat) return;
  const isLv1 = !cat.parent;
  const removed = new Set([id, ...state.cats.filter((c) => c.parent === id).map((c) => c.id)]);
  const affected = state.events.filter((e) => removed.has(e.cat1) || removed.has(e.cat2)).length;
  const parentCat = cat.parent ? state.cats.find((c) => c.id === cat.parent) : null;
  const text = isLv1
    ? `「${cat.name}」和它下面的二级分类会一起删除，${affected} 个日子将移到未分类。`
    : `「${cat.name}」会被删除，${affected} 个日子会留在「${parentCat ? parentCat.name : '原分类'}」里。`;
  const ok = await askConfirm({ title: '删除分类', text, okText: '删除' });
  if (!ok) return;

  state.cats = state.cats.filter((c) => !removed.has(c.id));
  state.events.forEach((ev) => {
    if (removed.has(ev.cat1)) ev.cat1 = null;
    if (removed.has(ev.cat2)) ev.cat2 = null;
    if (!ev.cat1) ev.cat2 = null;
  });
  removed.forEach((cid) => {
    delete state.collapsed[`g:${cid}`];
    delete state.collapsed[`s:${cid}`];
  });
  if (catDraft && catDraft.id === id) closeCatModal();
  persist();
  renderAll();
  toast('分类已删除');
}

/* ---------------------------- 确认框 ---------------------------- */

function askConfirm({ title, text, okText = '删除' }) {
  return new Promise((resolve) => {
    confirmResolver = resolve;
    $('#confirmTitle').textContent = title;
    $('#confirmText').textContent = text;
    $('#confirmOk').textContent = okText;
    openLayer($('#confirmLayer'));
  });
}

function resolveConfirm(value) {
  if (!confirmResolver) return;
  const resolve = confirmResolver;
  confirmResolver = null;
  closeLayer($('#confirmLayer'));
  resolve(value);
}

async function deleteEvent(id) {
  const ev = state.events.find((e) => e.id === id);
  if (!ev) return;
  const ok = await askConfirm({
    title: '删除这个日子？',
    text: `「${ev.name}」将被永久删除，无法恢复。`,
    okText: '删除'
  });
  if (!ok) return;
  state.events = state.events.filter((e) => e.id !== id);
  persist();
  closeDetail();
  renderAll();
  toast('已删除');
}

/* ---------------------------- 交互 ---------------------------- */

function renderAll() {
  renderTopbar();
  renderHome();
  renderCats();
}

function toggleFolder(btn, key) {
  const folder = btn.closest('.folder, .subfolder');
  if (!folder) return;
  const open = folder.dataset.open !== 'true';
  folder.dataset.open = String(open);
  btn.setAttribute('aria-expanded', String(open));
  if (open) delete state.collapsed[key];
  else state.collapsed[key] = true;
  persist({ skipCloud: true });
  updateToggleAllLabel();
}

function toggleAll() {
  const groups = buildGroups();
  const anyOpen = groups.some(
    (g) => !isCollapsed(g.key) || g.subs.some((sub) => !isCollapsed(`s:${sub.cat.id}`))
  );
  groups.forEach((group) => {
    if (anyOpen) {
      state.collapsed[group.key] = true;
      group.subs.forEach((sub) => {
        state.collapsed[`s:${sub.cat.id}`] = true;
      });
    } else {
      delete state.collapsed[group.key];
      group.subs.forEach((sub) => {
        delete state.collapsed[`s:${sub.cat.id}`];
      });
    }
  });
  persist({ skipCloud: true });
  renderHome();
}

document.addEventListener('click', (event) => {
  const tab = event.target.closest('.tab');
  if (tab) {
    switchView(tab.dataset.view);
    return;
  }
  const el = event.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;

  switch (act) {
    case 'new':
      openEditor(null);
      break;
    case 'toggle-folder':
    case 'toggle-sub':
      toggleFolder(el, el.dataset.key);
      break;
    case 'toggle-all':
      toggleAll();
      break;
    case 'open-event':
      openDetail(el.dataset.id);
      break;
    case 'detail-close':
      closeDetail();
      break;
    case 'edit-event':
      closeDetail();
      openEditor(state.events.find((e) => e.id === el.dataset.id) || null);
      break;
    case 'delete-event':
      deleteEvent(el.dataset.id);
      break;

    case 'editor-close':
      closeEditor();
      break;
    case 'editor-save':
      saveEditor();
      break;
    case 'toggle-repeat':
      editor.repeat = !editor.repeat;
      renderRepeat();
      break;
    case 'pick-cat1':
      if (editor.cat1 === el.dataset.id) {
        editor.cat1 = '';
        editor.cat2 = '';
      } else {
        editor.cat1 = el.dataset.id;
        editor.cat2 = '';
      }
      renderChips();
      break;
    case 'pick-cat2':
      editor.cat2 = editor.cat2 === el.dataset.id ? '' : el.dataset.id;
      renderChips();
      break;

    case 'cal-prev':
    case 'cal-next': {
      const step = act === 'cal-prev' ? -1 : 1;
      let m = editor.viewM + step;
      let y = editor.viewY;
      if (m < 1) {
        m = 12;
        y -= 1;
      } else if (m > 12) {
        m = 1;
        y += 1;
      }
      editor.viewM = m;
      editor.viewY = Math.min(2100, Math.max(1900, y));
      renderCalendar();
      if (!$('#jumpPanel').hidden) renderJump();
      break;
    }
    case 'cal-jump':
      toggleJump();
      break;
    case 'jump-year': {
      const dir = Number(el.dataset.dir);
      editor.viewY = Math.min(2100, Math.max(1900, editor.viewY + dir));
      renderJump();
      renderCalendar();
      break;
    }
    case 'jump-month':
      editor.viewM = Number(el.dataset.month);
      toggleJump(false);
      renderCalendar();
      break;
    case 'cal-today':
      pickDate(todayStr());
      break;
    case 'toggle-cal':
      toggleCal();
      break;
    case 'pick-date':
      pickDate(el.dataset.date);
      break;

    case 'add-cat1':
      openCatModal(null, null);
      break;
    case 'add-cat2':
      openCatModal(null, el.dataset.parent);
      break;
    case 'edit-cat':
      openCatModal(el.dataset.id, null);
      break;
    case 'delete-cat':
      removeCategory(el.dataset.id);
      break;
    case 'cat-cancel':
      closeCatModal();
      break;
    case 'cat-save':
      saveCategory();
      break;
    case 'cat-delete':
      if (catDraft && catDraft.id) removeCategory(catDraft.id);
      break;
    case 'pick-color':
      catDraft.color = el.dataset.color;
      renderSwatches();
      break;

    case 'confirm-ok':
      resolveConfirm(true);
      break;
    case 'confirm-cancel':
      resolveConfirm(false);
      break;

    case 'open-sync':
      openSyncSheet();
      break;
    case 'sync-close':
      closeSyncSheet();
      break;
    case 'toggle-pass':
      togglePasswordVisible();
      break;
    case 'toggle-auto':
      toggleCloudAuto();
      break;
    case 'dav-connect':
      connectCloud();
      break;
    case 'dav-upload':
      uploadCloud(false);
      break;
    case 'dav-restore':
      restoreCloud();
      break;
    case 'dav-disconnect':
      disconnectCloud();
      break;
    default:
      break;
  }
});

$$('.layer').forEach((layer) => {
  layer.addEventListener('click', (event) => {
    if (event.target !== layer) return;
    if (layer.id === 'detailLayer') closeDetail();
    else if (layer.id === 'catLayer') closeCatModal();
    else if (layer.id === 'syncLayer') closeSyncSheet();
    else if (layer.id === 'confirmLayer') resolveConfirm(false);
  });
});

document.addEventListener('keydown', (event) => {
  if ((event.key === 'Enter' || event.key === ' ') && event.target.classList && event.target.classList.contains('hero')) {
    event.preventDefault();
    event.target.click();
  }
});

$('#evName').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    $('#evName').blur();
  }
});

$('#catName').addEventListener('input', () => {
  if (catDraft) catDraft.name = $('#catName').value;
});

$('#fabNew').addEventListener('click', () => openEditor(null));

window.addEventListener('scroll', () => {
  $('.topbar').classList.toggle('scrolled', window.scrollY > 4);
}, { passive: true });

function closeTopLayer() {
  if (!layerStack.length) return false;
  const el = layerStack[layerStack.length - 1];
  if (el.id === 'confirmLayer') resolveConfirm(false);
  else if (el.id === 'detailLayer') closeDetail();
  else if (el.id === 'catLayer') closeCatModal();
  else if (el.id === 'syncLayer') closeSyncSheet();
  else if (el.id === 'editorLayer') closeEditor();
  return true;
}

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (layerStack.length) closeTopLayer();
  else if (!$('#jumpPanel').hidden) toggleJump(false);
});

/* 安卓返回键：有弹层先关弹层，没有则退出 */
if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
  window.Capacitor.Plugins.App.addListener('backButton', () => {
    if (!closeTopLayer()) window.Capacitor.Plugins.App.exitApp();
  });
}

/* ---------------------------- 启动 ---------------------------- */

renderAll();
