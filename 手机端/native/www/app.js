/* 优日 · 交互入口与启动 */

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
  persist({ skipCloud: true, skipNotify: true });
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
  persist({ skipCloud: true, skipNotify: true });
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
  persist({ skipNotify: true });
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
  persist({ skipNotify: true });
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
    case 'new-in-cat':
      openEditor(null, { cat1: el.dataset.cat1 || '', cat2: el.dataset.cat2 || '' });
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
    case 'cal-next':
      slideToMonth(act === 'cal-prev' ? -1 : 1);
      break;
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

bindCalendarSwipe();
renderAll();
initNotify();
