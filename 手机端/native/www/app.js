'use strict';

/* ------------------------------------------------------------------ *
 *  优日 · 纪念日与倒数日
 *  纯前端单页应用：状态保存在 localStorage，日历只在新建/编辑时出现
 * ------------------------------------------------------------------ */

const STORAGE_KEY = 'youri.state.v1';
const NOTIFY_KEY = 'youri.notify.v1';
const REMIND_CHANNEL = 'youri-reminders';
const REMIND_LEADS = [0, 1, 3, 7];
const DAY = 86400000;
const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];
const PALETTE = ['#C8553D', '#B8893B', '#6F8B6A', '#4F7396', '#A87B93', '#8A6F4E', '#5B6B7C', '#9B6A4F'];

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const ICONS = {
  chevron: '<svg class="folder-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m6.5 9.5 5.5 5 5.5-5"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5.5v13M5.5 12h13"/></svg>',
  cloud: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18.5h9.3a3.6 3.6 0 0 0 .5-7.2A5 5 0 0 0 7.3 10.2 4.1 4.1 0 0 0 7 18.5Z"/><path d="M12 15.2v-4M10.4 12.8 12 11.2l1.6 1.6"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 18.5h5"/><path d="M12 4.2a5.3 5.3 0 0 0-5.3 5.3c0 4-1.5 5.4-2.1 6.2-.3.4 0 .9.5.9h13.8c.5 0 .8-.5.5-.9-.6-.8-2.1-2.2-2.1-6.2A5.3 5.3 0 0 0 12 4.2Z"/></svg>',
  bellMini: '<svg class="remind-mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 18.5h5"/><path d="M12 4.2a5.3 5.3 0 0 0-5.3 5.3c0 4-1.5 5.4-2.1 6.2-.3.4 0 .9.5.9h13.8c.5 0 .8-.5.5-.9-.6-.8-2.1-2.2-2.1-6.2A5.3 5.3 0 0 0 12 4.2Z"/></svg>',
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

/* 日子这次显示 / 倒数的那一天：农历按当前年份换算成公历 */
function eventWhen(ev) {
  if (ev.lunar && ev.repeatYearly) return nextLunarOccurrence(ev.lunar).date;
  if (ev.repeatYearly) return nextRepeatDate(ev);
  return ev.date;
}

function infoOf(ev) {
  const diff = diffFromToday(ev.date);
  if (ev.repeatYearly) {
    const next = eventWhen(ev);
    const days = diffFromToday(next);
    return { kind: days === 0 ? 'today' : 'count', days: Math.abs(days), next, diff };
  }
  if (diff === 0) return { kind: 'today', days: 0 };
  if (diff > 0) return { kind: 'count', days: diff };
  return { kind: 'past', days: -diff };
}

function sortValue(ev) {
  if (ev.repeatYearly) return diffFromToday(eventWhen(ev));
  const diff = diffFromToday(ev.date);
  return diff >= 0 ? diff : 1e6 - diff;
}

function sortEvents(a, b) {
  const ao = a.order;
  const bo = b.order;
  if (ao != null || bo != null) {
    if (ao == null) return 1;
    if (bo == null) return -1;
    if (ao !== bo) return ao - bo;
  }
  return sortValue(a) - sortValue(b) || a.name.localeCompare(b.name, 'zh-Hans-CN');
}

/* 事件在首页上出现的那个列表（一级分类下的直属日子、某个二级分类、或未分类） */
function listForEvent(ev, excludeId = null) {
  const keep = (e) => e.id !== excludeId;
  const root = state.cats.find((c) => c.id === ev.cat1 && !c.parent);
  if (!root) {
    return state.events
      .filter((e) => keep(e) && !state.cats.some((c) => !c.parent && c.id === e.cat1))
      .sort(sortEvents);
  }
  const sub = ev.cat2 && state.cats.find((c) => c.id === ev.cat2 && c.parent === root.id);
  if (sub) {
    return state.events.filter((e) => keep(e) && e.cat1 === root.id && e.cat2 === sub.id).sort(sortEvents);
  }
  return state.events
    .filter((e) => keep(e) && e.cat1 === root.id && !state.cats.some((c) => c.id === e.cat2 && c.parent === root.id))
    .sort(sortEvents);
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

/* ---------------------------- 农历 ---------------------------- */

/* 1901–2100 农历年数据（由 .NET ChineseLunisolarCalendar 逐月校验生成）
   低 4 位：闰月月份（0 = 无闰月）；bit16：闰月 30 天；
   bit15…bit4：正月…腊月是否 30 天。 */
const LUNAR_START = 1901;
const LUNAR_INFO = [
  0x4ae0, 0xa570, 0x54d5, 0xd260, 0xd950, 0x16554, 0x56a0, 0x9ad0,
  0x55d2, 0x4ae0, 0xa5b6, 0xa4d0, 0xd250, 0x1d255, 0xb540, 0xd6a0,
  0xada2, 0x95b0, 0x14977, 0x4970, 0xa4b0, 0xb4b5, 0x6a50, 0x6d40,
  0x1ab54, 0x2b60, 0x9570, 0x52f2, 0x4970, 0x6566, 0xd4a0, 0xea50,
  0x16a95, 0x5ad0, 0x2b60, 0x186e3, 0x92e0, 0x1c8d7, 0xc950, 0xd4a0,
  0x1d8a6, 0xb550, 0x56a0, 0x1a5b4, 0x25d0, 0x92d0, 0xd2b2, 0xa950,
  0xb557, 0x6ca0, 0xb550, 0x15355, 0x4da0, 0xa5b0, 0x14573, 0x52b0,
  0xa9a8, 0xe950, 0x6aa0, 0xaea6, 0xab50, 0x4b60, 0xaae4, 0xa570,
  0x5260, 0xf263, 0xd950, 0x5b57, 0x56a0, 0x96d0, 0x4dd5, 0x4ad0,
  0xa4d0, 0xd4d4, 0xd250, 0xd558, 0xb540, 0xb6a0, 0x195a6, 0x95b0,
  0x49b0, 0xa974, 0xa4b0, 0xb27a, 0x6a50, 0x6d40, 0xaf46, 0xab60,
  0x9570, 0x4af5, 0x4970, 0x64b0, 0x74a3, 0xea50, 0x6b58, 0x5ac0,
  0xab60, 0x96d5, 0x92e0, 0xc960, 0xd954, 0xd4a0, 0xda50, 0x7552,
  0x56a0, 0xabb7, 0x25d0, 0x92d0, 0xcab5, 0xa950, 0xb4a0, 0xbaa4,
  0xad50, 0x55d9, 0x4ba0, 0xa5b0, 0x15176, 0x52b0, 0xa930, 0x7954,
  0x6aa0, 0xad50, 0x5b52, 0x4b60, 0xa6e6, 0xa4e0, 0xd260, 0xea65,
  0xd530, 0x5aa0, 0x76a3, 0x96d0, 0x4afb, 0x4ad0, 0xa4d0, 0x1d0b6,
  0xd250, 0xd520, 0xdd45, 0xb5a0, 0x56d0, 0x55b2, 0x49b0, 0xa577,
  0xa4b0, 0xaa50, 0x1b255, 0x6d20, 0xada0, 0x14b63, 0x9370, 0x49f8,
  0x4970, 0x64b0, 0x168a6, 0xea50, 0x6b20, 0x1a6c4, 0xaae0, 0x92e0,
  0xd2e3, 0xc960, 0xd557, 0xd4a0, 0xda50, 0x5d55, 0x56a0, 0xa6d0,
  0x55d4, 0x52d0, 0xa9b8, 0xa950, 0xb4a0, 0xb6a6, 0xad50, 0x55a0,
  0xaba4, 0xa5b0, 0x52b0, 0xb273, 0x6930, 0x7337, 0x6aa0, 0xad50,
  0x14b55, 0x4b60, 0xa570, 0x54e4, 0xd260, 0xe968, 0xd520, 0xdaa0,
  0x16aa6, 0x56d0, 0x4ae0, 0xa9d4, 0xa4d0, 0xd150, 0xf252, 0xd520
];
const LUNAR_MONTHS = ['正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '冬月', '腊月'];
const LUNAR_DAYS = [
  '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'
];
/* 农历 1901 年正月初一 = 公历 1901-02-19 */
const LUNAR_BASE_DAY = dayIndex('1901-02-19');

function lunarInfoOf(ly) {
  return LUNAR_INFO[ly - LUNAR_START] || 0;
}

function lunarLeapMonth(ly) {
  return lunarInfoOf(ly) & 0xf;
}

function lunarLeapDays(ly) {
  return lunarInfoOf(ly) & 0x10000 ? 30 : 29;
}

function lunarMonthDays(ly, m) {
  return lunarInfoOf(ly) & (0x10000 >> m) ? 30 : 29;
}

/* 每个农历年从 1901 年起累计的天数，换算时免去逐年累加 */
const LUNAR_YEAR_OFFSET = (() => {
  const out = [0];
  for (let ly = LUNAR_START; ly <= LUNAR_START + LUNAR_INFO.length - 1; ly += 1) {
    let days = 0;
    for (let m = 1; m <= 12; m += 1) days += lunarMonthDays(ly, m);
    if (lunarLeapMonth(ly)) days += lunarLeapDays(ly);
    out.push(out[out.length - 1] + days);
  }
  return out;
})();

function dayToYmd(di) {
  const dt = new Date(di * DAY);
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/* 农历 → 公历；leap 指定的闰月在该年不存在时按普通月，日超出月长时取月末 */
function lunarToDayIndex(ly, m, d, leap) {
  const idx = ly - LUNAR_START;
  if (idx < 0 || idx >= LUNAR_YEAR_OFFSET.length - 1) return NaN;
  const lm = lunarLeapMonth(ly);
  const useLeap = !!leap && lm === m;
  let offset = LUNAR_YEAR_OFFSET[idx];
  for (let i = 1; i < m; i += 1) offset += lunarMonthDays(ly, i);
  if (lm && lm < m) offset += lunarLeapDays(ly);
  if (useLeap) offset += lunarMonthDays(ly, m);
  const maxD = useLeap ? lunarLeapDays(ly) : lunarMonthDays(ly, m);
  return LUNAR_BASE_DAY + offset + Math.min(Math.max(d, 1), maxD) - 1;
}

/* 公历 → 农历；超出 1901–2100 时返回 null */
function lunarFromDayIndex(di) {
  let offset = di - LUNAR_BASE_DAY;
  const total = LUNAR_YEAR_OFFSET[LUNAR_YEAR_OFFSET.length - 1];
  if (offset < 0 || offset >= total) return null;
  let lo = 0;
  let hi = LUNAR_YEAR_OFFSET.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (LUNAR_YEAR_OFFSET[mid] <= offset) lo = mid;
    else hi = mid;
  }
  const ly = LUNAR_START + lo;
  offset -= LUNAR_YEAR_OFFSET[lo];
  const lm = lunarLeapMonth(ly);
  for (let m = 1; m <= 12; m += 1) {
    const len = lunarMonthDays(ly, m);
    if (offset < len) return { ly, m, d: offset + 1, leap: false };
    offset -= len;
    if (lm === m) {
      const leapLen = lunarLeapDays(ly);
      if (offset < leapLen) return { ly, m, d: offset + 1, leap: true };
      offset -= leapLen;
    }
  }
  return null;
}

function lunarOfDate(dateStr) {
  return lunarFromDayIndex(dayIndex(dateStr));
}

/* 某个公历日期对应的农历文字，如「八月十五」「闰六月初一」 */
function lunarLabelOf(dateStr) {
  const l = lunarOfDate(dateStr);
  if (!l) return '';
  return `${l.leap ? '闰' : ''}${LUNAR_MONTHS[l.m - 1]}${LUNAR_DAYS[l.d - 1]}`;
}

/* 农历月日换算到某个农历年的公历日期（闰月缺失时按普通月） */
function lunarInYear(lunar, ly) {
  const di = lunarToDayIndex(ly, lunar.m, lunar.d, lunar.leap);
  if (!Number.isFinite(di)) return null;
  return { date: dayToYmd(di), ly };
}

/* 从今天起的下一次农历月日；闰月缺失的年份按普通月计算 */
function nextLunarOccurrence(lunar) {
  const ty = parseYmd(todayStr()).y;
  const today = dayIndex(todayStr());
  for (let ly = ty - 1; ly <= ty + 2; ly += 1) {
    const hit = lunarInYear(lunar, ly);
    if (hit && dayIndex(hit.date) >= today) return hit;
  }
  return lunarInYear(lunar, ty + 3) || { date: todayStr(), ly: ty };
}

function normalizeLunar(value) {
  if (!value || typeof value !== 'object') return null;
  const m = Number(value.m);
  const d = Number(value.d);
  if (!Number.isInteger(m) || m < 1 || m > 12) return null;
  if (!Number.isInteger(d) || d < 1 || d > 30) return null;
  return { m, d, leap: !!value.leap };
}

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

function normalizeRemind(value) {
  if (!value || typeof value !== 'object') return null;
  const lead = Number(value.lead);
  if (!REMIND_LEADS.includes(lead)) return null;
  const time = isClockTime(value.time) ? String(value.time) : '09:00';
  return { lead, time };
}

/* 事件的可选「截止时刻」，格式 HH:MM，空字符串表示未填 */
function isClockTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''));
}

/* 一个日子 / 生日可有多条提醒，按「当天 → 提前 1 → 3 → 7 天」排序 */
function normalizeReminds(value, legacy) {
  const list = Array.isArray(value) ? value : [];
  const out = [];
  const seen = new Set();
  list.forEach((item) => {
    const one = normalizeRemind(item);
    if (!one || seen.has(one.lead)) return;
    seen.add(one.lead);
    out.push(one);
  });
  const old = normalizeRemind(legacy);
  if (!out.length && old) out.push(old);
  return out.sort((a, b) => REMIND_LEADS.indexOf(a.lead) - REMIND_LEADS.indexOf(b.lead));
}

/* 读取时兼容旧版单条提醒（remind 对象） */
function remindsOf(item) {
  if (!item) return [];
  if (Array.isArray(item.reminds)) return item.reminds;
  return item.remind ? [item.remind] : [];
}

function leadLabel(lead) {
  return lead === 0 ? '当天' : `提前 ${lead} 天`;
}

function remindText(remind) {
  return remind ? `${leadLabel(remind.lead)} · ${remind.time}` : '';
}

function normalizeEvent(ev) {
  const order = ev.order == null ? null : Number(ev.order);
  const reminds = normalizeReminds(ev.reminds, ev.remind);
  return {
    id: ev.id || uid('e_'),
    name: String(ev.name || '').slice(0, 24),
    date: ev.date,
    time: isClockTime(ev.time) ? String(ev.time) : '',
    lunar: normalizeLunar(ev.lunar),
    cat1: ev.cat1 || null,
    cat2: ev.cat2 || null,
    repeatYearly: !!ev.repeatYearly,
    note: String(ev.note || '').slice(0, 140),
    remind: reminds[0] || null,
    reminds,
    order: Number.isFinite(order) ? order : null,
    createdAt: ev.createdAt || Date.now()
  };
}

function normalizeBirthday(b) {
  const reminds = normalizeReminds(b.reminds, b.remind);
  return {
    id: b.id || uid('b_'),
    name: String(b.name || '').slice(0, 20),
    date: b.date,
    lunar: normalizeLunar(b.lunar),
    remind: reminds[0] || null,
    reminds,
    createdAt: b.createdAt || Date.now()
  };
}

function normalizeTodo(t) {
  const done = !!t.done;
  return {
    id: t.id || uid('t_'),
    text: String(t.text || '').slice(0, 80),
    done,
    createdAt: t.createdAt || Date.now(),
    doneAt: done ? Number(t.doneAt) || Date.now() : 0
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

function sanitizeBirthdays(list) {
  return (Array.isArray(list) ? list : [])
    .filter((b) => b && b.name && /^\d{4}-\d{2}-\d{2}$/.test(b.date || ''))
    .map(normalizeBirthday);
}

function sanitizeTodos(list) {
  return (Array.isArray(list) ? list : [])
    .filter((t) => t && t.text)
    .map(normalizeTodo);
}

function loadState() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  } catch (err) {
    saved = null;
  }
  if (!saved || !Array.isArray(saved.events) || !Array.isArray(saved.cats)) {
    return { v: 1, cats: defaultCats(), events: [], birthdays: [], todos: [], collapsed: {}, updatedAt: 0 };
  }
  return {
    v: 1,
    cats: sanitizeCats(saved.cats),
    events: sanitizeEvents(saved.events),
    birthdays: sanitizeBirthdays(saved.birthdays),
    todos: sanitizeTodos(saved.todos),
    collapsed: saved.collapsed && typeof saved.collapsed === 'object' ? saved.collapsed : {},
    updatedAt: Number(saved.updatedAt) || 0
  };
}

const params = new URLSearchParams(location.search);
const DEMO = params.has('demo');

function defaultNotifyConfig() {
  return { enabled: false, defaultLead: 1, defaultTime: '09:00' };
}

function loadNotifyConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(NOTIFY_KEY) || 'null');
    if (saved) {
      return {
        enabled: !!saved.enabled,
        defaultLead: REMIND_LEADS.includes(Number(saved.defaultLead)) ? Number(saved.defaultLead) : 1,
        defaultTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(saved.defaultTime || '')) ? String(saved.defaultTime) : '09:00'
      };
    }
  } catch (err) {
    /* 配置损坏时回退默认值 */
  }
  return defaultNotifyConfig();
}

let notify = loadNotifyConfig();

function demoState() {
  const s = { v: 1, cats: defaultCats(), events: [], birthdays: [], todos: [], collapsed: {} };
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
  const add = (name, offset, c1, c2, repeat = false, note = '', remind = null, time = '', lunar = null) => {
    s.events.push({
      id: uid('e_'),
      name,
      date: lunar ? nextLunarOccurrence(lunar).date : offsetDate(offset),
      time,
      lunar,
      cat1: catId(c1),
      cat2: c2 ? catId(c2) : null,
      repeatYearly: repeat,
      note,
      remind,
      reminds: remind ? [remind] : [],
      createdAt: Date.now()
    });
  };
  add('小满的生日', 12, '生活', '生日', true, '记得提前订花，晚上回家吃饭', { lead: 1, time: '09:00' });
  add('我们的纪念日', 26, '家人', '纪念日', true, '第七年', { lead: 3, time: '20:00' });
  add('去看海', 5, '生活', '旅行', false, '高铁 09:12，带相机', { lead: 0, time: '07:30' }, '09:12');
  add('中秋团圆', 0, '生活', '节日', true, '记得买月饼', null, '', { m: 8, d: 15, leap: false });
  add('考研初试', 61, '成长', '目标', false, '');
  add('搬进新家', -40, '生活', '', false, '那天下了小雨');
  add('毕业典礼', -380, '成长', '里程碑', false, '');
  add('第一次看雪山', -800, '生活', '旅行', false, '');
  const birth = (name, date, remind = null, lunar = null) =>
    s.birthdays.push({
      id: uid('b_'),
      name,
      date: lunar ? nextLunarOccurrence(lunar).date : date,
      lunar,
      remind,
      reminds: remind ? [remind] : [],
      createdAt: Date.now()
    });
  birth('小满', '1996-11-02', { lead: 1, time: '09:00' });
  birth('妈妈', '1971-12-18', { lead: 3, time: '20:00' }, { m: 12, d: 8, leap: false });
  birth('阿哲', '1998-03-09');
  const todo = (text, done = false, ago = 0) =>
    s.todos.push({ id: uid('t_'), text, done, createdAt: Date.now() - (ago + 3600000) * 3, doneAt: done ? Date.now() - ago : 0 });
  todo('给相机充电', false, 1);
  todo('买一束桔梗', false, 0);
  todo('预约体检', false, 0);
  todo('把照片导出来', true, 86400000);
  todo('交电费', true, 86400000 * 2);
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
  if (!options.skipCloud) {
    queueAutoBackup();
    queueReminderSync();
  }
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

/* ---------------------------- 系统通知 ---------------------------- */

function localNotifications() {
  const plugins = window.Capacitor && window.Capacitor.Plugins;
  return (plugins && plugins.LocalNotifications) || null;
}

function notificationSupported() {
  return !!localNotifications();
}

let notifPerm = 'unknown';
let exactPerm = 'unknown';
let notifBusy = false;
let notifTimer = 0;

function saveNotifyConfig() {
  if (DEMO) return;
  try {
    localStorage.setItem(NOTIFY_KEY, JSON.stringify(notify));
  } catch (err) {
    /* 忽略存储失败 */
  }
}

async function checkNotificationPermission() {
  const LN = localNotifications();
  if (!LN) {
    notifPerm = 'unsupported';
    exactPerm = 'unsupported';
    return notifPerm;
  }
  try {
    const res = await LN.checkPermissions();
    notifPerm = (res && res.display) || 'prompt';
  } catch (err) {
    notifPerm = 'unknown';
  }
  if (notifPerm === 'granted') {
    try {
      const ex = await LN.checkExactNotificationSetting();
      exactPerm = (ex && ex.exact_alarm) || 'unknown';
    } catch (err) {
      exactPerm = 'unknown';
    }
  }
  return notifPerm;
}

async function ensureNotificationChannel() {
  const LN = localNotifications();
  if (!LN) return;
  try {
    await LN.createChannel({
      id: REMIND_CHANNEL,
      name: '日子提醒',
      description: '生日与纪念日提醒',
      importance: 4,
      visibility: 1,
      vibration: true
    });
  } catch (err) {
    /* 渠道已存在或系统不支持 */
  }
}

async function requestNotificationPermission() {
  const LN = localNotifications();
  if (!LN) {
    setNotifyMsg('网页预览无法申请系统通知，请在手机 App 中使用。', 'error');
    return false;
  }
  notifBusy = true;
  renderRemindSheet();
  try {
    const res = await LN.requestPermissions();
    notifPerm = (res && res.display) || 'denied';
    if (notifPerm === 'granted') {
      try {
        const ex = await LN.checkExactNotificationSetting();
        exactPerm = (ex && ex.exact_alarm) || 'unknown';
      } catch (err) {
        exactPerm = 'unknown';
      }
      await ensureNotificationChannel();
      setNotifyMsg('通知权限已开启', 'success');
    } else {
      setNotifyMsg('还没有获得通知权限，请在系统设置中允许「优日」发送通知', 'error');
    }
  } catch (err) {
    notifPerm = 'denied';
    setNotifyMsg(err.message || '开启通知权限失败', 'error');
  }
  notifBusy = false;
  renderRemindSheet();
  renderTopbar();
  if (editor) renderRemindChips();
  return notifPerm === 'granted';
}

function reminderBody(lead, dateStr) {
  const { m, d } = parseYmd(dateStr);
  return lead === 0 ? `就是今天 · ${m}月${d}日` : `还有 ${lead} 天 · ${m}月${d}日`;
}

/* 计算接下来要发的提醒（纯函数，方便测试） */
function reminderPlan() {
  const now = Date.now();
  const plan = [];
  const add = (remind, title, dateStr) => {
    const [hh, mm] = remind.time.split(':').map(Number);
    const { y, m, d } = parseYmd(dateStr);
    const at = new Date(y, m - 1, d - remind.lead, hh, mm, 0, 0).getTime();
    if (!Number.isFinite(at) || at <= now + 5000) return;
    plan.push({ title, body: reminderBody(remind.lead, dateStr), at, date: dateStr });
  };

  state.events.forEach((ev) => {
    const reminds = remindsOf(ev);
    if (!reminds.length) return;
    const orig = parseYmd(ev.date);
    if (ev.repeatYearly && ev.lunar) {
      const first = nextLunarOccurrence(ev.lunar);
      const after = lunarInYear(ev.lunar, first.ly + 1);
      reminds.forEach((remind) => {
        add(remind, ev.name, first.date);
        if (after) add(remind, ev.name, after.date);
      });
    } else if (ev.repeatYearly) {
      const next = nextRepeatDate(ev);
      const n = parseYmd(next);
      const after = safeDate(n.y + 1, orig.m, orig.d);
      reminds.forEach((remind) => {
        add(remind, ev.name, next);
        add(remind, ev.name, after);
      });
    } else if (diffFromToday(ev.date) >= 0) {
      reminds.forEach((remind) => add(remind, ev.name, ev.date));
    }
  });

  state.birthdays.forEach((b) => {
    const reminds = remindsOf(b);
    if (!reminds.length) return;
    const title = birthTitle(b);
    const orig = parseYmd(b.date);
    if (b.lunar) {
      const first = nextLunarOccurrence(b.lunar);
      const after = lunarInYear(b.lunar, first.ly + 1);
      reminds.forEach((remind) => {
        add(remind, title, first.date);
        if (after) add(remind, title, after.date);
      });
      return;
    }
    const next = nextRepeatDate({ date: b.date, repeatYearly: true });
    const n = parseYmd(next);
    const after = safeDate(n.y + 1, orig.m, orig.d);
    reminds.forEach((remind) => {
      add(remind, title, next);
      add(remind, title, after);
    });
  });

  return plan.sort((a, b) => a.at - b.at).slice(0, 100);
}

async function cancelScheduledReminders() {
  const LN = localNotifications();
  if (!LN) return;
  try {
    const pending = await LN.getPending();
    const list = (pending.notifications || []).map((n) => ({ id: n.id }));
    if (list.length) await LN.cancel({ notifications: list });
  } catch (err) {
    /* 取消失败时忽略 */
  }
}

async function refreshReminders() {
  const LN = localNotifications();
  if (!LN) return;
  if (notifPerm === 'unknown') await checkNotificationPermission();
  if (!notify.enabled) {
    await cancelScheduledReminders();
    return;
  }
  if (notifPerm !== 'granted') return;

  notifBusy = true;
  renderRemindSheet();
  try {
    await ensureNotificationChannel();
    const plan = reminderPlan();
    await cancelScheduledReminders();
    if (plan.length) {
      const exact = exactPerm !== 'denied';
      await LN.schedule({
        notifications: plan.map((p, i) => ({
          id: i + 1,
          title: p.title,
          body: p.body,
          channelId: REMIND_CHANNEL,
          schedule: { at: new Date(p.at), allowWhileIdle: true, isExactNotification: exact }
        }))
      });
    }
    setNotifyMsg(plan.length ? `已安排 ${plan.length} 条提醒` : '暂时没有需要提醒的日子', 'info');
  } catch (err) {
    setNotifyMsg(err.message || '安排提醒失败', 'error');
  }
  notifBusy = false;
  renderRemindSheet();
  renderTopbar();
}

function queueReminderSync() {
  if (DEMO) return;
  window.clearTimeout(notifTimer);
  notifTimer = window.setTimeout(() => {
    if (notify.enabled) refreshReminders();
  }, 1400);
}

async function setNotifyEnabled(next) {
  if (notifBusy) return;
  if (next) {
    if (notifPerm !== 'granted') {
      const ok = await requestNotificationPermission();
      if (!ok) {
        renderRemindSheet();
        return;
      }
    }
    notify.enabled = true;
    saveNotifyConfig();
    await refreshReminders();
    setNotifyMsg('提醒已开启', 'success');
  } else {
    notify.enabled = false;
    saveNotifyConfig();
    await cancelScheduledReminders();
    setNotifyMsg('已关闭所有提醒', 'info');
  }
  renderRemindSheet();
  renderTopbar();
}

function setNotifyDefaultTime(value) {
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || '')) ? String(value) : '09:00';
  notify.defaultTime = time;
  saveNotifyConfig();
}

function setNotifyDefaultLead(lead) {
  if (!REMIND_LEADS.includes(lead)) return;
  notify.defaultLead = lead;
  saveNotifyConfig();
  renderNotifyLeads();
}

async function sendTestNotification() {
  const LN = localNotifications();
  if (!LN) {
    setNotifyMsg('网页预览无法发送系统通知，请安装 APK 后测试。', 'error');
    return;
  }
  if (notifPerm !== 'granted') {
    const ok = await requestNotificationPermission();
    if (!ok) return;
  }
  notifBusy = true;
  renderRemindSheet();
  try {
    await ensureNotificationChannel();
    await LN.schedule({
      notifications: [{
        id: 9999,
        title: '优日提醒测试',
        body: '看到这条通知，说明提醒已经生效。',
        channelId: REMIND_CHANNEL,
        schedule: {
          at: new Date(Date.now() + 5000),
          allowWhileIdle: true,
          isExactNotification: exactPerm !== 'denied'
        }
      }]
    });
    setNotifyMsg('测试通知会在 5 秒后出现，可以回到桌面查看。', 'success');
  } catch (err) {
    setNotifyMsg(err.message || '发送测试通知失败', 'error');
  }
  notifBusy = false;
  renderRemindSheet();
}

async function openExactAlarmSettings() {
  const LN = localNotifications();
  if (!LN) return;
  try {
    await LN.changeExactNotificationSetting();
  } catch (err) {
    setNotifyMsg('无法打开系统设置，请手动到「设置 → 应用 → 优日」中允许闹钟与提醒。', 'error');
  }
}

function isRemindOpen() {
  const el = $('#remindLayer');
  return !!el && !el.hidden && el.classList.contains('open');
}

function setNotifyMsg(text, tone = 'info') {
  const el = $('#notifyMsg');
  if (!el) return;
  if (!text) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.hidden = false;
  el.textContent = text;
  el.dataset.tone = tone;
}

function notifyStatusInfo() {
  if (!notificationSupported()) {
    return { state: 'off', title: '网页预览', sub: '系统通知只在手机 App 中生效' };
  }
  if (notifBusy) return { state: 'busy', title: '正在设置…', sub: '请稍候' };
  if (notifPerm === 'granted') {
    if (notify.enabled) {
      const count = reminderPlan().length;
      return {
        state: 'on',
        title: '提醒已开启',
        sub: count ? `已安排 ${count} 条提醒` : '暂时没有需要提醒的日子'
      };
    }
    return { state: 'off', title: '通知权限已开启', sub: '打开下面的开关开始提醒' };
  }
  if (notifPerm === 'denied') {
    return { state: 'error', title: '通知权限未开启', sub: '请在系统设置中允许优日发送通知' };
  }
  return { state: 'off', title: '未开启通知权限', sub: '点上面的按钮授权即可' };
}

function renderNotifyLeads() {
  const host = $('#notifyLeads');
  if (!host) return;
  host.innerHTML = REMIND_LEADS.map(
    (lead) => `<button class="chip${lead === notify.defaultLead ? ' on' : ''}" style="--c:#C8553D" data-act="pick-notify-lead" data-lead="${lead}" aria-pressed="${lead === notify.defaultLead}">${leadLabel(lead)}</button>`
  ).join('');
}

function renderRemindSheet(fillInputs) {
  const host = $('#remindLayer');
  if (!host) return;
  const status = notifyStatusInfo();
  $('#notifStatus').dataset.state = status.state;
  $('#notifStatusTitle').textContent = status.title;
  $('#notifStatusSub').textContent = status.sub;

  const supported = notificationSupported();
  $('#notifPermBtn').hidden = !supported || notifPerm === 'granted';
  $('#notifPermBtn').disabled = notifBusy;
  $('#notifyRow').setAttribute('aria-checked', String(!!notify.enabled));
  $('#notifyRow').querySelector('.switch').dataset.on = String(!!notify.enabled);
  $('#notifyRow').classList.toggle('locked', !supported);
  if (fillInputs) $('#notifyTime').value = notify.defaultTime;
  $('#notifyTime').disabled = !supported || notifBusy;
  renderNotifyLeads();
  $('#notifyLeads').querySelectorAll('.chip').forEach((chip) => {
    chip.disabled = !supported || notifBusy;
  });
  $('#exactWarn').hidden = !(supported && notifPerm === 'granted' && exactPerm === 'denied');
  $('#testNotifBtn').disabled = notifBusy || !supported;
}

function openRemindSheet() {
  setNotifyMsg('');
  renderRemindSheet(true);
  openLayer($('#remindLayer'));
  checkNotificationPermission().then(() => renderRemindSheet(false));
}

function closeRemindSheet() {
  closeLayer($('#remindLayer'));
  blurActive();
}

(async function initNotify() {
  await checkNotificationPermission();
  if (notify.enabled && notifPerm === 'granted') {
    await ensureNotificationChannel();
    await refreshReminders();
  }
  renderTopbar();
})();

/* ---------------------------- 视图与弹层 ---------------------------- */

let view = 'home';
let sorting = false;
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
  if (!VIEW_IDS[next]) next = 'home';
  if (next === view) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  if (sorting && next !== 'home') {
    sorting = false;
    renderHome();
  }
  view = next;
  Object.keys(VIEW_IDS).forEach((key) => {
    $(VIEW_IDS[key]).hidden = key !== next;
  });
  $$('.tab').forEach((btn) => btn.setAttribute('aria-selected', String(btn.dataset.view === next)));
  $('#fabNew').setAttribute('aria-label', next === 'birth' ? '新建生日' : next === 'todo' ? '添加待办' : '新建日子');
  renderTopbar();
  window.scrollTo(0, 0);
}

const VIEW_IDS = { home: '#viewHome', birth: '#viewBirth', todo: '#viewTodo', cats: '#viewCats' };

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
    const own = all.filter((e) => !state.cats.some((c) => c.id === e.cat2 && c.parent === cat.id)).sort(sortEvents);
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
  const when = eventWhen(ev);
  const meta = ev.lunar
    ? `农历${lunarLabelOf(when)} · ${shortDate(when)} · ${path.text}`
    : ev.repeatYearly ? `每年 ${shortDate(ev.date)} · ${path.text}` : `${shortDate(ev.date)} · ${path.text}`;
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
      <span>${fullDateWeek(ev.lunar ? when : ev.date)}${ev.repeatYearly ? ' · 每年重复' : ''}</span>
      <span class="arrow">查看 ›</span>
    </div>
  </div>`;
}

function sortArrowsHTML(kind, id, first, last) {
  const arrow = (dir, path, label, disabled) => `<button class="sort-btn" data-act="move-${kind}" data-id="${id}" data-dir="${dir}" aria-label="${label}"${disabled ? ' disabled' : ''}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>
    </button>`;
  return `<span class="sort-btns">${arrow(-1, 'm6 14.5 6-6 6 6', '上移', first)}${arrow(1, 'm6 9.5 6 6 6-6', '下移', last)}</span>`;
}

function eventMetaText(ev) {
  const when = eventWhen(ev);
  if (ev.lunar) {
    const label = `农历${lunarLabelOf(when)}`;
    return ev.repeatYearly
      ? `${label} · ${shortDate(when)} · 每年`
      : `${label} · ${fullDate(when)} · 周${WEEK_CN[weekdayOf(when)]}`;
  }
  return ev.repeatYearly
    ? `${shortDate(ev.date)} · 每年`
    : `${fullDate(ev.date)} · 周${WEEK_CN[weekdayOf(ev.date)]}`;
}

function eventHTML(ev, sortMeta) {
  const info = infoOf(ev);
  const meta = eventMetaText(ev);
  let countHTML;
  if (info.kind === 'today') {
    countHTML = '<div class="event-count today"><span class="n">今天</span></div>';
  } else if (info.kind === 'count') {
    countHTML = `<div class="event-count"><span class="n">${info.days}</span><span class="u">天后</span></div>`;
  } else {
    countHTML = `<div class="event-count past"><span class="n">${info.days}</span><span class="u">天前</span></div>`;
  }
  const body = `<div class="event-main">
      <div class="event-name"><span>${esc(ev.name)}</span>${ev.repeatYearly ? '<span class="tag">每年</span>' : ''}${remindsOf(ev).length ? ICONS.bellMini : ''}</div>
      <div class="event-meta">${meta}</div>
    </div>
    ${countHTML}`;
  if (sortMeta) {
    return `<div class="event sorting" data-id="${ev.id}">${body}${sortArrowsHTML('event', ev.id, sortMeta.first, sortMeta.last)}</div>`;
  }
  return `<button class="event" data-act="open-event" data-id="${ev.id}">${body}</button>`;
}

function subfolderHTML(sub, sortMeta) {
  const key = `s:${sub.cat.id}`;
  const open = !!sortMeta || !isCollapsed(key);
  const head = sortMeta
    ? `<div class="sub-head sorting">
        <span class="sub-dash"></span>
        <span class="sub-name">${esc(sub.cat.name)}</span>
        <span class="sub-count">${sub.events.length}</span>
        ${sortArrowsHTML('cat', sub.cat.id, sortMeta.first, sortMeta.last)}
      </div>`
    : `<button class="sub-head" data-act="toggle-sub" data-key="${key}" aria-expanded="${open}">
        <span class="sub-dash"></span>
        <span class="sub-name">${esc(sub.cat.name)}</span>
        <span class="sub-count">${sub.events.length}</span>
        ${ICONS.chevron}
      </button>`;
  const events = sub.events
    .map((ev, i) => eventHTML(ev, sortMeta ? { first: i === 0, last: i === sub.events.length - 1 } : null))
    .join('');
  return `<div class="subfolder" data-open="${open}">${head}
    <div class="folder-body"><div class="folder-inner"><div class="events">${events}</div></div></div>
  </div>`;
}

function groupHTML(group, sortMeta) {
  const open = !!sortMeta || !isCollapsed(group.key);
  const name = group.cat ? group.cat.name : '未分类';
  const color = group.cat ? group.cat.color : '#B3A897';
  let inner = '';
  if (group.own.length) {
    const events = group.own
      .map((ev, i) => eventHTML(ev, sortMeta ? { first: i === 0, last: i === group.own.length - 1 } : null))
      .join('');
    inner += `<div class="events">${events}</div>`;
  }
  inner += group.subs
    .map((sub, i) => subfolderHTML(sub, sortMeta ? { first: i === 0, last: i === group.subs.length - 1 } : null))
    .join('');
  const head = sortMeta
    ? `<div class="folder-head sorting">
        <span class="folder-swatch" style="--c:${color}"></span>
        <span class="folder-name">${esc(name)}</span>
        <span class="folder-count">${group.events.length} 个</span>
        ${group.cat ? sortArrowsHTML('cat', group.cat.id, sortMeta.first, sortMeta.last) : ''}
      </div>`
    : `<button class="folder-head" data-act="toggle-folder" data-key="${group.key}" aria-expanded="${open}">
        <span class="folder-swatch" style="--c:${color}"></span>
        <span class="folder-name">${esc(name)}</span>
        <span class="folder-count">${group.events.length} 个</span>
        ${ICONS.chevron}
      </button>`;
  return `<section class="folder" data-open="${open}" data-key="${group.key}">
    ${head}
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
  const bellButton = `<button class="round-btn remind-btn" data-act="open-remind" data-on="${notify.enabled && notifPerm === 'granted'}" aria-label="提醒设置">
    ${ICONS.bell}
    <i class="bell-dot" aria-hidden="true"></i>
  </button>`;
  if (view === 'home') {
    title.textContent = '优日';
    sub.textContent = longToday();
    if (state.events.length) {
      const stats = homeStats();
      actions.innerHTML = `<div class="stat-pill" aria-label="倒数与纪念数量">
        <span><i class="up"></i><b>${stats.up}</b>倒数</span>
        <span><i class="past"></i><b>${stats.past}</b>纪念</span>
      </div>${bellButton}${syncButton}`;
    } else {
      actions.innerHTML = `${bellButton}${syncButton}`;
    }
  } else if (view === 'birth') {
    title.textContent = '生日';
    sub.textContent = state.birthdays.length ? `记着 ${state.birthdays.length} 个人的生日` : '记住每个人的生日';
    actions.innerHTML = `<button class="round-btn" data-act="new-birthday" aria-label="新建生日">${ICONS.plus}</button>${bellButton}${syncButton}`;
  } else if (view === 'todo') {
    const stats = todoStats();
    title.textContent = '待办';
    sub.textContent = stats.open ? `${stats.open} 件待办 · ${stats.done} 件已完成` : '小事也值得记下来';
    actions.innerHTML = `${bellButton}${syncButton}`;
  } else {
    title.textContent = '分类';
    sub.textContent = '用文件夹整理你的日子';
    actions.innerHTML = `<button class="round-btn" data-act="add-cat1" aria-label="新建一级分类">${ICONS.plus}</button>${bellButton}${syncButton}`;
  }
}

function renderHome() {
  const host = $('#homeContent');
  if (!state.events.length) {
    sorting = false;
    host.innerHTML = emptyHomeHTML();
    return;
  }
  const groups = buildGroups();
  const rootGroups = groups.filter((group) => group.cat);
  const anyOpen = groups.some(
    (g) => !isCollapsed(g.key) || g.subs.some((sub) => !isCollapsed(`s:${sub.cat.id}`))
  );
  const actions = sorting
    ? '<button class="link-btn sort-done" data-act="sort-done">完成</button>'
    : `<button class="link-btn" data-act="sort-start">排序</button>
      <span class="action-sep" aria-hidden="true">·</span>
      <button class="link-btn" data-act="toggle-all">${anyOpen ? '全部收起' : '全部展开'}</button>`;
  const groupHTMLs = groups.map((group) => {
    if (!sorting) return groupHTML(group, null);
    if (!group.cat) return groupHTML(group, {});
    const index = rootGroups.indexOf(group);
    return groupHTML(group, { first: index === 0, last: index === rootGroups.length - 1 });
  });
  host.innerHTML = `${sorting ? '' : heroHTML()}
    <div class="section-head${sorting ? ' sorting' : ''}">
      <h2>我的日子<span class="sub">共 ${state.events.length} 个</span></h2>
      <div class="section-actions">${actions}</div>
    </div>
    ${sorting ? '<p class="sort-note">点 ↑ ↓ 调整文件夹和日子的顺序，完成后自动保存。</p>' : ''}
    ${groupHTMLs.join('')}`;
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
    host.innerHTML = `<p class="cat-intro">两级分类：一级分类是首页的文件夹，二级分类是文件夹里的小分组。首页点「排序」可以调整顺序。</p>
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
  host.innerHTML = `<p class="cat-intro">两级分类：一级分类是首页的文件夹，二级分类是文件夹里的小分组。点文件夹可以展开或收起；文件夹和日子的顺序在首页点「排序」调整。</p>
    ${cards}
    <button class="cat-add" data-act="add-cat1">${ICONS.plus} 新建一级分类</button>`;
}

/* ---------------------------- 生日页 ---------------------------- */

function birthTitle(b) {
  return /的生日$/.test(b.name) ? b.name : `${b.name}的生日`;
}

function birthdayInfo(b) {
  const next = b.lunar ? nextLunarOccurrence(b.lunar).date : nextRepeatDate({ date: b.date, repeatYearly: true });
  const days = diffFromToday(next);
  return { next, days, kind: days === 0 ? 'today' : 'count' };
}

function birthDateText(b, info) {
  if (b.lunar) return `农历${lunarLabelOf(info.next)} · ${shortDate(info.next)}`;
  const { m, d } = parseYmd(b.date);
  return `${m}月${d}日`;
}

function sortedBirthdays() {
  return state.birthdays
    .map((b) => ({ b, info: birthdayInfo(b) }))
    .sort((x, y) => x.info.days - y.info.days || x.b.name.localeCompare(y.b.name, 'zh-Hans-CN'));
}

function birthRowHTML(b, info) {
  const days = info.days;
  const count = days === 0
    ? '<span class="n word">今天</span>'
    : `<span class="n">${days}</span><span class="u">天后</span>`;
  return `<button class="birth-row" data-act="open-birthday" data-id="${b.id}">
    <span class="birth-avatar" aria-hidden="true">${esc(b.name.slice(0, 1))}</span>
    <span class="birth-main">
      <b>${esc(birthTitle(b))}${remindsOf(b).length ? ICONS.bellMini : ''}</b>
      <small>${birthDateText(b, info)} · 每年</small>
    </span>
    <span class="birth-days${days === 0 ? ' today' : ''}">${count}</span>
  </button>`;
}

function birthHeroHTML(pick) {
  const { b, info } = pick;
  const today = info.days === 0;
  return `<div class="birth-hero">
    <span class="birth-hero-mark" aria-hidden="true">生</span>
    <div class="birth-hero-label">下个生日</div>
    <div class="birth-hero-body">
      <div class="birth-hero-info">
        <h2>${esc(birthTitle(b))}</h2>
        <p>${birthDateText(b, info)} · 每年重复</p>
      </div>
      <div class="birth-hero-count${today ? ' today' : ''}">
        <b>${today ? '今天' : info.days}</b>${today ? '' : '<span>天后</span>'}
      </div>
    </div>
  </div>`;
}

function emptyBirthHTML() {
  return `<div class="empty" style="margin-top:8px">
    <div class="empty-mark">生</div>
    <h3>还没有记录生日</h3>
    <p>填上名字和日子就好，<br>每年都会替你数着。</p>
    <button class="primary" data-act="new-birthday">添加第一个生日</button>
  </div>`;
}

function renderBirth() {
  const host = $('#birthContent');
  const list = sortedBirthdays();
  if (!list.length) {
    host.innerHTML = emptyBirthHTML();
    return;
  }
  host.innerHTML = `${birthHeroHTML(list[0])}
    <div class="section-head">
      <h2>全部生日<span class="sub">共 ${list.length} 个</span></h2>
      <div class="section-actions"><button class="link-btn" data-act="new-birthday">添加生日</button></div>
    </div>
    <div class="birth-list">${list.map(({ b, info }) => birthRowHTML(b, info)).join('')}</div>
    <p class="page-note">生日每年自动重复，按还有多少天从近到远排列。</p>`;
}

/* ---------------------------- 待办页 ---------------------------- */

function todoStats() {
  const done = state.todos.filter((t) => t.done).length;
  return { open: state.todos.length - done, done };
}

function todoRowHTML(t) {
  return `<div class="todo-row${t.done ? ' done' : ''}" data-id="${t.id}">
    <button class="todo-check" data-act="toggle-todo" data-id="${t.id}" role="checkbox" aria-checked="${t.done}" aria-label="${t.done ? '标记为未完成' : '标记为完成'}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 12.5 4 4 8-8.5"/></svg>
    </button>
    <button class="todo-text" data-act="toggle-todo" data-id="${t.id}">${esc(t.text)}</button>
    <button class="mini-btn del" data-act="delete-todo" data-id="${t.id}" aria-label="删除待办">${ICONS.trash}</button>
  </div>`;
}

function renderTodo() {
  const host = $('#todoBody');
  const open = state.todos.filter((t) => !t.done).sort((a, b) => b.createdAt - a.createdAt);
  const done = state.todos.filter((t) => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  let html = `<div class="section-head">
      <h2>待办<span class="sub">${open.length} 件</span></h2>
    </div>
    <div class="todo-card${open.length ? '' : ' is-empty'}">
      ${open.length ? open.map(todoRowHTML).join('') : '<p class="todo-empty">暂时没有待办，在上面写一件吧。</p>'}
    </div>`;
  if (done.length) {
    html += `<div class="section-head">
      <h2>已完成<span class="sub">${done.length} 件</span></h2>
      <div class="section-actions"><button class="link-btn" data-act="clear-done">清空</button></div>
    </div>
    <div class="todo-card done-card">${done.map(todoRowHTML).join('')}</div>`;
  }
  host.innerHTML = html;
}

function addTodo() {
  const input = $('#todoInput');
  const text = input.value.trim();
  if (!text) {
    input.focus();
    return;
  }
  state.todos.push(normalizeTodo({ id: uid('t_'), text: text.slice(0, 80), createdAt: Date.now() }));
  input.value = '';
  persist();
  renderTodo();
  renderTopbar();
  input.focus();
}

function toggleTodo(id) {
  const todo = state.todos.find((t) => t.id === id);
  if (!todo) return;
  todo.done = !todo.done;
  todo.doneAt = todo.done ? Date.now() : 0;
  persist();
  renderTodo();
  renderTopbar();
}

async function deleteTodo(id) {
  const todo = state.todos.find((t) => t.id === id);
  if (!todo) return;
  const ok = await askConfirm({
    title: '删除这条待办？',
    text: `「${todo.text}」将被永久删除。`,
    okText: '删除'
  });
  if (!ok) return;
  state.todos = state.todos.filter((t) => t.id !== id);
  persist();
  renderTodo();
  renderTopbar();
}

async function clearDoneTodos() {
  const count = state.todos.filter((t) => t.done).length;
  if (!count) return;
  const ok = await askConfirm({
    title: '清空已完成？',
    text: `${count} 条已完成的待办会被删除，未完成的不受影响。`,
    okText: '清空'
  });
  if (!ok) return;
  state.todos = state.todos.filter((t) => !t.done);
  persist();
  renderTodo();
  renderTopbar();
  toast('已清空');
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
  const shown = eventWhen(ev);
  if (ev.lunar) rows.push(`<div class="d-row"><span>农历</span><b>${esc(lunarLabelOf(shown))}</b></div>`);
  rows.push(`<div class="d-row"><span>日期</span><b>${fullDateWeek(shown)}</b></div>`);
  if (ev.time) rows.push(`<div class="d-row"><span>截止时刻</span><b>${esc(ev.time)}</b></div>`);
  if (info.kind === 'today') {
    rows.push('<div class="d-row"><span>状态</span><b>今天</b></div>');
  } else if (info.kind === 'count') {
    rows.push(`<div class="d-row"><span>状态</span><b>倒数日 · 还有 ${nf(info.days)} 天</b></div>`);
  } else {
    rows.push(`<div class="d-row"><span>状态</span><b>纪念日 · 已经 ${nf(info.days)} 天</b></div>`);
  }
  rows.push(`<div class="d-row"><span>分类</span><b>${esc(path.text)}</b></div>`);
  const reminds = remindsOf(ev);
  if (reminds.length) rows.push(`<div class="d-row"><span>提醒</span><b>${reminds.map((r) => esc(remindText(r))).join('<br>')}</b></div>`);
  if (ev.repeatYearly) {
    const nth = parseYmd(info.next).y - orig.y;
    rows.push(`<div class="d-row"><span>周期</span><b>${ev.lunar ? '每年重复（按农历）' : `每年重复${nth > 0 ? ` · 第 ${nth} 个` : ' · 首次'}`}</b></div>`);
    if (!ev.lunar) rows.push(`<div class="d-row"><span>下次</span><b>${fullDateWeek(info.next)}（${info.kind === 'today' ? '今天' : `${info.days} 天后`}）</b></div>`);
    if (isPast && !ev.lunar) rows.push(`<div class="d-row"><span>已过</span><b>${nf(-diff)} 天</b></div>`);
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

/* ---------------------------- 事件 / 生日编辑器 ---------------------------- */

function openEditor(ev) {
  startEditor(ev, 'event');
}

function openBirthdayEditor(b) {
  startEditor(b, 'birthday');
}

function startEditor(target, kind) {
  const isBirth = kind === 'birthday';
  const date = target ? target.date : todayStr();
  const d = parseYmd(date);
  editor = {
    kind,
    id: target ? target.id : null,
    date,
    name: target ? target.name : '',
    time: !isBirth && target ? target.time || '' : '',
    cat1: !isBirth && target ? target.cat1 : '',
    cat2: !isBirth && target ? target.cat2 : '',
    repeat: isBirth ? true : target ? target.repeatYearly : false,
    note: !isBirth && target ? target.note : '',
    calendar: target && target.lunar ? 'lunar' : 'solar',
    lunar: target && target.lunar ? { ...target.lunar } : null,
    reminds: target
      ? normalizeReminds(target.reminds, target.remind)
      : notify.enabled && notifPerm === 'granted'
        ? [{ lead: notify.defaultLead, time: notify.defaultTime }]
        : [],
    calOpen: !target,
    viewY: d.y,
    viewM: d.m
  };
  const isEdit = !!editor.id;
  $('#editorTitle').textContent = isBirth ? (isEdit ? '编辑生日' : '新建生日') : (isEdit ? '编辑日子' : '新建日子');
  $('#nameLabel').innerHTML = isBirth ? '寿星名字 <span class="hint">必填</span>' : '事件名称 <span class="hint">必填</span>';
  $('#evName').placeholder = isBirth ? '只写名字，如：妈妈' : '给这个日子起个名字';
  $('#evName').value = editor.name;
  $('#evNote').value = editor.note;
  $('#evTime').value = editor.time;
  $('#timeClear').hidden = !editor.time;
  $('#timeField').hidden = isBirth;
  $('#fieldCat1').hidden = isBirth;
  $('#repeatRow').hidden = isBirth;
  $('#birthRepeat').hidden = !isBirth;
  $('#noteField').hidden = isBirth;
  $('#birthPreview').hidden = !isBirth;
  $('#birthDeleteBtn').hidden = !(isBirth && isEdit);
  $('#editorFoot').classList.toggle('col', isBirth && isEdit);
  $('#editorHint').textContent = isBirth
    ? '生日只需要名字和日子，每年自动倒数。'
    : '未来的日子会倒数，过去的日子会纪念。';
  $('#saveBtn').textContent = isBirth ? '保存生日' : '保存';
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
  renderBirthPreview();
  renderRemindChips();
  renderCalWrap();
}

function renderRemindChips() {
  if (!editor) return;
  const cur = editor.reminds;
  const host = $('#remindChips');
  const chip = (active, lead, label) => `<button class="chip${active ? ' on' : ''}" style="--c:${lead === '' ? '#B3A897' : '#C8553D'}" data-act="pick-remind" data-lead="${lead}" aria-pressed="${active}">${label}</button>`;
  host.innerHTML = [chip(!cur.length, '', '不提醒'), ...REMIND_LEADS.map((lead) => chip(cur.some((r) => r.lead === lead), lead, leadLabel(lead)))].join('');
  const times = $('#remindTimes');
  times.hidden = !cur.length;
  times.innerHTML = cur
    .map((r) => `<div class="remind-time">
        <span>${leadLabel(r.lead)}</span>
        <input type="time" step="60" value="${r.time}" data-lead="${r.lead}" aria-label="${leadLabel(r.lead)}的通知时间">
      </div>`)
    .join('');
  $('#remindNote').hidden = !cur.length || notifPerm === 'granted';
}

function birthPreviewText() {
  const name = $('#evName').value.trim();
  if (!name) return '输入名字后自动生成「xx的生日」';
  const title = /的生日$/.test(name) ? name : `${name}的生日`;
  return `将显示为「${title}」`;
}

function renderBirthPreview() {
  if (!editor || editor.kind !== 'birthday') return;
  $('#birthPreview').textContent = birthPreviewText();
}

function renderCalWrap() {
  const wrap = $('#calWrap');
  const lunarMode = editor.calendar === 'lunar';
  wrap.hidden = lunarMode;
  wrap.dataset.open = String(!!editor.calOpen);
  wrap.querySelector('.cal').inert = !editor.calOpen;
  $('#modeSolar').classList.toggle('on', !lunarMode);
  $('#modeSolar').setAttribute('aria-pressed', String(!lunarMode));
  $('#modeLunar').classList.toggle('on', lunarMode);
  $('#modeLunar').setAttribute('aria-pressed', String(lunarMode));
  renderLunarPanel();
}

function renderLunarPanel() {
  const panel = $('#lunarPanel');
  const lunar = editor && editor.calendar === 'lunar' ? editor.lunar : null;
  if (!lunar) {
    panel.hidden = true;
    return;
  }
  panel.hidden = !editor.calOpen;
  const actual = lunarOfDate(editor.date);
  const maxD = actual
    ? (actual.leap ? lunarLeapDays(actual.ly) : lunarMonthDays(actual.ly, actual.m))
    : 30;
  const leapOk = actual ? actual.leap : false;
  $('#lunarMonths').innerHTML = LUNAR_MONTHS.map((name, i) => {
    const m = i + 1;
    const on = lunar.m === m;
    return `<button class="month-chip${on ? ' on' : ''}" type="button" data-act="pick-lunar-month" data-m="${m}" aria-pressed="${on}">${on && lunar.leap ? `闰${name}` : name}</button>`;
  }).join('');
  $('#lunarDays').innerHTML = LUNAR_DAYS.map((name, i) => {
    const d = i + 1;
    const on = lunar.d === d;
    const dim = d > maxD ? ' dim' : '';
    return `<button class="day-chip${on ? ' on' : ''}${dim}" type="button" data-act="pick-lunar-day" data-d="${d}" aria-pressed="${on}" aria-label="农历${name}">${d}</button>`;
  }).join('');
  const leapChip = $('#leapChip');
  leapChip.setAttribute('aria-pressed', String(!!lunar.leap));
  leapChip.textContent = lunar.leap ? `闰${LUNAR_MONTHS[lunar.m - 1]}` : '闰月';
  const notes = [`对应公历 ${fullDateWeek(editor.date)}`];
  if (lunar.leap && !leapOk) notes.push(`今年没有闰${LUNAR_MONTHS[lunar.m - 1]}，按${LUNAR_MONTHS[lunar.m - 1]}计算。`);
  if (actual && lunar.d > maxD) notes.push(`今年这个月是${LUNAR_DAYS[maxD - 1]}，按月末计算。`);
  $('#lunarNote').textContent = notes.join(' ');
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
    const marked = editor.kind === 'birthday' ? hasBirthdayOn(ds) : hasEventOn(ds);
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
  const noun = editor.kind === 'birthday' ? '生日' : '日子';
  $('#calEventsHint').textContent = monthMarks ? `本月 ${monthMarks} 个${noun}` : `本月暂无${noun}`;
}

/* 农历日子在某个公历年份里落在哪一天（跨年农历月会落在次年年初） */
const lunarDotCache = new Map();

function lunarHitsDate(lunar, ds) {
  const gy = parseYmd(ds).y;
  const key = `${lunar.m}|${lunar.d}|${lunar.leap ? 1 : 0}|${gy}`;
  let set = lunarDotCache.get(key);
  if (!set) {
    set = new Set();
    for (let ly = gy - 1; ly <= gy; ly += 1) {
      const hit = lunarInYear(lunar, ly);
      if (hit) set.add(hit.date);
    }
    lunarDotCache.set(key, set);
  }
  return set.has(ds);
}

function hasEventOn(ds) {
  return state.events.some((ev) => {
    if (ev.date === ds) return true;
    if (!ev.repeatYearly) return false;
    if (ev.lunar) return lunarHitsDate(ev.lunar, ds);
    if (dayIndex(ds) < dayIndex(ev.date)) return false;
    const orig = parseYmd(ev.date);
    const cur = parseYmd(ds);
    return orig.m === cur.m && orig.d === cur.d;
  });
}

function hasBirthdayOn(ds) {
  return state.birthdays.some((b) => {
    if (b.lunar) return lunarHitsDate(b.lunar, ds);
    if (dayIndex(ds) < dayIndex(b.date)) return false;
    const orig = parseYmd(b.date);
    const cur = parseYmd(ds);
    return orig.m === cur.m && orig.d === cur.d;
  });
}

function renderPicked() {
  const lunar = editor.calendar === 'lunar' ? editor.lunar : null;
  const isBirth = editor.kind === 'birthday';
  const showsNext = !!lunar && (editor.repeat || isBirth);
  const ds = showsNext ? nextLunarOccurrence(lunar).date : editor.date;
  const days = diffFromToday(ds);
  let tag;
  if (isBirth) {
    tag = days === 0 ? '今天生日' : `生日 · 还有 ${days} 天`;
    $('#picked').className = 'picked';
  } else if (days === 0) {
    tag = '今天 · 就是这天';
    $('#picked').className = 'picked';
  } else if (days > 0) {
    tag = `倒数日 · ${days} 天`;
    $('#picked').className = 'picked';
  } else {
    tag = `纪念日 · ${-days} 天`;
    $('#picked').className = 'picked past';
  }
  const dateHTML = lunar
    ? `<span class="picked-date lunar">农历${esc(lunarLabelOf(ds))}<small>公历 ${fullDate(ds)} · 周${WEEK_CN[weekdayOf(ds)]}</small></span>`
    : `<span class="picked-date">${fullDate(ds)}<small>周${WEEK_CN[weekdayOf(ds)]}</small></span>`;
  $('#picked').innerHTML = `${dateHTML}
    <span class="picked-tag">${tag}</span>
    <button class="picked-edit" data-act="toggle-cal" aria-label="${editor.calOpen ? '收起日期选择' : '修改日期'}">${editor.calOpen ? '收起' : '改日期'}</button>`;
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

/* 公历 / 农历 切换：切到农历时沿用当前日期对应的农历月日 */
function setCalendarMode(mode) {
  if (!editor || editor.calendar === mode) return;
  editor.calendar = mode;
  if (mode === 'lunar') {
    const l = lunarOfDate(editor.date);
    editor.lunar = l ? { m: l.m, d: l.d, leap: l.leap } : { m: 1, d: 1, leap: false };
    editor.calOpen = true;
  } else {
    editor.lunar = null;
  }
  renderEditor();
}

/* 选了农历月 / 日 / 闰月后，换算成下一次的公历日期 */
function syncLunarDate() {
  const hit = nextLunarOccurrence(editor.lunar);
  editor.date = hit.date;
  const d = parseYmd(editor.date);
  editor.viewY = d.y;
  editor.viewM = d.m;
  renderCalendar();
  renderPicked();
  renderLunarPanel();
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
  const isBirth = editor.kind === 'birthday';
  if (!name) {
    toast(isBirth ? '请填写寿星名字' : '请填写事件名称');
    $('#evName').focus();
    return;
  }
  if (isBirth) {
    saveBirthday(name);
    return;
  }
  const cat1Exists = state.cats.some((c) => c.id === editor.cat1 && !c.parent);
  const cat2Exists = state.cats.some((c) => c.id === editor.cat2 && c.parent === editor.cat1);
  const payload = {
    id: editor.id || uid('e_'),
    name: name.slice(0, 24),
    date: editor.date,
    time: isClockTime($('#evTime').value) ? $('#evTime').value : '',
    lunar: editor.calendar === 'lunar' && editor.lunar ? { ...editor.lunar } : null,
    cat1: cat1Exists ? editor.cat1 : null,
    cat2: cat2Exists ? editor.cat2 : null,
    repeatYearly: !!editor.repeat,
    note: $('#evNote').value.trim().slice(0, 140),
    reminds: normalizeReminds(editor.reminds),
    createdAt: Date.now()
  };
  const isEdit = !!editor.id;
  const existing = isEdit ? state.events.find((e) => e.id === payload.id) : null;
  const list = listForEvent(payload, payload.id);
  const ordered = list.map((e) => e.order).filter((n) => n != null);
  if (ordered.length) {
    const sameList = existing && existing.cat1 === payload.cat1 && existing.cat2 === payload.cat2;
    payload.order = sameList && existing.order != null ? existing.order : Math.max(...ordered) + 1;
  } else {
    payload.order = null;
  }
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

function saveBirthday(name) {
  const isEdit = !!editor.id;
  const payload = {
    id: editor.id || uid('b_'),
    name: name.replace(/的生日$/, '').slice(0, 20),
    date: editor.date,
    lunar: editor.calendar === 'lunar' && editor.lunar ? { ...editor.lunar } : null,
    reminds: normalizeReminds(editor.reminds),
    createdAt: Date.now()
  };
  const idx = state.birthdays.findIndex((b) => b.id === payload.id);
  if (idx > -1) {
    payload.createdAt = state.birthdays[idx].createdAt;
    state.birthdays[idx] = normalizeBirthday(payload);
  } else {
    state.birthdays.push(normalizeBirthday(payload));
  }
  persist();
  closeEditor();
  renderAll();
  switchView('birth');
  toast(isEdit ? '生日已保存' : '生日已添加');
}

async function deleteBirthday(id) {
  const b = state.birthdays.find((x) => x.id === id);
  if (!b) return;
  const ok = await askConfirm({
    title: '删除这个生日？',
    text: `「${birthTitle(b)}」将被永久删除，无法恢复。`,
    okText: '删除'
  });
  if (!ok) return;
  state.birthdays = state.birthdays.filter((x) => x.id !== id);
  persist();
  closeEditor();
  renderAll();
  toast('已删除');
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
  renderBirth();
  renderTodo();
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

function moveEventOrder(id, dir) {
  const ev = state.events.find((e) => e.id === id);
  if (!ev) return;
  const list = listForEvent(ev);
  const index = list.findIndex((e) => e.id === id);
  const next = index + dir;
  if (index < 0 || next < 0 || next >= list.length) return;
  [list[index], list[next]] = [list[next], list[index]];
  list.forEach((item, i) => {
    item.order = i;
  });
  persist();
  renderHome();
}

function moveCatOrder(id, dir) {
  const cat = state.cats.find((c) => c.id === id);
  if (!cat) return;
  const groups = buildGroups();
  let siblings;
  if (cat.parent) {
    const group = groups.find((g) => g.cat && g.cat.id === cat.parent);
    siblings = group ? group.subs.map((sub) => sub.cat) : [];
  } else {
    siblings = groups.filter((g) => g.cat).map((g) => g.cat);
  }
  const index = siblings.findIndex((c) => c.id === id);
  const next = index + dir;
  if (index < 0 || next < 0 || next >= siblings.length) return;
  const other = siblings[next];
  const a = state.cats.indexOf(cat);
  const b = state.cats.indexOf(other);
  state.cats[a] = other;
  state.cats[b] = cat;
  persist();
  renderCats();
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
    case 'new-birthday':
      openBirthdayEditor(null);
      break;
    case 'open-birthday':
      openBirthdayEditor(state.birthdays.find((b) => b.id === el.dataset.id) || null);
      break;
    case 'delete-birthday':
      if (editor && editor.id) deleteBirthday(editor.id);
      break;
    case 'toggle-todo':
      toggleTodo(el.dataset.id);
      break;
    case 'delete-todo':
      deleteTodo(el.dataset.id);
      break;
    case 'clear-done':
      clearDoneTodos();
      break;
    case 'open-remind':
      openRemindSheet();
      break;
    case 'remind-close':
      closeRemindSheet();
      break;
    case 'request-notif':
      requestNotificationPermission();
      break;
    case 'toggle-notify':
      setNotifyEnabled(!notify.enabled);
      break;
    case 'pick-notify-lead':
      setNotifyDefaultLead(Number(el.dataset.lead));
      break;
    case 'exact-perm':
      openExactAlarmSettings();
      break;
    case 'test-notif':
      sendTestNotification();
      break;
    case 'pick-remind': {
      if (!editor) break;
      const raw = el.dataset.lead;
      if (raw === '') {
        editor.reminds = [];
      } else {
        const lead = Number(raw);
        const idx = editor.reminds.findIndex((r) => r.lead === lead);
        if (idx > -1) {
          editor.reminds.splice(idx, 1);
        } else {
          const last = editor.reminds[editor.reminds.length - 1];
          editor.reminds.push({ lead, time: last ? last.time : notify.defaultTime });
          if (notifPerm !== 'granted') requestNotificationPermission();
        }
        editor.reminds = normalizeReminds(editor.reminds);
      }
      renderRemindChips();
      break;
    }
    case 'toggle-folder':
    case 'toggle-sub':
      toggleFolder(el, el.dataset.key);
      break;
    case 'toggle-all':
      toggleAll();
      break;
    case 'sort-start':
      sorting = true;
      renderHome();
      break;
    case 'sort-done':
      sorting = false;
      renderHome();
      break;
    case 'move-cat':
      moveCatOrder(el.dataset.id, Number(el.dataset.dir));
      break;
    case 'move-event':
      moveEventOrder(el.dataset.id, Number(el.dataset.dir));
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
    case 'clear-time':
      if (!editor) break;
      editor.time = '';
      $('#evTime').value = '';
      $('#timeClear').hidden = true;
      break;
    case 'toggle-repeat':
      editor.repeat = !editor.repeat;
      renderRepeat();
      renderPicked();
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
    case 'pick-calendar':
      setCalendarMode(el.dataset.cal);
      break;
    case 'pick-lunar-month':
      if (!editor || !editor.lunar) break;
      editor.lunar = { ...editor.lunar, m: Number(el.dataset.m) };
      syncLunarDate();
      break;
    case 'pick-lunar-day':
      if (!editor || !editor.lunar) break;
      editor.lunar = { ...editor.lunar, d: Number(el.dataset.d) };
      syncLunarDate();
      break;
    case 'toggle-lunar-leap':
      if (!editor || !editor.lunar) break;
      editor.lunar = { ...editor.lunar, leap: !editor.lunar.leap };
      syncLunarDate();
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
    else if (layer.id === 'remindLayer') closeRemindSheet();
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

$('#evName').addEventListener('input', () => {
  renderBirthPreview();
});

$('#catName').addEventListener('input', () => {
  if (catDraft) catDraft.name = $('#catName').value;
});

$('#fabNew').addEventListener('click', () => {
  if (view === 'birth') openBirthdayEditor(null);
  else if (view === 'todo') {
    switchView('todo');
    $('#todoInput').focus();
  } else openEditor(null);
});

$('#todoCompose').addEventListener('submit', (event) => {
  event.preventDefault();
  addTodo();
});

$('#notifyTime').addEventListener('change', () => {
  setNotifyDefaultTime($('#notifyTime').value);
});

$('#evTime').addEventListener('change', () => {
  if (!editor) return;
  const value = $('#evTime').value;
  editor.time = isClockTime(value) ? value : '';
  $('#timeClear').hidden = !editor.time;
});

$('#remindTimes').addEventListener('change', (event) => {
  const input = event.target.closest('input[type="time"]');
  if (!input || !editor) return;
  const item = editor.reminds.find((r) => r.lead === Number(input.dataset.lead));
  if (!item) return;
  const value = input.value;
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) item.time = value;
  else input.value = item.time;
});

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
  else if (el.id === 'remindLayer') closeRemindSheet();
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
  window.Capacitor.Plugins.App.addListener('resume', async () => {
    await checkNotificationPermission();
    if (notify.enabled && notifPerm === 'granted') refreshReminders();
    if (isRemindOpen()) renderRemindSheet(false);
    renderTopbar();
  });
}

/* ---------------------------- 启动 ---------------------------- */

renderAll();
