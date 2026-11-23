/* 优日 · 日子 / 生日编辑器、日历与分类弹层 */

/* ---------------------------- 事件 / 生日编辑器 ---------------------------- */

function openEditor(ev, preset) {
  startEditor(ev, 'event', preset);
}

function openBirthdayEditor(b) {
  startEditor(b, 'birthday');
}

function startEditor(target, kind, preset) {
  const isBirth = kind === 'birthday';
  const date = target ? target.date : todayStr();
  const d = parseYmd(date);
  editor = {
    kind,
    id: target ? target.id : null,
    date,
    name: target ? target.name : '',
    time: !isBirth && target ? target.time || '' : '',
    cat1: !isBirth && target ? target.cat1 : preset && preset.cat1 ? preset.cat1 : '',
    cat2: !isBirth && target ? target.cat2 : preset && preset.cat2 ? preset.cat2 : '',
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
    lunarInvalid: false,
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
  $('#editorHint').textContent = editorHintText();
  $('#saveBtn').textContent = isBirth ? '保存生日' : '保存';
  $('#jumpPanel').hidden = true;
  $('.cal-title').setAttribute('aria-expanded', 'false');
  renderEditor();
  $('#editorScroll').scrollTop = 0;
  openLayer($('#editorLayer'));
}

function closeEditor() {
  clearCalLayers();
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

/* 编辑器底部提示：随日期与模式变化，明确边界行为 */
function editorHintText() {
  if (!editor) return '';
  if (editor.kind === 'birthday') return '生日只需要名字和日子，每年自动倒数。';
  const d = parseYmd(editor.date);
  if (editor.calendar === 'lunar' && (editor.lunarInvalid || !lunarOfDate(editor.date))) {
    return `这一天超出农历可换算范围（${LUNAR_RANGE_TEXT}）。`;
  }
  if (editor.repeat && d.m === 2 && d.d === 29) return '闰年 2 月 29 日，平年按 2 月 28 日倒数。';
  return '未来的日子会倒数，过去的日子会纪念。';
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
  if (!actual) notes.push(`当前日期超出可换算范围（${LUNAR_RANGE_TEXT}）。`);
  if (lunar.leap && !leapOk) notes.push(`今年没有闰${LUNAR_MONTHS[lunar.m - 1]}，按${LUNAR_MONTHS[lunar.m - 1]}计算。`);
  if (actual && lunar.d > maxD) notes.push(`今年这个月是${LUNAR_DAYS[maxD - 1]}，按月末计算。`);
  $('#lunarNote').textContent = notes.join(' ');
}

function calendarCellsHTML(viewY, viewM) {
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
  return { html: cells.join(''), monthMarks };
}

function renderCalendar() {
  if (!editor) return;
  clearCalLayers();
  const { viewY, viewM } = editor;
  $('#calTitle').textContent = `${viewY}年${viewM}月`;
  const { html, monthMarks } = calendarCellsHTML(viewY, viewM);
  $('#calGrid').innerHTML = html;
  const noun = editor.kind === 'birthday' ? '生日' : '日子';
  $('#calEventsHint').textContent = monthMarks ? `本月 ${monthMarks} 个${noun}` : `本月暂无${noun}`;
}

/* 相邻月份（跨年时一起调整年份），超出 1900–2100 返回 null */
function neighborMonth(step) {
  let m = editor.viewM + step;
  let y = editor.viewY;
  if (m < 1) {
    m = 12;
    y -= 1;
  } else if (m > 12) {
    m = 1;
    y += 1;
  }
  if (y < 1900 || y > 2100) return null;
  return { y, m };
}

/* ---------------------------- 翻月动画 ---------------------------- */
/* 两层不透明的月历并排滑动：旧月从一侧滑出，新月从另一侧滑入，
   两层始终首尾相接、互不重叠，因此不会出现两个月份的日期叠在一起 */

const CAL_SLIDE_MS = 280;
let calSlideTimer = 0;
let calAnimating = false;

function clearCalLayers() {
  const grid = $('#calGrid');
  if (grid) {
    grid.classList.remove('cal-anim', 'dragging');
    grid.style.transform = '';
  }
  $$('#calGridWrap .cal-ghost').forEach((layer) => layer.remove());
  clearTimeout(calSlideTimer);
  calAnimating = false;
}

function makeMonthLayer(html) {
  const layer = document.createElement('div');
  layer.className = 'cal-grid cal-ghost';
  layer.setAttribute('aria-hidden', 'true');
  layer.innerHTML = html;
  $('#calGridWrap').appendChild(layer);
  return layer;
}

/* sign > 0：翻到下个月（新月从右侧进入）；sign < 0：上个月（从左侧进入）
   startDx 是松手时当前层已经拖到的位移，动画从这里接着走 */
function slideToMonth(sign, startDx = 0) {
  if (!editor || calAnimating) return;
  const grid = $('#calGrid');
  const nb = neighborMonth(sign);
  if (!grid || !nb) return;
  const width = grid.offsetWidth || $('#calGridWrap').clientWidth;
  if (!width) return;
  const dx = Math.max(-width, Math.min(width, startDx));
  clearCalLayers();
  const layer = makeMonthLayer(calendarCellsHTML(nb.y, nb.m).html);
  grid.style.transform = `translateX(${dx}px)`;
  layer.style.transform = `translateX(${sign * width + dx}px)`;
  void grid.offsetWidth;
  calAnimating = true;
  grid.classList.add('cal-anim');
  layer.classList.add('cal-anim');
  requestAnimationFrame(() => {
    grid.style.transform = `translateX(${-sign * width}px)`;
    layer.style.transform = 'translateX(0)';
  });
  calSlideTimer = setTimeout(() => {
    if (!editor) {
      clearCalLayers();
      return;
    }
    editor.viewY = nb.y;
    editor.viewM = nb.m;
    renderCalendar();
    if (!$('#jumpPanel').hidden) renderJump();
  }, CAL_SLIDE_MS + 30);
}

/* 位移不够时弹回原月份 */
function snapBackMonth(sign, startDx) {
  const grid = $('#calGrid');
  const layer = $('#calGridWrap .cal-ghost');
  if (!grid) return;
  const width = grid.offsetWidth || 0;
  grid.classList.remove('dragging');
  if (layer) layer.classList.remove('dragging');
  grid.classList.add('cal-anim');
  if (layer) layer.classList.add('cal-anim');
  grid.style.transform = 'translateX(0)';
  if (layer) layer.style.transform = `translateX(${sign * width}px)`;
  calAnimating = true;
  calSlideTimer = setTimeout(() => {
    clearCalLayers();
  }, CAL_SLIDE_MS + 30);
}

let calDrag = null;
let calSwipeGuard = 0;

function bindCalendarSwipe() {
  const wrap = $('#calGridWrap');
  const grid = $('#calGrid');
  if (!wrap || !grid) return;
  wrap.addEventListener(
    'click',
    (event) => {
      // 拖动结束后浏览器仍可能补发 click，吞掉它，避免误选日期
      if (!calSwipeGuard || Date.now() - calSwipeGuard > 500) return;
      calSwipeGuard = 0;
      event.stopPropagation();
      event.preventDefault();
    },
    true
  );
  wrap.addEventListener('pointerdown', (event) => {
    // 新的按下说明是用户主动点击，取消上一次拖动留下的点击拦截
    calSwipeGuard = 0;
    if (!editor || !editor.calOpen || calAnimating) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    calDrag = { id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, width: 0, sign: 0, layer: null, active: false, locked: false };
  });
  wrap.addEventListener('pointermove', (event) => {
    if (!calDrag || event.pointerId !== calDrag.id) return;
    const dx = event.clientX - calDrag.x;
    const dy = event.clientY - calDrag.y;
    if (!calDrag.active) {
      if (calDrag.locked || (Math.abs(dx) < 8 && Math.abs(dy) < 8)) return;
      if (Math.abs(dy) >= Math.abs(dx)) {
        calDrag.locked = true;
        return;
      }
      const sign = dx < 0 ? 1 : -1;
      const nb = neighborMonth(sign);
      const width = grid.offsetWidth;
      if (!nb || !width) {
        calDrag.locked = true;
        return;
      }
      calDrag.active = true;
      calDrag.sign = sign;
      calDrag.width = width;
      calDrag.layer = makeMonthLayer(calendarCellsHTML(nb.y, nb.m).html);
      calDrag.layer.style.transform = `translateX(${sign * width}px)`;
      grid.classList.add('dragging');
      calDrag.layer.classList.add('dragging');
      try {
        wrap.setPointerCapture(event.pointerId);
      } catch (err) {
        /* 指针已失效时忽略 */
      }
    }
    const width = calDrag.width;
    const moved = calDrag.sign > 0 ? Math.max(-width, Math.min(0, dx)) : Math.min(width, Math.max(0, dx));
    calDrag.dx = moved;
    grid.style.transform = `translateX(${moved}px)`;
    if (calDrag.layer) calDrag.layer.style.transform = `translateX(${calDrag.sign * width + moved}px)`;
  });
  const finish = (event) => {
    if (!calDrag) return;
    if (event.pointerId !== calDrag.id) return;
    const { dx, sign, active } = calDrag;
    calDrag = null;
    if (!active) return;
    calSwipeGuard = Date.now();
    grid.classList.remove('dragging');
    if (Math.abs(dx) >= 48) {
      slideToMonth(sign, dx);
    } else {
      snapBackMonth(sign, dx);
    }
  };
  wrap.addEventListener('pointerup', finish);
  wrap.addEventListener('pointercancel', () => {
    if (!calDrag) return;
    const { sign, active } = calDrag;
    calDrag = null;
    if (active) snapBackMonth(sign, 0);
  });
  wrap.addEventListener('lostpointercapture', (event) => {
    // 触摸按下时浏览器会把指针隐式捕获到某个日期按钮上，我们改为捕获到 wrap 时
    // 该按钮会先抛 lostpointercapture 并冒泡到这里，那不是拖动结束。
    if (event.target !== wrap) return;
    if (!calDrag) return;
    const { sign, active } = calDrag;
    calDrag = null;
    if (active) snapBackMonth(sign, 0);
  });
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
  const hit = showsNext ? nextLunarOccurrence(lunar) : null;
  const ds = hit ? hit.date : editor.date;
  const lunarText = lunar ? lunarLabelOf(ds) : '';
  const outOfRange = !!lunar && !lunarText;
  const days = diffFromToday(ds);
  let tag;
  if (outOfRange) {
    tag = `超出农历范围（${LUNAR_RANGE_TEXT}）`;
    $('#picked').className = 'picked past';
  } else if (isBirth) {
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
    ? `<span class="picked-date lunar">${outOfRange ? `农历超出 ${LUNAR_RANGE_TEXT}` : `农历${esc(lunarText)}`}<small>公历 ${fullDate(ds)} · 周${WEEK_CN[weekdayOf(ds)]}</small></span>`
    : `<span class="picked-date">${fullDate(ds)}<small>周${WEEK_CN[weekdayOf(ds)]}</small></span>`;
  $('#picked').innerHTML = `${dateHTML}
    <span class="picked-tag">${tag}</span>
    <button class="picked-edit" data-act="toggle-cal" aria-label="${editor.calOpen ? '收起日期选择' : '修改日期'}">${editor.calOpen ? '收起' : '改日期'}</button>`;
  $('#editorHint').textContent = editorHintText();
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
  if (mode === 'lunar' && !lunarOfDate(editor.date)) {
    toast(`这一天超出农历可换算范围（${LUNAR_RANGE_TEXT}）`);
    return;
  }
  editor.calendar = mode;
  if (mode === 'lunar') {
    const l = lunarOfDate(editor.date);
    editor.lunar = { m: l.m, d: l.d, leap: l.leap };
    editor.lunarInvalid = false;
    editor.calOpen = true;
  } else {
    editor.lunar = null;
    editor.lunarInvalid = false;
  }
  renderEditor();
}

/* 选了农历月 / 日 / 闰月后，换算成下一次的公历日期 */
function syncLunarDate() {
  const hit = nextLunarOccurrence(editor.lunar);
  if (!hit) {
    editor.lunarInvalid = true;
    renderLunarPanel();
    $('#lunarNote').textContent = `所选农历已超出可换算范围（${LUNAR_RANGE_TEXT}），不会保存为农历日子。`;
    return;
  }
  editor.lunarInvalid = false;
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
  if (editor.calendar === 'lunar' && (editor.lunarInvalid || !lunarOfDate(editor.date))) {
    toast(`农历日期超出可换算范围（${LUNAR_RANGE_TEXT}）`);
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
  persist({ skipNotify: true });
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
  persist({ skipNotify: true });
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

