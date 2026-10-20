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
await shot('01-home');

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
})()`);
await sleep(400);
await shot('04-editor-filled');
results.pickedTag2 = await evaluate("document.querySelector('.picked-tag')?.textContent");
results.chipOn = await evaluate("document.querySelectorAll('.chip.on').length");
await evaluate("document.querySelector('[data-act=\"editor-close\"]').click()");
await sleep(350);

// 分类页
await evaluate("document.querySelector('.tab[data-view=\"cats\"]').click()");
await sleep(500);
results.catCards = await evaluate("document.querySelectorAll('.cat-card').length");
results.catRows = await evaluate("document.querySelectorAll('.cat-row').length");
await shot('05-cats');

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
  document.querySelector('#saveBtn').click();
})()`);
await sleep(700);
const addedState = await getState();
results.persistedAdd = !!addedState && addedState.events.length === 1 && addedState.events[0].name === '持久化测试';
await reloadAndWait();
results.persistedReload = await evaluate("[...document.querySelectorAll('.event-name')].some((e) => e.textContent.includes('持久化测试'))");

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

results.errors = errors;
console.log(JSON.stringify(results, null, 2));

ws.close();
edge.kill();
server.close();
process.exit(0);
