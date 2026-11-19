import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WWW = path.join(ROOT, '手机端', 'native', 'www');
const OUT = path.join(ROOT, '预览');
const EDGE = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 47831;
const DEBUG_PORT = 9333;
const WIDTH = 390;
const HEIGHT = 844;
const DSF = 2;

fs.mkdirSync(OUT, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json'
};

const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent((req.url || '/').split('?')[0]);
  const target = path.join(WWW, pathname === '/' ? 'index.html' : pathname);
  if (!target.startsWith(path.resolve(WWW))) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }
  fs.readFile(target, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(target)] || 'application/octet-stream' });
    res.end(data);
  });
});
await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));

const edgeArgs = [
  '--headless=new',
  `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${path.join(process.env.TEMP, `youri-edge-profile-${process.pid}`)}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  '--hide-scrollbars',
  '--disable-features=Translate',
  'about:blank'
];
const edge = spawn(EDGE, edgeArgs, { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWs() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?about:blank`, { method: 'PUT' });
      if (res.ok) {
        const data = await res.json();
        return data.webSocketDebuggerUrl;
      }
    } catch (err) {
      /* not ready */
    }
    await sleep(200);
  }
  throw new Error('Edge debug endpoint not ready');
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    this.handlers = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method && this.handlers.has(msg.method)) {
        this.handlers.get(msg.method).forEach((fn) => fn(msg.params));
      }
    });
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = (this.nextId += 1);
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
  }
}

const wsUrl = await getWs();
const ws = new WebSocket(wsUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});
const cdp = new CDP(ws);

const errors = [];
cdp.on('Runtime.exceptionThrown', (p) => errors.push(p.exceptionDetails.text + ' ' + (p.exceptionDetails.exception?.description || '')));
cdp.on('Log.entryAdded', (p) => {
  if (p.entry.level === 'error') errors.push(p.entry.text);
});

const loaded = new Promise((resolve) => cdp.on('Page.loadEventFired', resolve));

await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Log.enable');
await cdp.send('Emulation.setDeviceMetricsOverride', {
  width: WIDTH,
  height: HEIGHT,
  deviceScaleFactor: DSF,
  mobile: true,
  screenWidth: WIDTH,
  screenHeight: HEIGHT
});
await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

// 本地通知的模拟实现：浏览器里没有系统通知，用它验证调度逻辑与界面状态
await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => {
    const pending = [];
    const plugin = {
      checkPermissions: async () => ({ display: 'granted' }),
      requestPermissions: async () => ({ display: 'granted' }),
      checkExactNotificationSetting: async () => ({ exact_alarm: 'granted' }),
      changeExactNotificationSetting: async () => ({ exact_alarm: 'granted' }),
      createChannel: async () => {},
      getPending: async () => ({ notifications: pending.slice() }),
      cancel: async ({ notifications }) => {
        (notifications || []).forEach((n) => {
          const i = pending.findIndex((p) => p.id === n.id);
          if (i > -1) pending.splice(i, 1);
        });
      },
      schedule: async ({ notifications }) => {
        (notifications || []).forEach((n) => pending.push(n));
        return { notifications: [] };
      },
      __pending: pending
    };
    window.Capacitor = { Plugins: { LocalNotifications: plugin } };
  })();`
});

await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?demo=1` });
await loaded;
await sleep(1000);

async function evaluate(expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  }
  return result.result.value;
}

async function shot(name) {
  const result = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false
  });
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(result.data, 'base64'));
  console.log('shot', name);
}

async function reloadAndWait() {
  const done = new Promise((resolve) => cdp.on('Page.loadEventFired', resolve));
  await cdp.send('Page.reload');
  await done;
  await sleep(700);
}

const getState = async () => evaluate("JSON.parse(localStorage.getItem('youri.state.v1') || 'null')");

const results = {};
results.folders = await evaluate("document.querySelectorAll('.folder').length");
results.events = await evaluate("document.querySelectorAll('.event').length");
results.hero = await evaluate("document.querySelector('.hero-name')?.textContent");
const rectScript = `(sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right), w: Math.round(b.width), h: Math.round(b.height) }; }`;
results.topbarLayout = await evaluate(`(() => {
  const rect = ${rectScript};
  return {
    brand: rect('.brand'),
    actions: rect('.top-actions'),
    overflowX: document.documentElement.scrollWidth - innerWidth,
    pills: document.querySelectorAll('.top-actions .round-btn, .top-actions .stat-pill').length
  };
})()`);
await shot('01-home');

// 首页分类标题旁的「+」新建事件
results.headAddCount = await evaluate("document.querySelectorAll('.head-add').length");
results.subHeadAddCount = await evaluate("document.querySelectorAll('.head-add.small').length");
results.headAddLayout = await evaluate(`(() => {
  const rect = ${rectScript};
  const btn = document.querySelector('.folder-top .head-add');
  const head = document.querySelector('.folder-top .folder-head');
  const add = rect('.folder-top .head-add');
  return {
    inViewport: add.right <= innerWidth,
    afterHead: add.left >= head.getBoundingClientRect().right - 1,
    overflowX: document.documentElement.scrollWidth - innerWidth
  };
})()`);
await evaluate("document.querySelector('.folder-top .head-add').click()");
await sleep(450);
results.presetCat1 = await evaluate(`(() => {
  const active = document.querySelector('#chip1 .chip.on');
  const cat = state.cats.find((c) => c.id === editor.cat1);
  return { open: !!document.querySelector('#editorLayer.open'), active: active ? active.textContent.trim() : null, name: cat ? cat.name : null };
})()`);
await evaluate("document.querySelector('[data-act=\"editor-close\"]').click()");
await sleep(350);
await evaluate("document.querySelector('.head-add.small').click()");
await sleep(450);
await evaluate("document.querySelector('#fieldCat1').scrollIntoView({ block: 'center' })");
await sleep(350);
results.presetCat2 = await evaluate(`(() => {
  const active = document.querySelector('#chip2 .chip.on');
  const cat = state.cats.find((c) => c.id === editor.cat2);
  return { active: active ? active.textContent.trim() : null, name: cat ? cat.name : null, parent: cat ? cat.parent : null };
})()`);
await shot('01b-head-add-editor');
await evaluate("document.querySelector('[data-act=\"editor-close\"]').click()");
await sleep(350);

// 首页排序模式
await evaluate("document.querySelector('[data-act=\"sort-start\"]').click()");
await sleep(450);
results.sortFolders = await evaluate("document.querySelectorAll('.folder-head.sorting').length");
results.sortEvents = await evaluate("document.querySelectorAll('.event.sorting').length");
results.sortButtons = await evaluate("document.querySelectorAll('.sort-btn').length");
await shot('10-sort');
await evaluate(`(() => {
  const heads = [...document.querySelectorAll('.folder-head.sorting')];
  heads[1].querySelector('[data-act="move-cat"][data-dir="-1"]').click();
})()`);
await sleep(400);
results.sortFirstFolder = await evaluate("document.querySelector('.folder-name')?.textContent");
await evaluate("document.querySelector('[data-act=\"sort-done\"]').click()");
await sleep(300);
results.sortExited = await evaluate("!document.querySelector('.folder-head.sorting') && !!document.querySelector('.hero')");
await reloadAndWait();

// 同步设置（未连接）
await evaluate("document.querySelector('[data-act=\"open-sync\"]').click()");
await sleep(500);
await shot('08-sync');
await evaluate("document.querySelector('[data-act=\"sync-close\"]').click()");
await sleep(350);

// 详情
await evaluate("document.querySelector('.event').click()");
await sleep(500);
results.detailOpen = await evaluate("!!document.querySelector('#detailLayer.open')");
results.detailRows = await evaluate("document.querySelectorAll('.d-row').length");
results.detailMetrics = await evaluate(`(() => {
  const rect = (el) => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) }; };
  const body = document.querySelector('.detail-body');
  return {
    inner: innerHeight,
    sheet: rect(document.querySelector('.detail-sheet')),
    body: rect(body),
    bodyScroll: body.scrollHeight,
    bodyClient: body.clientHeight,
    foot: rect(document.querySelector('.detail-foot')),
    visual: visualViewport ? { height: Math.round(visualViewport.height), top: Math.round(visualViewport.offsetTop) } : null
  };
})()`);
await shot('02-detail');
await evaluate("document.querySelector('[data-act=\"detail-close\"]').click()");
await sleep(400);

// 新建（日历）
await evaluate("document.querySelector('#fabNew').click()");
await sleep(500);
results.calendarCells = await evaluate("document.querySelectorAll('.cal-cell').length");
results.pickedTag = await evaluate("document.querySelector('.picked-tag')?.textContent");
await shot('03-editor');

// 日历左右滑动 / 箭头切换月份（用真实触摸事件，验证 WebView 里的指针捕获行为）
const calRect = await evaluate(`(() => {
  const b = document.querySelector('#calGridWrap').getBoundingClientRect();
  return { left: Math.round(b.left), top: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) };
})()`);
const calY = calRect.top + Math.min(calRect.h / 2, 120);
async function touchDrag(x0, y0, x1, y1, onMid) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0, id: 1, radiusX: 2, radiusY: 2, force: 1 }] });
  for (let i = 1; i <= 8; i += 1) {
    const x = x0 + ((x1 - x0) * i) / 8;
    const y = y0 + ((y1 - y0) * i) / 8;
    await sleep(20);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1, radiusX: 2, radiusY: 2, force: 1 }] });
    if (i === 4 && onMid) await onMid();
  }
  await sleep(30);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(420);
}
const calTitle = () => evaluate("document.querySelector('#calTitle').textContent");
const calSwipeFrom = calRect.left + calRect.w - 40;
const calSwipeTo = calRect.left + 40;
results.calTitleStart = await calTitle();
await touchDrag(calSwipeFrom, calY, calSwipeTo, calY, async () => {
  results.calDragFollow = await evaluate(`(() => {
    const grid = document.querySelector('#calGrid');
    const ghost = document.querySelector('.cal-ghost');
    const g = grid.getBoundingClientRect();
    const h = ghost ? ghost.getBoundingClientRect() : null;
    return {
      transform: grid.style.transform,
      dragging: grid.classList.contains('dragging'),
      ghost: !!ghost,
      adjacent: !!h && Math.abs(Math.round(h.left) - Math.round(g.right)) <= 1,
      overlap: !!h && h.left < g.right - 1,
      ghostText: ghost ? ghost.textContent.slice(0, 12) : null,
      currentText: grid.textContent.slice(0, 12)
    };
  })()`);
});
results.calTitleAfterSwipeLeft = await calTitle();
results.calDateAfterSwipe = await evaluate("editor.date === todayStr()");
await touchDrag(calSwipeTo, calY, calSwipeFrom, calY);
results.calTitleAfterSwipeRight = await calTitle();
// 拖动不足阈值：弹回原月份，不翻页
const shortDragTitle = await calTitle();
await touchDrag(calSwipeFrom, calY, calSwipeFrom - 30, calY);
results.calShortDragTitle = await calTitle();
results.calShortDragSame = results.calShortDragTitle === shortDragTitle;
results.calShortDragGhostLeft = await evaluate("document.querySelectorAll('.cal-ghost').length");
await evaluate("document.querySelector('[data-act=\"cal-next\"]').click()");
results.calGhostDuringAnim = await evaluate("document.querySelectorAll('.cal-ghost').length");
await sleep(450);
results.calTitleAfterNext = await calTitle();
results.calCellsAfterShift = await evaluate("document.querySelectorAll('#calGrid .cal-cell').length");
results.calGhostAfterAnim = await evaluate("document.querySelectorAll('.cal-ghost').length");
await shot('18-cal-swipe');
await evaluate("document.querySelector('[data-act=\"cal-prev\"]').click()");
await sleep(450);
results.calTitleBack = await calTitle();

// 竖向滑动不翻月，横向滑动后轻点仍能选日期
await touchDrag(calRect.left + calRect.w / 2, calY, calRect.left + calRect.w / 2, calY + 110);
results.calVerticalSwipeTitle = await calTitle();
results.calVerticalSwipePicked = await evaluate("editor.date === todayStr()");
await evaluate(`(() => {
  const cells = [...document.querySelectorAll('.cal-cell:not(.out)')];
  const today = new Date().getDate();
  const target = cells.find((c) => Number(c.textContent) > today) || cells[cells.length - 1];
  target.click();
})()`);
await sleep(300);
results.calTapAfterSwipe = await evaluate("editor.date !== todayStr()");
await evaluate("pickDate(todayStr())");

// 选日期 + 填名称 + 分类 + 每年
await evaluate(`(() => {
  const cells = [...document.querySelectorAll('.cal-cell:not(.out)')];
  const today = new Date().getDate();
  const target = cells.find((c) => Number(c.textContent) > today) || cells[cells.length - 1];
  target.click();
})()`);
await sleep(400);
await evaluate(`(() => {
  const input = document.querySelector('#evName');
  input.value = '一起看日落';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.blur();
  const chips = [...document.querySelectorAll('#chip1 .chip')];
  const life = chips.find(c => c.textContent.includes('生活'));
  life?.click();
})()`);
await sleep(200);
await evaluate(`(() => {
  const chip = [...document.querySelectorAll('#chip2 .chip')].find(c => c.textContent.includes('旅行'));
  chip?.click();
  document.querySelector('[data-act="toggle-repeat"]').click();
  const clock = document.querySelector('#evTime');
  clock.value = '18:00';
  clock.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await sleep(400);
await shot('04-editor-filled');
results.pickedTag2 = await evaluate("document.querySelector('.picked-tag')?.textContent");
results.chipOn = await evaluate("document.querySelectorAll('.chip.on').length");
results.timeClearVisible = await evaluate("!document.querySelector('#timeClear').hidden");
await evaluate("document.querySelector('[data-act=\"editor-close\"]').click()");
await sleep(350);

// 分类页
await evaluate("document.querySelector('.tab[data-view=\"cats\"]').click()");
await sleep(500);
results.catCards = await evaluate("document.querySelectorAll('.cat-card').length");
results.catRows = await evaluate("document.querySelectorAll('.cat-row').length");
results.catAddCount = await evaluate("document.querySelectorAll('.cat-row .mini-btn.add').length");
results.catAddLayout = await evaluate(`(() => {
  const row = document.querySelector('.cat-row');
  const add = row.querySelector('.mini-btn.add');
  const del = row.querySelector('.mini-btn.del');
  const a = add.getBoundingClientRect();
  const d = del.getBoundingClientRect();
  return { visible: a.width > 0 && a.height > 0, beforeDelete: a.left < d.left, overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth };
})()`);
await shot('05-cats');
await evaluate("document.querySelector('.cat-row .mini-btn.add').click()");
await sleep(450);
results.catAddPreset = await evaluate(`(() => {
  const active = document.querySelector('#chip1 .chip.on');
  return { open: !!document.querySelector('#editorLayer.open'), active: active ? active.textContent.trim() : null };
})()`);
await evaluate("document.querySelector('[data-act=\"editor-close\"]').click()");
await sleep(350);
await evaluate("document.querySelector('.cat-row.sub .mini-btn.add').click()");
await sleep(450);
await evaluate("document.querySelector('#fieldCat1').scrollIntoView({ block: 'center' })");
await sleep(350);
results.catSubAddPreset = await evaluate(`(() => {
  const c1 = document.querySelector('#chip1 .chip.on');
  const c2 = document.querySelector('#chip2 .chip.on');
  const cat = state.cats.find((c) => c.id === editor.cat2);
  return {
    cat1: c1 ? c1.textContent.trim() : null,
    cat2: c2 ? c2.textContent.trim() : null,
    parentMatched: !!cat && cat.parent === editor.cat1
  };
})()`);
await shot('05b-cat-add-editor');
await evaluate("document.querySelector('[data-act=\"editor-close\"]').click()");
await sleep(350);

// 生日页
await evaluate("document.querySelector('.tab[data-view=\"birth\"]').click()");
await sleep(500);
results.birthRows = await evaluate("document.querySelectorAll('.birth-row').length");
results.birthHero = await evaluate("document.querySelector('.birth-hero-info h2')?.textContent");
results.birthDays = await evaluate("[...document.querySelectorAll('.birth-days .n')].map((n) => n.textContent.trim())");
results.birthDaysSorted = results.birthDays.every((v, i, arr) => i === 0 || Number(arr[i - 1]) <= Number(v));
await shot('11-birthday');

// 新建生日：只填名字，每年重复锁定
await evaluate("document.querySelector('[data-act=\"new-birthday\"]').click()");
await sleep(500);
results.birthRepeatLocked = await evaluate("!document.querySelector('#birthRepeat').hidden && document.querySelector('#repeatRow').hidden");
results.birthCatHidden = await evaluate("document.querySelector('#fieldCat1').hidden");
await evaluate(`(() => {
  const input = document.querySelector('#evName');
  input.value = '外婆';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.blur();
})()`);
await sleep(250);
results.birthPreview = await evaluate("document.querySelector('#birthPreview')?.textContent");
await shot('13-birthday-editor');
await evaluate("document.querySelector('#saveBtn').click()");
await sleep(600);
results.birthAfterAdd = await evaluate("document.querySelectorAll('.birth-row').length");
results.birthViewAfterAdd = await evaluate("!document.querySelector('#viewBirth').hidden");
results.birthTitleAdded = await evaluate("[...document.querySelectorAll('.birth-main b')].some((e) => e.textContent === '外婆的生日')");

// 待办页
await evaluate("document.querySelector('.tab[data-view=\"todo\"]').click()");
await sleep(450);
results.todoRows = await evaluate("document.querySelectorAll('.todo-row').length");
await evaluate(`(() => {
  const input = document.querySelector('#todoInput');
  input.value = '给外婆打电话';
  document.querySelector('.compose-add').click();
})()`);
await sleep(450);
results.todoAfterAdd = await evaluate("[...document.querySelectorAll('.todo-row .todo-text')].some((e) => e.textContent.includes('给外婆打电话'))");
await evaluate("document.querySelector('.todo-text').click()");
await sleep(450);
results.todoDone = await evaluate("document.querySelectorAll('.done-card .todo-row').length");
results.todoOpen = await evaluate("document.querySelectorAll('.todo-card:not(.done-card) .todo-row').length");
await sleep(1600);
await shot('12-todo');

// 提醒设置
await evaluate("document.querySelector('.tab[data-view=\"home\"]').click()");
await sleep(350);
await evaluate("document.querySelector('[data-act=\"open-remind\"]').click()");
await sleep(500);
results.remindSheetOpen = await evaluate("!!document.querySelector('#remindLayer.open')");
results.remindStatusTitle = await evaluate("document.querySelector('#notifStatusTitle').textContent");
results.remindPermBtnHidden = await evaluate("document.querySelector('#notifPermBtn').hidden");
await evaluate("document.querySelector('[data-act=\"toggle-notify\"]').click()");
await sleep(900);
results.remindEnabled = await evaluate("document.querySelector('#notifyRow').getAttribute('aria-checked')");
results.remindScheduled = await evaluate("window.Capacitor.Plugins.LocalNotifications.__pending.length");
results.remindStatusAfter = await evaluate("document.querySelector('#notifStatusTitle').textContent");
results.remindSample = await evaluate("window.Capacitor.Plugins.LocalNotifications.__pending.map((p) => p.body).slice(0, 4)");
results.remindLayout = await evaluate(`(() => {
  const rect = ${rectScript};
  const sheet = document.querySelector('#remindLayer .sheet');
  return {
    sheet: rect('#remindLayer .sheet'),
    scroll: { client: sheet.querySelector('.sheet-scroll').clientHeight, scroll: sheet.querySelector('.sheet-scroll').scrollHeight },
    toggle: rect('#notifyRow'),
    time: rect('#notifyTime'),
    leads: rect('#notifyLeads'),
    test: rect('#testNotifBtn'),
    overflowX: document.documentElement.scrollWidth - innerWidth
  };
})()`);
await shot('14-remind');
await evaluate("document.querySelector('[data-act=\"remind-close\"]').click()");
await sleep(400);

// 编辑器里的提醒
await evaluate("document.querySelector('#fabNew').click()");
await sleep(450);
results.remindChips = await evaluate("document.querySelectorAll('#remindChips .chip').length");
await evaluate("(() => { const chip = [...document.querySelectorAll('#remindChips .chip')].find((c) => c.textContent.trim() === '不提醒'); chip.click(); })()");
await evaluate("(() => { const chip = [...document.querySelectorAll('#remindChips .chip')].find((c) => c.textContent.trim() === '提前 1 天'); chip.click(); })()");
await evaluate("(() => { const chip = [...document.querySelectorAll('#remindChips .chip')].find((c) => c.textContent.trim() === '提前 3 天'); chip.click(); })()");
await sleep(300);
results.remindTimeVisible = await evaluate("!document.querySelector('#remindTimes').hidden");
results.remindRowCount = await evaluate("document.querySelectorAll('#remindTimes .remind-time').length");
results.remindDefaultTime = await evaluate("document.querySelector('#remindTimes input[data-lead=\"1\"]').value");
await evaluate(`(() => {
  const input = document.querySelector('#remindTimes input[data-lead="3"]');
  input.value = '20:00';
  input.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await evaluate("document.querySelector('#remindField').scrollIntoView({ block: 'center' })");
await sleep(500);
results.remindEditorLayout = await evaluate(`(() => {
  const rect = ${rectScript};
  return {
    chips: document.querySelectorAll('#remindChips .chip').length,
    rows: document.querySelectorAll('#remindTimes .remind-time').length,
    row: rect('#remindTimes .remind-time'),
    input: rect('#remindTimes input[data-lead="1"]'),
    label: rect('#remindTimes .remind-time > span'),
    overflowX: document.documentElement.scrollWidth - innerWidth
  };
})()`);
await shot('15-editor-remind');
await evaluate("document.querySelector('[data-act=\"editor-close\"]').click()");
await sleep(350);

await evaluate("document.querySelector('.tab[data-view=\"cats\"]').click()");
await sleep(400);

if (process.argv.includes('--quick')) {
  results.errors = errors;
  console.log(JSON.stringify(results, null, 2));
  ws.close();
  edge.kill();
  server.close();
  process.exit(0);
}

// 新增分类交互测试
await evaluate("document.querySelector('[data-act=\"add-cat2\"]').click()");
await sleep(450);
await evaluate(`(() => {
  const input = document.querySelector('#catName');
  input.value = '小确幸';
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await shot('06-cat-modal');
await evaluate("document.querySelector('[data-act=\"cat-save\"]').click()");
await sleep(450);
results.catRowsAfterAdd = await evaluate("document.querySelectorAll('.cat-row').length");

// 删除该分类
await evaluate(`(() => {
  const rows = [...document.querySelectorAll('.cat-row.sub')];
  const row = rows.find(r => r.textContent.includes('小确幸'));
  row.querySelector('[data-act="delete-cat"]').click();
})()`);
await sleep(450);
results.confirmVisible = await evaluate("!!document.querySelector('#confirmLayer.open')");
await evaluate("document.querySelector('[data-act=\"confirm-ok\"]').click()");
await sleep(500);
results.catRowsAfterDelete = await evaluate("document.querySelectorAll('.cat-row').length");

// 新建事件的完整流程测试
await evaluate("document.querySelector('#fabNew').click()");
await sleep(450);
await evaluate(`(() => {
  const input = document.querySelector('#evName');
  input.value = '测试日子';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  const cell = [...document.querySelectorAll('.cal-cell:not(.out)')][2];
  cell.click();
  document.querySelector('#saveBtn').click();
})()`);
await sleep(600);
results.eventsAfterAdd = await evaluate("document.querySelectorAll('.event').length");
results.viewAfterAdd = await evaluate("!document.querySelector('#viewHome').hidden");

// 删除刚添加的事件
await evaluate(`(() => {
  const rows = [...document.querySelectorAll('.event')];
  const row = rows.find(r => r.textContent.includes('测试日子'));
  row.click();
})()`);
await sleep(450);
await evaluate("document.querySelector('[data-act=\"delete-event\"]').click()");
await sleep(450);
await evaluate("document.querySelector('[data-act=\"confirm-ok\"]').click()");
await sleep(500);
results.eventsAfterDelete = await evaluate("document.querySelectorAll('.event').length");

// 首次使用（无演示数据）空状态
await evaluate("localStorage.clear()");
const loadedEmpty = new Promise((resolve) => cdp.on('Page.loadEventFired', resolve));
await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
await loadedEmpty;
await sleep(900);
results.emptyState = await evaluate("!!document.querySelector('.empty')");
await shot('07-empty');

// 生日 / 待办的空状态
await evaluate("document.querySelector('.tab[data-view=\"birth\"]').click()");
await sleep(400);
results.birthEmpty = await evaluate("!!document.querySelector('#viewBirth .empty')");
await evaluate("document.querySelector('.tab[data-view=\"todo\"]').click()");
await sleep(400);
results.todoEmpty = await evaluate("!!document.querySelector('.todo-card.is-empty') && !document.querySelector('.done-card')");
await evaluate("document.querySelector('.tab[data-view=\"home\"]').click()");
await sleep(300);

/* ------------------------- 数据与交互回归测试 ------------------------- */
await evaluate("localStorage.clear()");
await reloadAndWait();
results.emptyAfterClear = await evaluate("!!document.querySelector('.empty')");

// 新增一个日子
await evaluate("document.querySelector('[data-act=\"new\"]').click()");
await sleep(450);
await evaluate(`(() => {
  const cells = [...document.querySelectorAll('.cal-cell:not(.out)')];
  const today = new Date().getDate();
  const target = cells.find((c) => Number(c.textContent) > today) || cells[cells.length - 1];
  target.click();
})()`);
await evaluate(`(() => {
  const input = document.querySelector('#evName');
  input.value = '持久化测试';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  const chip = [...document.querySelectorAll('#remindChips .chip')].find((c) => c.textContent.trim() === '当天');
  chip.click();
  const chip2 = [...document.querySelectorAll('#remindChips .chip')].find((c) => c.textContent.trim() === '提前 1 天');
  chip2.click();
  const time = document.querySelector('#remindTimes input[data-lead="0"]');
  time.value = '23:59';
  time.dispatchEvent(new Event('change', { bubbles: true }));
  const time2 = document.querySelector('#remindTimes input[data-lead="1"]');
  time2.value = '08:15';
  time2.dispatchEvent(new Event('change', { bubbles: true }));
  const clock = document.querySelector('#evTime');
  clock.value = '18:40';
  clock.dispatchEvent(new Event('change', { bubbles: true }));
  document.querySelector('#saveBtn').click();
})()`);
await sleep(700);
const addedState = await getState();
results.persistedAdd = !!addedState && addedState.events.length === 1 && addedState.events[0].name === '持久化测试';
results.timeSaved = !!addedState && addedState.events[0].time === '18:40';
results.remindSaved = !!addedState && JSON.stringify(addedState.events[0].remind) === JSON.stringify({ lead: 0, time: '23:59' });
results.remindsSaved = !!addedState && JSON.stringify(addedState.events[0].reminds.map((r) => `${r.lead}@${r.time}`)) === JSON.stringify(['0@23:59', '1@08:15']);
results.remindPlanCount = await evaluate("reminderPlan().length");
results.remindPlanMatch = await evaluate(`(() => {
  const s = JSON.parse(localStorage.getItem('youri.state.v1'));
  const ev = s.events[0];
  const p = reminderPlan().find((x) => x.title === ev.name);
  if (!p) return false;
  const [y, m, d] = ev.date.split('-').map(Number);
  const expected = new Date(y, m - 1, d, 23, 59, 0, 0).getTime();
  return Math.abs(p.at - expected) < 1000 && p.body.includes('就是今天');
})()`);
await reloadAndWait();
results.persistedReload = await evaluate("[...document.querySelectorAll('.event-name')].some((e) => e.textContent.includes('持久化测试'))");
await evaluate("document.querySelector('.event').click()");
await sleep(400);
results.detailTimeRow = await evaluate(`(() => {
  const row = [...document.querySelectorAll('#detailBody .d-row')].find((r) => r.querySelector('span')?.textContent === '截止时刻');
  return row ? row.querySelector('b').textContent : null;
})()`);
await evaluate("document.querySelector('[data-act=\"detail-close\"]').click()");
await sleep(350);

// 文件夹收起状态持久化
await evaluate("document.querySelector('.folder-head').click()");
await sleep(450);
results.folderClosed = await evaluate("document.querySelector('.folder').dataset.open");
await reloadAndWait();
results.folderStaysClosed = await evaluate("document.querySelector('.folder').dataset.open");
await evaluate("document.querySelector('.folder-head').click()");
await sleep(350);

// 编辑名称并归类到 生活 / 生日
await evaluate("document.querySelector('.event').click()");
await sleep(400);
await evaluate("document.querySelector('[data-act=\"edit-event\"]').click()");
await sleep(450);
await evaluate(`(() => {
  const input = document.querySelector('#evName');
  input.value = '改过的名字';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  const chip = [...document.querySelectorAll('#chip1 .chip')].find((c) => c.textContent.includes('生活'));
  chip.click();
})()`);
await sleep(200);
await evaluate(`(() => {
  const chip = [...document.querySelectorAll('#chip2 .chip')].find((c) => c.textContent.includes('生日'));
  chip.click();
  document.querySelector('#saveBtn').click();
})()`);
await sleep(700);
results.edited = await evaluate("[...document.querySelectorAll('.event-name')].some((e) => e.textContent.includes('改过的名字'))");
results.timeKeptAfterEdit = await evaluate("JSON.parse(localStorage.getItem('youri.state.v1')).events[0].time === '18:40'");
results.assigned = await evaluate("!!document.querySelector('.subfolder .event-name')");

// 删除二级分类：事件应回到一级分类
await evaluate("document.querySelector('.tab[data-view=\"cats\"]').click()");
await sleep(400);
await evaluate(`(() => {
  const row = [...document.querySelectorAll('.cat-row.sub')].find((r) => r.textContent.includes('生日'));
  row.querySelector('[data-act="delete-cat"]').click();
})()`);
await sleep(400);
await evaluate("document.querySelector('[data-act=\"confirm-ok\"]').click()");
await sleep(600);
results.afterSubDelete = await evaluate(`(() => ({
  eventVisible: [...document.querySelectorAll('.event-name')].some((e) => e.textContent.includes('改过的名字')),
  subfolders: document.querySelectorAll('.subfolder').length
}))()`);

// 删除一级分类：事件应进入未分类
await evaluate(`(() => {
  const row = [...document.querySelectorAll('.cat-row')].find((r) => !r.classList.contains('sub') && r.textContent.includes('生活'));
  row.querySelector('[data-act="delete-cat"]').click();
})()`);
await sleep(400);
await evaluate("document.querySelector('[data-act=\"confirm-ok\"]').click()");
await sleep(600);
await evaluate("document.querySelector('.tab[data-view=\"home\"]').click()");
await sleep(450);
results.afterLv1Delete = await evaluate(`(() => ({
  uncategorized: [...document.querySelectorAll('.folder-name')].some((e) => e.textContent.includes('未分类')),
  eventVisible: [...document.querySelectorAll('.event-name')].some((e) => e.textContent.includes('改过的名字'))
}))()`);

// 删除事件
await evaluate("document.querySelector('.event').click()");
await sleep(400);
await evaluate("document.querySelector('[data-act=\"delete-event\"]').click()");
await sleep(400);
await evaluate("document.querySelector('[data-act=\"confirm-ok\"]').click()");
await sleep(600);
results.emptyAfterDelete = await evaluate("!!document.querySelector('.empty')");

/* ------------------------- 首页排序持久化测试 ------------------------- */
await evaluate(`(() => {
  const seed = {
    v: 1,
    cats: [
      { id: 'c_life', name: '生活', color: '#C8553D', parent: null },
      { id: 'c_family', name: '家人', color: '#B8893B', parent: null },
      { id: 'c_travel', name: '旅行', color: '#4F7396', parent: 'c_life' },
      { id: 'c_bday', name: '生日', color: '#A87B93', parent: 'c_life' }
    ],
    events: [
      { id: 'e1', name: '近的日子', date: '2030-01-10', cat1: 'c_life', cat2: null, repeatYearly: false, note: '', createdAt: 1 },
      { id: 'e2', name: '远的日子', date: '2030-06-10', cat1: 'c_life', cat2: null, repeatYearly: false, note: '', createdAt: 2 },
      { id: 'e3', name: '生日聚会', date: '2030-11-10', cat1: 'c_life', cat2: 'c_bday', repeatYearly: false, note: '', createdAt: 3 },
      { id: 'e4', name: '家里的日子', date: '2030-12-10', cat1: 'c_family', cat2: null, repeatYearly: false, note: '', createdAt: 4 },
      { id: 'e5', name: '去旅行', date: '2030-08-10', cat1: 'c_life', cat2: 'c_travel', repeatYearly: false, note: '', createdAt: 5 }
    ],
    collapsed: {},
    updatedAt: 0
  };
  localStorage.setItem('youri.state.v1', JSON.stringify(seed));
})()`);
await reloadAndWait();
results.sortSeedEvents = await evaluate("document.querySelectorAll('.event').length");

await evaluate("document.querySelector('[data-act=\"sort-start\"]').click()");
await sleep(450);
await evaluate(`(() => {
  const row = [...document.querySelectorAll('.event.sorting')].find((r) => r.textContent.includes('远的日子'));
  row.querySelector('[data-act="move-event"][data-dir="-1"]').click();
})()`);
await sleep(350);
await evaluate(`(() => {
  const head = [...document.querySelectorAll('.folder-head.sorting')].find((h) => h.textContent.includes('家人'));
  head.querySelector('[data-act="move-cat"][data-dir="-1"]').click();
})()`);
await sleep(350);
await evaluate(`(() => {
  const head = [...document.querySelectorAll('.sub-head.sorting')].find((h) => h.textContent.includes('生日'));
  head.querySelector('[data-act="move-cat"][data-dir="-1"]').click();
})()`);
await sleep(350);
await evaluate("document.querySelector('[data-act=\"sort-done\"]').click()");
await sleep(300);
const sortState = await getState();
results.sortEventOrderSaved = sortState.events.find((e) => e.id === 'e2').order < sortState.events.find((e) => e.id === 'e1').order;
results.sortRootOrderSaved = sortState.cats.filter((c) => !c.parent).map((c) => c.name)[0] === '家人';
results.sortSubOrderSaved = sortState.cats.filter((c) => c.parent === 'c_life').map((c) => c.name)[0] === '生日';
await reloadAndWait();
results.sortFolderAfterReload = await evaluate("document.querySelector('.folder-name')?.textContent");
results.sortEventsAfterReload = await evaluate(`(() => {
  const folder = [...document.querySelectorAll('.folder')].find((f) => f.querySelector('.folder-name')?.textContent === '生活');
  return [...folder.querySelectorAll('.event-name')].map((e) => e.textContent);
})()`);
results.sortSubsAfterReload = await evaluate(`(() => {
  const folder = [...document.querySelectorAll('.folder')].find((f) => f.querySelector('.folder-name')?.textContent === '生活');
  return [...folder.querySelectorAll('.sub-name')].map((e) => e.textContent);
})()`);
await evaluate("localStorage.clear()");

/* ------------------------- 生日 / 待办回归测试 ------------------------- */
await evaluate(`(() => {
  localStorage.setItem('youri.state.v1', JSON.stringify({
    v: 1,
    cats: [],
    events: [
      { id: 'e_past', name: '过去的日子', date: '2020-01-01', cat1: null, cat2: null, repeatYearly: false, note: '', remind: { lead: 0, time: '09:00' }, createdAt: 0 },
      { id: 'e_lunar', name: '中秋', date: '2026-09-25', lunar: { m: 8, d: 15, leap: false }, cat1: null, cat2: null, repeatYearly: true, note: '', reminds: [{ lead: 1, time: '09:00' }], createdAt: 0 },
      (() => {
        const d = new Date();
        d.setDate(d.getDate() + 30);
        const ds = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        return { id: 'e_multi', name: '多提醒测试', date: ds, cat1: null, cat2: null, repeatYearly: false, note: '', reminds: [{ lead: 0, time: '09:00' }, { lead: 3, time: '20:00' }], createdAt: 0 };
      })()
    ],
    birthdays: [
      { id: 'b1', name: '林小满', date: '1996-11-02', remind: { lead: 7, time: '08:15' }, createdAt: 1 },
      { id: 'b2', name: '妈妈', date: '1971-12-18', createdAt: 2 },
      { id: 'b3', name: '外婆', date: '2026-01-26', lunar: { m: 12, d: 8, leap: false }, remind: { lead: 1, time: '08:00' }, createdAt: 3 }
    ],
    todos: [
      { id: 't1', text: '买牛奶', done: false, createdAt: 2 },
      { id: 't2', text: '已经做完', done: true, createdAt: 1, doneAt: 3 }
    ],
    collapsed: {},
    updatedAt: 0
  }));
})()`);
await reloadAndWait();

// 农历：换算、首页、详情、提醒
results.lunarNext = await evaluate("nextLunarOccurrence({ m: 8, d: 15, leap: false }).date");
results.lunarRemindDates = await evaluate("reminderPlan().filter((x) => x.title === '中秋').map((x) => x.date)");
results.lunarDot = await evaluate("hasEventOn('2027-09-15') && !hasEventOn('2027-09-16')");
results.lunarMeta = await evaluate(`(() => {
  const ev = [...document.querySelectorAll('.event')].find((e) => e.textContent.includes('中秋'));
  return ev ? ev.querySelector('.event-meta').textContent : null;
})()`);
await evaluate("[...document.querySelectorAll('.event')].find((e) => e.textContent.includes('中秋')).click()");
await sleep(400);
results.lunarDetailRows = await evaluate(`(() => [...document.querySelectorAll('#detailBody .d-row')].slice(0, 2).map((r) => [r.querySelector('span').textContent, r.querySelector('b').textContent]))()`);
await evaluate("document.querySelector('[data-act=\"detail-close\"]').click()");
await sleep(350);

// 农历编辑器：切换、选月日、闰月提示（不保存）
await evaluate("document.querySelector('#fabNew').click()");
await sleep(450);
await evaluate("document.querySelector('[data-act=\"pick-calendar\"][data-cal=\"lunar\"]').click()");
await sleep(300);
results.lunarModeShown = await evaluate("!document.querySelector('#lunarPanel').hidden && document.querySelector('#calWrap').hidden");
await evaluate(`(() => {
  document.querySelector('[data-act="pick-lunar-month"][data-m="8"]').click();
  document.querySelector('[data-act="pick-lunar-day"][data-d="15"]').click();
})()`);
await sleep(300);
results.lunarEditorDate = await evaluate("editor.date");
results.lunarEditorPicked = await evaluate("document.querySelector('.picked-date').textContent");
results.lunarEditorNote = await evaluate("document.querySelector('#lunarNote').textContent");
await evaluate("document.querySelector('#leapChip').click()");
await sleep(300);
results.lunarLeapNote = await evaluate("document.querySelector('#lunarNote').textContent");
await shot('16-lunar-editor');
await evaluate(`(() => {
  document.querySelector('[data-act="toggle-repeat"]').click();
  const input = document.querySelector('#evName');
  input.value = '农历测试';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('#saveBtn').click();
})()`);
await sleep(700);
results.lunarSaved = await evaluate(`(() => {
  const ev = JSON.parse(localStorage.getItem('youri.state.v1')).events.find((e) => e.name === '农历测试');
  return ev ? { date: ev.date, lunar: ev.lunar, repeat: ev.repeatYearly } : null;
})()`);
await reloadAndWait();
results.lunarSavedMeta = await evaluate(`(() => {
  const ev = [...document.querySelectorAll('.event')].find((e) => e.textContent.includes('农历测试'));
  return ev ? ev.querySelector('.event-meta').textContent : null;
})()`);

await evaluate("document.querySelector('.tab[data-view=\"birth\"]').click()");
await sleep(450);
results.birthPersisted = await evaluate("document.querySelectorAll('.birth-row').length");
results.birthTitle = await evaluate("document.querySelector('.birth-main b')?.textContent");
results.lunarBirthRow = await evaluate(`(() => {
  const row = [...document.querySelectorAll('.birth-row')].find((r) => r.textContent.includes('外婆'));
  return row ? row.querySelector('.birth-main small').textContent : null;
})()`);
results.lunarBirthNext = await evaluate("birthdayInfo(state.birthdays.find((b) => b.id === 'b3')).next");
results.lunarBirthRemindDates = await evaluate("reminderPlan().filter((x) => x.title === '外婆的生日').map((x) => x.date)");
results.birthRemindMatch = await evaluate(`(() => {
  const p = reminderPlan().find((x) => x.title === '林小满的生日');
  if (!p) return false;
  const expected = new Date(2026, 10, 2 - 7, 8, 15, 0, 0).getTime();
  return Math.abs(p.at - expected) < 1000 && p.body.includes('还有 7 天');
})()`);
results.pastRemindSkipped = await evaluate("!reminderPlan().some((x) => x.title === '过去的日子')");
results.multiRemindPlan = await evaluate("reminderPlan().filter((x) => x.title === '多提醒测试').length");
results.multiRemindDetail = await evaluate(`(() => {
  openDetail('e_multi');
  const row = [...document.querySelectorAll('#detailBody .d-row')].find((r) => r.querySelector('span')?.textContent === '提醒');
  const text = row ? row.querySelector('b').innerText : null;
  closeDetail();
  return text;
})()`);

await evaluate("document.querySelector('.birth-row').click()");
await sleep(450);
results.birthEditTitle = await evaluate("document.querySelector('#editorTitle')?.textContent");
results.birthDeleteVisible = await evaluate("!document.querySelector('#birthDeleteBtn').hidden");
await evaluate(`(() => {
  const input = document.querySelector('#evName');
  input.value = '小满';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('#saveBtn').click();
})()`);
await sleep(600);
results.birthEdited = await evaluate("[...document.querySelectorAll('.birth-main b')].some((e) => e.textContent.includes('小满的生日'))");
results.birthRemindKept = await evaluate(`(() => {
  const s = JSON.parse(localStorage.getItem('youri.state.v1'));
  const b = s.birthdays.find((x) => x.id === 'b1');
  return !!b && b.remind.lead === 7 && b.remind.time === '08:15';
})()`);

await evaluate("document.querySelector('.tab[data-view=\"todo\"]').click()");
await sleep(450);
results.todoPersistedDone = await evaluate("document.querySelectorAll('.done-card .todo-row').length");
await evaluate("document.querySelector('.todo-check').click()");
await sleep(500);
results.todoCompleted = await evaluate("document.querySelectorAll('.done-card .todo-row').length");
await reloadAndWait();
await evaluate("document.querySelector('.tab[data-view=\"todo\"]').click()");
await sleep(450);
results.todoCompletionPersisted = await evaluate("document.querySelectorAll('.done-card .todo-row').length");
results.todoStatePersisted = await evaluate("JSON.parse(localStorage.getItem('youri.state.v1')).todos.every((t) => typeof t.done === 'boolean')");
await evaluate("localStorage.clear()");

// 360 宽窄屏：分类标题旁的「+」不挤压标题、不出现横向滚动
await cdp.send('Emulation.setDeviceMetricsOverride', {
  width: 360,
  height: 640,
  deviceScaleFactor: DSF,
  mobile: true,
  screenWidth: 360,
  screenHeight: 640
});
await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?demo=1` });
await sleep(900);
results.narrowLayout = await evaluate(`(() => {
  const rect = ${rectScript};
  const folderHeads = [...document.querySelectorAll('.folder-top')];
  const subHeads = [...document.querySelectorAll('.sub-top')];
  const target = (el) => el ? el.getBoundingClientRect() : null;
  return {
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    addButtons: document.querySelectorAll('.head-add').length,
    folderAddRight: folderHeads.map((h) => Math.round(target(h.querySelector('.head-add')).right)),
    subAddRight: subHeads.map((h) => Math.round(target(h.querySelector('.head-add')).right)),
    foldersOverlap: folderHeads.some((h) => {
      const add = target(h.querySelector('.head-add'));
      const name = target(h.querySelector('.folder-name'));
      return add.left < name.right - 1;
    }),
    subsOverlap: subHeads.some((h) => {
      const add = target(h.querySelector('.head-add'));
      const name = target(h.querySelector('.sub-name'));
      return add.left < name.right - 1;
    }),
    viewport: innerWidth
  };
})()`);
await evaluate("document.querySelector('.tab[data-view=\"cats\"]').click()");
await sleep(450);
results.narrowCats = await evaluate(`(() => {
  const rows = [...document.querySelectorAll('.cat-row')];
  const add = rows[0]?.querySelector('.mini-btn.add');
  const del = rows[0]?.querySelector('.mini-btn.del');
  const a = add ? add.getBoundingClientRect() : null;
  const d = del ? del.getBoundingClientRect() : null;
  return {
    rows: rows.length,
    addCount: document.querySelectorAll('.cat-row .mini-btn.add').length,
    addInViewport: !!a && a.width > 0 && a.right <= innerWidth,
    beforeDelete: !!a && !!d && a.left < d.left,
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth
  };
})()`);

results.errors = errors;
console.log(JSON.stringify(results, null, 2));

ws.close();
edge.kill();
server.close();
process.exit(0);
