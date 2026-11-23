/* 优日 · 视图、弹层与各页面渲染 */

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
  const lunarText = ev.lunar ? lunarLabelOf(when) : '';
  const meta = lunarText
    ? `农历${lunarText} · ${shortDate(when)} · ${path.text}`
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
  const lunarText = ev.lunar ? lunarLabelOf(when) : '';
  if (lunarText) {
    const label = `农历${lunarText}`;
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
    : `<div class="sub-top">
        <button class="sub-head" data-act="toggle-sub" data-key="${key}" aria-expanded="${open}">
          <span class="sub-dash"></span>
          <span class="sub-name">${esc(sub.cat.name)}</span>
          <span class="sub-count">${sub.events.length}</span>
          ${ICONS.chevron}
        </button>
        <button class="head-add small" data-act="new-in-cat" data-cat1="${sub.cat.parent}" data-cat2="${sub.cat.id}" aria-label="在${esc(sub.cat.name)}下新建日子">${ICONS.plus}</button>
      </div>`;
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
    : `<div class="folder-top">
        <button class="folder-head" data-act="toggle-folder" data-key="${group.key}" aria-expanded="${open}">
          <span class="folder-swatch" style="--c:${color}"></span>
          <span class="folder-name">${esc(name)}</span>
          <span class="folder-count">${group.events.length} 个</span>
          ${ICONS.chevron}
        </button>
        ${group.cat ? `<button class="head-add" data-act="new-in-cat" data-cat1="${group.cat.id}" aria-label="在${esc(name)}下新建日子">${ICONS.plus}</button>` : ''}
      </div>`;
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
    <button class="mini-btn add" data-act="new-in-cat" data-cat1="${isSub ? cat.parent : cat.id}" data-cat2="${isSub ? cat.id : ''}" aria-label="在${esc(cat.name)}下新建日子">${ICONS.plus}</button>
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
  if (b.lunar) {
    const hit = nextLunarOccurrence(b.lunar);
    if (!hit) return { next: b.date, days: null, kind: 'unknown' };
    const days = diffFromToday(hit.date);
    return { next: hit.date, days, kind: days === 0 ? 'today' : 'count' };
  }
  const next = nextRepeatDate({ date: b.date, repeatYearly: true });
  const days = diffFromToday(next);
  return { next, days, kind: days === 0 ? 'today' : 'count' };
}

function birthDateText(b, info) {
  if (b.lunar) {
    const label = lunarLabelOf(info.next);
    if (!label) return `农历日期超出 ${LUNAR_RANGE_TEXT}`;
    return `农历${label} · ${shortDate(info.next)}`;
  }
  const { m, d } = parseYmd(b.date);
  const shown = parseYmd(info.next);
  const base = `${m}月${d}日`;
  return m === 2 && d === 29 && shown.m === 2 && shown.d === 28 ? `${base}（平年按 2 月 28 日）` : base;
}

function sortedBirthdays() {
  return state.birthdays
    .map((b) => ({ b, info: birthdayInfo(b) }))
    .sort((x, y) => {
      if (x.info.days == null || y.info.days == null) {
        if (x.info.days == null && y.info.days == null) return x.b.name.localeCompare(y.b.name, 'zh-Hans-CN');
        return x.info.days == null ? 1 : -1;
      }
      return x.info.days - y.info.days || x.b.name.localeCompare(y.b.name, 'zh-Hans-CN');
    });
}

function birthRowHTML(b, info) {
  const days = info.days;
  const count = days == null
    ? '<span class="n word">—</span>'
    : days === 0
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
  const unknown = info.days == null;
  const today = info.days === 0;
  const countHTML = unknown
    ? '<b>—</b><span>范围外</span>'
    : today
      ? '<b>今天</b>'
      : `<b>${info.days}</b><span>天后</span>`;
  return `<div class="birth-hero">
    <span class="birth-hero-mark" aria-hidden="true">生</span>
    <div class="birth-hero-label">下个生日</div>
    <div class="birth-hero-body">
      <div class="birth-hero-info">
        <h2>${esc(birthTitle(b))}</h2>
        <p>${birthDateText(b, info)} · 每年重复</p>
      </div>
      <div class="birth-hero-count${today ? ' today' : ''}">
        ${countHTML}
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
  persist({ skipNotify: true });
  renderTodo();
  renderTopbar();
  input.focus();
}

function toggleTodo(id) {
  const todo = state.todos.find((t) => t.id === id);
  if (!todo) return;
  todo.done = !todo.done;
  todo.doneAt = todo.done ? Date.now() : 0;
  persist({ skipNotify: true });
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
  persist({ skipNotify: true });
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
  persist({ skipNotify: true });
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
  const shownYmd = parseYmd(shown);
  const lunarText = ev.lunar ? lunarLabelOf(shown) : '';
  if (lunarText) rows.push(`<div class="d-row"><span>农历</span><b>${esc(lunarText)}</b></div>`);
  else if (ev.lunar) rows.push(`<div class="d-row"><span>农历</span><b>超出可换算范围（${LUNAR_RANGE_TEXT}），暂按公历显示</b></div>`);
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
    if (!ev.lunar && orig.m === 2 && orig.d === 29 && shownYmd.m !== 2) {
      rows.push('<div class="d-row"><span>说明</span><b>平年没有 2 月 29 日，按 2 月 28 日计算</b></div>');
    }
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

