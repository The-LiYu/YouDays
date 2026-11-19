import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WWW = path.join(ROOT, '手机端', 'native', 'www');
const OUT = path.join(ROOT, '预览');
const EDGE = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 47841;
const DAV_PORT = 47842;
const DEBUG_PORT = 9344;
const WIDTH = 390;
const HEIGHT = 844;

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

fs.mkdirSync(OUT, { recursive: true });

const staticServer = http.createServer((req, res) => {
  const pathname = decodeURIComponent((req.url || '/').split('?')[0]);
  const target = path.join(WWW, pathname === '/' ? 'index.html' : pathname);
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
await new Promise((resolve) => staticServer.listen(PORT, '127.0.0.1', resolve));

/* ------------------------------ mock WebDAV ------------------------------ */
const AUTH = 'Basic ' + Buffer.from('test@example.com:app-pass').toString('base64');
let stored = null;
const davLog = [];

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, PROPFIND, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Depth');
}

const davServer = http.createServer((req, res) => {
  cors(res);
  davLog.push(`${req.method} ${req.url}`);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.headers.authorization !== AUTH) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="mock"' });
    res.end('unauthorized');
    return;
  }
  const url = new URL(req.url || '/', `http://127.0.0.1:${DAV_PORT}`);

  if (req.method === 'PROPFIND' && url.pathname === '/dav/') {
    res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' });
    res.end('<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>');
    return;
  }

  if (url.pathname === '/dav/youri-backup.json') {
    if (req.method === 'PUT') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        stored = body;
        res.writeHead(201);
        res.end();
      });
      return;
    }
    if (req.method === 'GET') {
      if (!stored) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(stored);
      return;
    }
  }

  res.writeHead(405);
  res.end('method not allowed');
});
await new Promise((resolve) => davServer.listen(DAV_PORT, '127.0.0.1', resolve));

/* ------------------------------ headless Edge ------------------------------ */
const edge = spawn(EDGE, [
  '--headless=new',
  `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${path.join(process.env.TEMP, 'youri-sync-profile')}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  '--hide-scrollbars',
  'about:blank'
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWs() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?about:blank`, { method: 'PUT' });
      if (res.ok) return (await res.json()).webSocketDebuggerUrl;
    } catch (err) {
      /* wait */
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

const ws = new WebSocket(await getWs());
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

await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Log.enable');
await cdp.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, mobile: true, screenWidth: WIDTH, screenHeight: HEIGHT });
await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.__YOURI_DAV_BASE__ = "http://127.0.0.1:${DAV_PORT}/dav";`
});

const loaded = new Promise((resolve) => cdp.on('Page.loadEventFired', resolve));
await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
await loaded;
await sleep(800);
await cdp.send('Runtime.evaluate', { expression: 'localStorage.clear()' });
const reloaded = new Promise((resolve) => cdp.on('Page.loadEventFired', resolve));
await cdp.send('Page.reload');
await reloaded;
await sleep(800);

async function evaluate(expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

async function shot(name) {
  const result = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(result.data, 'base64'));
  console.log('shot', name);
}

const results = {};

// 先建一个日子
await evaluate("document.querySelector('#fabNew').click()");
await sleep(450);
await evaluate(`(() => {
  const cells = [...document.querySelectorAll('.cal-cell:not(.out)')];
  const today = new Date().getDate();
  (cells.find((c) => Number(c.textContent) > today) || cells[cells.length - 1]).click();
})()`);
await evaluate(`(() => {
  const input = document.querySelector('#evName');
  input.value = '同步测试';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('[data-act="pick-calendar"][data-cal="lunar"]').click();
  document.querySelector('[data-act="pick-lunar-month"][data-m="8"]').click();
  document.querySelector('[data-act="pick-lunar-day"][data-d="15"]').click();
  document.querySelector('#saveBtn').click();
})()`);
await sleep(600);
results.initialEvents = await evaluate("document.querySelectorAll('.event').length");
results.initialLunar = await evaluate("JSON.parse(localStorage.getItem('youri.state.v1')).events[0].lunar");

// 打开同步
await evaluate("document.querySelector('[data-act=\"open-sync\"]').click()");
await sleep(450);

// 错误密码
await evaluate(`(() => {
  document.querySelector('#davUser').value = 'test@example.com';
  document.querySelector('#davPass').value = 'wrong-pass';
})()`);
await evaluate("document.querySelector('[data-act=\"dav-connect\"]').click()");
await sleep(800);
results.wrongPasswordStatus = await evaluate("document.querySelector('#cloudStatusTitle').textContent");
results.wrongPasswordMsg = await evaluate("document.querySelector('#cloudMsg').textContent");

// 正确密码
await evaluate("document.querySelector('#davPass').value = 'app-pass'");
await evaluate("document.querySelector('[data-act=\"dav-connect\"]').click()");
await sleep(900);
results.connectedStatus = await evaluate("document.querySelector('#cloudStatusTitle').textContent");
results.connectedSub = await evaluate("document.querySelector('#cloudStatusSub').textContent");
results.connectRequests = davLog.filter((l) => l.startsWith('GET')).length;

// 上传
await evaluate("document.querySelector('[data-act=\"dav-upload\"]').click()");
await sleep(900);
results.uploadMsg = await evaluate("document.querySelector('#cloudMsg').textContent");
results.cloudEvents = stored ? JSON.parse(stored).events.length : 0;
results.cloudLunar = stored ? JSON.parse(stored).events.find((e) => e.name === '同步测试')?.lunar : null;
results.uploadStatus = await evaluate("document.querySelector('#cloudStatusTitle').textContent");
await shot('09-sync-connected');

// 打开自动备份
await evaluate("document.querySelector('[data-act=\"toggle-auto\"]').click()");
results.autoOn = await evaluate("document.querySelector('#autoRow').getAttribute('aria-checked')");
await evaluate("document.querySelector('[data-act=\"sync-close\"]').click()");
await sleep(350);

// 新增第二个日子，等待自动备份
await evaluate("document.querySelector('#fabNew').click()");
await sleep(450);
await evaluate(`(() => {
  const cells = [...document.querySelectorAll('.cal-cell:not(.out)')];
  (cells.find((c) => Number(c.textContent) > new Date().getDate()) || cells[cells.length - 1]).click();
})()`);
await evaluate(`(() => {
  const input = document.querySelector('#evName');
  input.value = '自动备份日子';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('#saveBtn').click();
})()`);
await sleep(3600);
results.cloudEventsAfterAuto = stored ? JSON.parse(stored).events.length : 0;
results.eventsAfterAuto = await evaluate("document.querySelectorAll('.event').length");
results.syncDot = await evaluate("document.querySelector('.sync-btn').dataset.sync");

// 关闭自动备份，删除本地一个日子，再从云端恢复
await evaluate("document.querySelector('[data-act=\"open-sync\"]').click()");
await sleep(400);
await evaluate("document.querySelector('[data-act=\"toggle-auto\"]').click()");
await evaluate("document.querySelector('[data-act=\"sync-close\"]').click()");
await sleep(350);

await evaluate(`(() => {
  const row = [...document.querySelectorAll('.event')].find((r) => r.textContent.includes('自动备份日子'));
  row.click();
})()`);
await sleep(350);
await evaluate("document.querySelector('[data-act=\"delete-event\"]').click()");
await sleep(300);
await evaluate("document.querySelector('[data-act=\"confirm-ok\"]').click()");
await sleep(500);
results.eventsBeforeRestore = await evaluate("document.querySelectorAll('.event').length");

await evaluate("document.querySelector('[data-act=\"open-sync\"]').click()");
await sleep(400);
await evaluate("document.querySelector('[data-act=\"dav-restore\"]').click()");
await sleep(700);
results.restoreConfirmVisible = await evaluate("!!document.querySelector('#confirmLayer.open')");
await evaluate("document.querySelector('[data-act=\"confirm-ok\"]').click()");
await sleep(900);
results.eventsAfterRestore = await evaluate("document.querySelectorAll('.event').length");
results.restoreMsg = await evaluate("document.querySelector('#cloudMsg').textContent");
results.restoreLunar = await evaluate("JSON.parse(localStorage.getItem('youri.state.v1')).events.find((e) => e.name === '同步测试')?.lunar");

// 断开连接
await evaluate("document.querySelector('[data-act=\"dav-disconnect\"]').click()");
await sleep(400);
await evaluate("document.querySelector('[data-act=\"confirm-ok\"]').click()");
await sleep(600);
results.disconnectedStatus = await evaluate("document.querySelector('#cloudStatusTitle').textContent");
results.cloudKey = await evaluate("localStorage.getItem('youri.cloud.v1')");

results.errors = errors;
console.log(JSON.stringify(results, null, 2));

ws.close();
edge.kill();
staticServer.close();
davServer.close();
process.exit(0);
