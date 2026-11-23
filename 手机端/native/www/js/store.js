/* 优日 · 状态与本地存储（含云端配置、通知配置） */

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
  const lunarDate = (lunar, fallback) => {
    const hit = nextLunarOccurrence(lunar);
    return hit ? hit.date : fallback;
  };
  const add = (name, offset, c1, c2, repeat = false, note = '', remind = null, time = '', lunar = null) => {
    s.events.push({
      id: uid('e_'),
      name,
      date: lunar ? lunarDate(lunar, offsetDate(offset)) : offsetDate(offset),
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
      date: lunar ? lunarDate(lunar, date) : date,
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

/* 保存状态。
   skipCloud：折叠、排序等纯展示状态不必上传快照；
   skipNotify：待办、分类等不影响提醒计划的数据不必重排通知。
   两者互不影响，避免原本「跳过云备份」连提醒重排也一起跳过的隐性问题。 */
function persist(options = {}) {
  if (DEMO) return;
  try {
    state.updatedAt = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    toast('保存失败，存储空间不足');
  }
  if (!options.skipCloud) queueAutoBackup();
  if (!options.skipNotify) queueReminderSync();
}

