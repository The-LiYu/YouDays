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

/* 按月份天数取最接近的日期：2 月 29 日在平年会落到 2 月 28 日 */
function safeDate(y, m, d) {
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return ymd(y, m, Math.min(d, daysInMonth));
}

function isLeapYear(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
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

/* 日子这次显示 / 倒数的那一天：农历按当前年份换算成公历。
   农历换算只覆盖 1901–2100；超出范围时退回记录本身的公历日期，避免算出错误的倒数。 */
function eventWhen(ev) {
  if (ev.lunar && ev.repeatYearly) {
    const next = nextLunarOccurrence(ev.lunar);
    return next ? next.date : ev.date;
  }
  if (ev.repeatYearly) return nextRepeatDate(ev);
  return ev.date;
}

function infoOf(ev) {
  const diff = diffFromToday(ev.date);
  if (ev.repeatYearly) {
    const next = eventWhen(ev);
    const days = diffFromToday(next);
    return { kind: days === 0 ? 'today' : days > 0 ? 'count' : 'past', days: Math.abs(days), next, diff };
  }
  if (diff === 0) return { kind: 'today', days: 0 };
  if (diff > 0) return { kind: 'count', days: diff };
  return { kind: 'past', days: -diff };
}

function sortValue(ev) {
  const when = ev.repeatYearly ? eventWhen(ev) : ev.date;
  const diff = diffFromToday(when);
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
/* 农历数据的最后一个年份（1901 + 200 年） */
const LUNAR_END = LUNAR_START + LUNAR_INFO.length - 1;
const LUNAR_RANGE_TEXT = `${LUNAR_START}–${LUNAR_END} 年`;
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

/* 从今天起的下一次农历月日；闰月缺失的年份按普通月计算。
   超出 1901–2100 时返回 null，由调用方提示或退回公历日期。 */
function nextLunarOccurrence(lunar) {
  const ty = parseYmd(todayStr()).y;
  const today = dayIndex(todayStr());
  for (let ly = ty - 1; ly <= ty + 2 && ly <= LUNAR_END; ly += 1) {
    const hit = lunarInYear(lunar, ly);
    if (hit && dayIndex(hit.date) >= today) return hit;
  }
  return null;
}

function normalizeLunar(value) {
  if (!value || typeof value !== 'object') return null;
  const m = Number(value.m);
  const d = Number(value.d);
  if (!Number.isInteger(m) || m < 1 || m > 12) return null;
  if (!Number.isInteger(d) || d < 1 || d > 30) return null;
  return { m, d, leap: !!value.leap };
}

