/* 优日 · 系统通知与提醒排期 */

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
      if (!first) return;
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
      if (!first) return;
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

/* 启动时检查权限并恢复提醒；由 app.js 在所有模块加载完成后调用 */
async function initNotify() {
  await checkNotificationPermission();
  if (notify.enabled && notifPerm === 'granted') {
    await ensureNotificationChannel();
    await refreshReminders();
  }
  renderTopbar();
}

