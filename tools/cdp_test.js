#!/usr/bin/env node
/*
 * Tiny Chrome DevTools Protocol driver for doom.epub testing.
 * No external dependencies: uses Node's built-in WebSocket and fetch.
 *
 * Usage:
 *   node tools/cdp_test.js --url URL [actions...]
 *
 * Actions (executed in order):
 *   --wait MS                 wait
 *   --shot FILE.png           capture screenshot
 *   --eval EXPR               evaluate JS, print JSON result
 *   --key CODE                press+release a key (KeyboardEvent.code name)
 *   --hold CODE MS            hold a key for MS
 *   --mousedown X Y           dispatch mouse pressed at viewport coords
 *   --mouseup X Y
 *   --click X Y
 *   --move X Y
 *
 * Example:
 *   node tools/cdp_test.js --url http://localhost:8740/web/dev/index.html \
 *     --wait 6000 --shot /tmp/t1.png --key Enter --wait 3000 --shot /tmp/t2.png
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseArgs(argv) {
  const actions = [];
  let url = null, chromePath = CHROME, width = 1340, height = 700, port = 0, scriptFile = null, injectFile = null, watchdogMs = 120000, connectUrl = null, frameMatch = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--url': url = next(); break;
      case '--inject': injectFile = next(); break;
      case '--connect': connectUrl = next(); break;
      case '--frame': frameMatch = next(); break;
      case '--chrome': chromePath = next(); break;
      case '--width': width = parseInt(next(), 10); break;
      case '--height': height = parseInt(next(), 10); break;
      case '--port': port = parseInt(next(), 10); break;
      case '--timeout': watchdogMs = parseInt(next(), 10); break;
      case '--script': scriptFile = next(); break;
      case '--wait': actions.push({ type: 'wait', ms: parseInt(next(), 10) }); break;
      case '--shot': actions.push({ type: 'shot', file: next() }); break;
      case '--eval': actions.push({ type: 'eval', expr: next() }); break;
      case '--key': actions.push({ type: 'key', code: next() }); break;
      case '--hold': {
        const code = next(); const ms = parseInt(next(), 10);
        actions.push({ type: 'hold', code, ms });
        break;
      }
      case '--mousedown': actions.push({ type: 'mousedown', x: parseFloat(next()), y: parseFloat(next()) }); break;
      case '--mouseup': actions.push({ type: 'mouseup', x: parseFloat(next()), y: parseFloat(next()) }); break;
      case '--move': actions.push({ type: 'move', x: parseFloat(next()), y: parseFloat(next()) }); break;
      case '--click': actions.push({ type: 'click', x: parseFloat(next()), y: parseFloat(next()) }); break;
      case '--touch': actions.push({ type: 'touch', x: parseFloat(next()), y: parseFloat(next()) }); break;
      case '--touchdrag': {
        const x1 = parseFloat(next()), y1 = parseFloat(next());
        const x2 = parseFloat(next()), y2 = parseFloat(next());
        actions.push({ type: 'touchdrag', x1, y1, x2, y2 });
        break;
      }
      default: throw new Error('unknown arg: ' + a);
    }
  }
  if (scriptFile) {
    const loaded = JSON.parse(fs.readFileSync(scriptFile, 'utf8'));
    return { url: loaded.url || url, chromePath, width: loaded.width || width, height: loaded.height || height, port, injectFile: loaded.inject || injectFile, actions: loaded.actions || [], watchdogMs: loaded.timeout || watchdogMs, frameMatch: loaded.frame || frameMatch };
  }
  return { url, chromePath, width, height, port, injectFile, actions, watchdogMs, connectUrl, frameMatch };
}

async function waitForDevtools(port, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return await r.json();
    } catch (e) { }
    await sleep(200);
  }
  throw new Error('devtools did not start');
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.sessions = new Map(); this.contexts = []; }
  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const cdp = new CDP(ws);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.method === 'Runtime.executionContextCreated') {
        cdp.contexts.push(msg.params.context);
      } else if (msg.method === 'Runtime.consoleAPICalled') {
        const parts = (msg.params.args || []).map(a => a.value !== undefined ? a.value : (a.description || ''));
        console.log('[console.' + msg.params.type + ']', parts.join(' '));
      } else if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        console.log('[exception]', d.exception && d.exception.description || d.text);
      }
      if (msg.id && cdp.pending.has(msg.id)) {
        const { res, rej } = cdp.pending.get(msg.id);
        cdp.pending.delete(msg.id);
        if (msg.error) rej(new Error(JSON.stringify(msg.error))); else res(msg.result);
      }
    };
    return cdp;
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((res, rej) => this.pending.set(id, { res, rej }));
  }
  close() { try { this.ws.close(); } catch (e) { } }
}

function keyInfo(code) {
  const map = {
    Enter: { key: 'Enter', keyCode: 13, text: '\r' },
    Escape: { key: 'Escape', keyCode: 27 },
    Space: { key: ' ', keyCode: 32, text: ' ' },
    ArrowLeft: { key: 'ArrowLeft', keyCode: 37 },
    ArrowRight: { key: 'ArrowRight', keyCode: 39 },
    ArrowUp: { key: 'ArrowUp', keyCode: 38 },
    ArrowDown: { key: 'ArrowDown', keyCode: 40 },
    Tab: { key: 'Tab', keyCode: 9 },
    ControlLeft: { key: 'Control', keyCode: 17 },
    ShiftLeft: { key: 'Shift', keyCode: 16 },
    KeyW: { key: 'w', keyCode: 87, text: 'w' },
    KeyA: { key: 'a', keyCode: 65, text: 'a' },
    KeyS: { key: 's', keyCode: 83, text: 's' },
    KeyD: { key: 'd', keyCode: 68, text: 'd' },
    KeyQ: { key: 'q', keyCode: 81, text: 'q' },
    KeyE: { key: 'e', keyCode: 69, text: 'e' },
    KeyF: { key: 'f', keyCode: 70, text: 'f' },
    Digit1: { key: '1', keyCode: 49, text: '1' },
    Digit2: { key: '2', keyCode: 50, text: '2' },
    Digit3: { key: '3', keyCode: 51, text: '3' },
    F2: { key: 'F2', keyCode: 113 },
    F3: { key: 'F3', keyCode: 114 }
  };
  return map[code] || { key: code, keyCode: 0, text: undefined };
}

async function dispatchKey(cdp, sessionId, type, code) {
  const info = keyInfo(code);
  await cdp.send('Input.dispatchKeyEvent', {
    type,
    code,
    key: info.key,
    windowsVirtualKeyCode: info.keyCode,
    nativeVirtualKeyCode: info.keyCode,
    text: type === 'keyDown' ? info.text : undefined,
    unmodifiedText: type === 'keyDown' ? info.text : undefined
  }, sessionId);
}

async function main() {
  const { url, chromePath, width, height, port: fixedPort, injectFile, actions, watchdogMs, connectUrl, frameMatch } = parseArgs(process.argv.slice(2));
  if (!url && !connectUrl) throw new Error('--url or --connect required');
  const port = fixedPort || (9300 + Math.floor(Math.random() * 500));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'doomcdp-'));
  let chrome = null;
  const watchdog = setTimeout(() => {
    console.error('__WATCHDOG_TIMEOUT__');
    if (chrome) { try { chrome.kill('SIGKILL'); } catch (e) { } }
    setTimeout(() => process.exit(3), 250);
  }, watchdogMs);

  try {
    let wsUrl;
    let target = null;
    if (connectUrl) {
      // Attach to an existing CDP endpoint (e.g. QtWebEngine with
      // QTWEBENGINE_REMOTE_DEBUGGING).  If --url is given, navigate there.
      let target;
      if (connectUrl.startsWith('ws://') || connectUrl.startsWith('wss://')) {
        wsUrl = connectUrl;
      } else {
        const base = connectUrl.replace(/\/$/, '');
        const list = await (await fetch(base + '/json/list')).json();
        const pages = list.filter(t => t.type === 'page');
        if (!pages.length) throw new Error('no page targets at ' + base);
        target = pages[pages.length - 1];
        wsUrl = target.webSocketDebuggerUrl;
      }
    } else {
      chrome = spawn(chromePath, [
        '--headless=new',
        '--disable-gpu',
        '--autoplay-policy=no-user-gesture-required',
        '--no-first-run',
        '--mute-audio',
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${profile}`,
        `--window-size=${width},${height}`,
        'about:blank'
      ], { stdio: 'ignore' });
      await waitForDevtools(port, 15000);
      try {
        const r = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
        target = await r.json();
      } catch (e) {
        const r = await fetch(`http://127.0.0.1:${port}/json/list`);
        const list = await r.json();
        target = list.find(t => t.type === 'page');
      }
      wsUrl = target.webSocketDebuggerUrl;
    }

    const cdp = await CDP.connect(wsUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    let frameContextId = null;
    if (frameMatch) {
      await sleep(400);
      const candidates = cdp.contexts.filter(c => c.auxData && c.auxData.isDefault);
      for (const ctx of (candidates.length ? candidates : cdp.contexts)) {
        try {
          const r = await cdp.send('Runtime.evaluate', { expression: 'String(location.href)', contextId: ctx.id, returnByValue: true });
          if (r && r.result && String(r.result.value).indexOf(frameMatch) !== -1) { frameContextId = ctx.id; break; }
        } catch (e) { }
      }
      if (frameContextId === null) {
        console.error('__FRAME_NOT_FOUND__');
      } else {
        console.log('[frame] context ' + frameContextId + ' matches ' + frameMatch);
      }
    }
    if (injectFile) {
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: fs.readFileSync(injectFile, 'utf8') });
      await cdp.send('Page.reload');
      await sleep(300);
    }
    if (connectUrl) {
      if (url) { await cdp.send('Page.navigate', { url }); await sleep(500); }
    } else if (!target.url || !target.url.startsWith('http')) {
      await cdp.send('Page.navigate', { url });
    }

    // If a frame match was requested but not found yet, retry once more
    // after any navigation has settled.
    if (frameMatch && frameContextId === null) {
      await sleep(1000);
      const candidates2 = cdp.contexts.filter(c => c.auxData && c.auxData.isDefault);
      for (const ctx of (candidates2.length ? candidates2 : cdp.contexts)) {
        try {
          const r = await cdp.send('Runtime.evaluate', { expression: 'String(location.href)', contextId: ctx.id, returnByValue: true });
          if (r && r.result && String(r.result.value).indexOf(frameMatch) !== -1) { frameContextId = ctx.id; break; }
        } catch (e) { }
      }
    }

    for (const action of actions) {
      switch (action.type) {
        case 'wait': await sleep(action.ms); break;
        case 'shot': {
          const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
          fs.writeFileSync(action.file, Buffer.from(data, 'base64'));
          console.log(`[shot] ${action.file}`);
          break;
        }
        case 'eval': {
          const evalParams = {
            expression: action.expr, returnByValue: true, awaitPromise: true,
            includeCommandLineAPI: true
          };
          if (frameContextId !== null) { evalParams.contextId = frameContextId; }
          const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', evalParams);
          if (exceptionDetails) {
            console.log('[eval:error]', exceptionDetails.exception && exceptionDetails.exception.description || JSON.stringify(exceptionDetails));
          } else {
            console.log('[eval]', JSON.stringify(result.value));
          }
          break;
        }
        case 'key':
          await dispatchKey(cdp, undefined, 'keyDown', action.code);
          await sleep(30);
          await dispatchKey(cdp, undefined, 'keyUp', action.code);
          console.log(`[key] ${action.code}`);
          break;
        case 'hold':
          await dispatchKey(cdp, undefined, 'keyDown', action.code);
          await sleep(action.ms);
          await dispatchKey(cdp, undefined, 'keyUp', action.code);
          console.log(`[hold] ${action.code} ${action.ms}ms`);
          break;
        case 'mousedown':
          await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: action.x, y: action.y, button: 'left', clickCount: 1 });
          break;
        case 'mouseup':
          await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: action.x, y: action.y, button: 'left', clickCount: 1 });
          break;
        case 'move':
          await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: action.x, y: action.y, button: 'none' });
          break;
        case 'click':
          await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: action.x, y: action.y, button: 'left', clickCount: 1 });
          await sleep(40);
          await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: action.x, y: action.y, button: 'left', clickCount: 1 });
          console.log(`[click] ${action.x},${action.y}`);
          break;
        case 'touch':
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: action.x, y: action.y }] });
          await sleep(60);
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          console.log(`[touch] ${action.x},${action.y}`);
          break;
        case 'touchdrag': {
          const steps = 8;
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: action.x1, y: action.y1 }] });
          for (let s = 1; s <= steps; s++) {
            const x = action.x1 + (action.x2 - action.x1) * s / steps;
            const y = action.y1 + (action.y2 - action.y1) * s / steps;
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
            await sleep(40);
          }
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          console.log(`[touchdrag] ${action.x1},${action.y1} -> ${action.x2},${action.y2}`);
          break;
        }
      }
    }
    cdp.close();
  } finally {
    clearTimeout(watchdog);
    if (chrome) { chrome.kill('SIGKILL'); }
  }
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
