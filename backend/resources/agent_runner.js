/**
 * Standalone Vertex SaaS Host Agent Runner
 * Zero external dependencies: Uses built-in Node.js APIs (WebSocket, fetch, child_process, fs, path).
 */
const { execFile, execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');

// Process-wide crash protection so host agent never exits on transient stream or socket errors
process.on('uncaughtException', (err) => {
  console.error('[Agent uncaughtException]', err ? (err.message || err) : 'unknown');
});
process.on('unhandledRejection', (reason) => {
  console.error('[Agent unhandledRejection]', reason ? (reason.message || reason) : 'unknown');
});

// Single instance lock to prevent duplicate scrcpy capture processes
const LOCK_PORT = 47155;
const lockServer = net.createServer();
lockServer.once('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.warn('[Agent] ⚠️ Another instance of Vertex Host Agent is already running on this machine (Lock port 47155 in use). Terminating duplicate.');
    process.exit(0);
  }
});
lockServer.listen(LOCK_PORT, '127.0.0.1');

// Global WebSocket fallback for older Node versions
let WsClient = globalThis.WebSocket;
if (!WsClient) {
  try {
    WsClient = require('ws');
  } catch (e) {
    try {
      WsClient = require(path.join(__dirname, 'node_modules', 'ws'));
    } catch (e2) {}
  }
}

console.log('===============================================================================');
console.log('       📱 VERTEX SAAS CLOUD DEVICE MANAGEMENT - HOST STREAMING ENGINE        ');
console.log('===============================================================================');

// Resolve directories
const appData = process.env.LOCALAPPDATA || (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'AppData', 'Local') : '');
const candidateDirs = [
  path.join(appData, 'VertexSaaS', 'Agent'),
  process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'VertexSaaS', 'Agent') : '',
  __dirname,
  process.cwd(),
].filter(Boolean);

let agentDir = candidateDirs[0];
for (const d of candidateDirs) {
  if (fs.existsSync(path.join(d, 'agent_credentials.json'))) {
    agentDir = d;
    break;
  }
}

console.log('[Agent] Working directory   :', agentDir);

// Read config & credentials
function loadConfig() {
  let cfg = {
    backendUrl: 'https://api-streams.sam.co.ke',
    computerName: process.env.COMPUTERNAME || 'VERTEXT',
    organizationId: 'aaaa0000-0000-0000-0000-000000000001',
  };

  const cfgFile = path.join(agentDir, 'config.json');
  if (fs.existsSync(cfgFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(cfgFile, 'utf8').replace(/^\uFEFF/, '').trim());
      cfg = { ...cfg, ...parsed };
    } catch (e) {}
  }

  const credFile = path.join(agentDir, 'agent_credentials.json');
  if (fs.existsSync(credFile)) {
    try {
      const cred = JSON.parse(fs.readFileSync(credFile, 'utf8').replace(/^\uFEFF/, '').trim());
      if (cred.agent) {
        cfg.agentId = cred.agent.id;
        cfg.organizationId = cred.agent.organization_id || cfg.organizationId;
      }
      if (cred.agentAuthToken) {
        cfg.agentAuthToken = cred.agentAuthToken;
      }
    } catch (e) {}
  }

  return cfg;
}

const config = loadConfig();
console.log('[Agent] Host Computer       :', config.computerName);
console.log('[Agent] Cloud Controller Host:', config.backendUrl);
console.log('[Agent] Enrolled Agent ID   :', config.agentId || 'Waiting for enrollment...');
console.log('[Agent] Organization ID     :', config.organizationId);

// Locate Scrcpy executable and server jar
function findScrcpy() {
  const candidates = [
    path.join(__dirname, 'resources', 'scrcpy-win64-v3.3.4', 'scrcpy.exe'),
    path.join(__dirname, '..', 'resources', 'scrcpy-win64-v3.3.4', 'scrcpy.exe'),
    path.join(process.cwd(), 'resources', 'scrcpy-win64-v3.3.4', 'scrcpy.exe'),
    path.join(agentDir, 'scrcpy', 'scrcpy.exe'),
    'scrcpy.exe',
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function findScrcpyServerJar() {
  const candidates = [
    path.join(__dirname, 'resources', 'scrcpy-win64-v3.3.4', 'scrcpy-server'),
    path.join(__dirname, '..', 'resources', 'scrcpy-win64-v3.3.4', 'scrcpy-server'),
    path.join(process.cwd(), 'resources', 'scrcpy-win64-v3.3.4', 'scrcpy-server'),
    path.join(agentDir, 'scrcpy', 'scrcpy-server'),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

const scrcpyPath = findScrcpy();
const scrcpyServerJarPath = findScrcpyServerJar();
console.log('[Agent] Scrcpy Executable    :', scrcpyPath || 'Not found');
console.log('[Agent] Scrcpy Server Jar    :', scrcpyServerJarPath || 'Not found');

// Locate ADB
function findAdb() {
  const candidates = [
    path.join(__dirname, 'resources', 'scrcpy-win64-v3.3.4', 'adb.exe'),
    path.join(__dirname, '..', 'resources', 'scrcpy-win64-v3.3.4', 'adb.exe'),
    path.join(process.cwd(), 'resources', 'scrcpy-win64-v3.3.4', 'adb.exe'),
    path.join(agentDir, 'scrcpy', 'adb.exe'),
    'adb.exe',
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return 'adb.exe';
}

const adbPath = findAdb();
console.log('[Agent] ADB Executable      :', adbPath);

function execAdb(args, timeout = 10000) {
  return new Promise((resolve, reject) => {
    execFile(adbPath, args, { timeout }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.toString());
    });
  });
}

function captureScreenshot(serial) {
  return new Promise((resolve, reject) => {
    execFile(adbPath, ['-s', serial, 'exec-out', 'screencap', '-p'], { encoding: 'buffer', maxBuffer: 15 * 1024 * 1024, timeout: 5000 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

// Persistent interactive ADB shell and native scrcpy control sockets
const shellSessions = new Map(); // serial -> ChildProcess
const controlSockets = new Map(); // serial -> net.Socket
const deviceDimensions = new Map(); // serial -> { width, height }

function getDeviceShell(serial) {
  let proc = shellSessions.get(serial);
  if (!proc || proc.killed) {
    proc = spawn(adbPath, ['-s', serial, 'shell'], { stdio: ['pipe', 'pipe', 'pipe'] });
    if (proc.stdin) {
      proc.stdin.on('error', (err) => {
        console.warn(`[Shell] stdin error on ${serial}:`, err.message);
      });
    }
    proc.on('error', (err) => {
      console.warn(`[Shell] proc error on ${serial}:`, err.message);
    });
    shellSessions.set(serial, proc);
    proc.on('exit', () => shellSessions.delete(serial));
  }
  return proc;
}

function sendShellInput(serial, command) {
  try {
    const sh = getDeviceShell(serial);
    sh.stdin.write(command + '\n');
    return true;
  } catch (e) {
    execFile(adbPath, ['-s', serial, 'shell', command], () => {});
    return false;
  }
}

function floatToI16FP(f) {
  const clamped = Math.max(-1, Math.min(1, f));
  return clamped < 0 ? -Math.round(-clamped * 0x8000) : Math.round(clamped * 0x7fff);
}

function sendScrcpyScroll(sock, x, y, width = 720, height = 1600, hScroll = 0, vScroll = 0) {
  try {
    // 21-byte SC_CONTROL_MSG_TYPE_INJECT_SCROLL_EVENT (type = 3)
    const msg = Buffer.alloc(21);
    msg.writeUInt8(3, 0); // type: INJECT_SCROLL_EVENT
    msg.writeUInt32BE(Math.max(0, Math.min(width, Math.round(x))), 1);
    msg.writeUInt32BE(Math.max(0, Math.min(height, Math.round(y))), 5);
    msg.writeUInt16BE(width, 9);
    msg.writeUInt16BE(height, 11);
    msg.writeInt16BE(floatToI16FP(hScroll / 128), 13);
    msg.writeInt16BE(floatToI16FP(vScroll / 128), 15);
    msg.writeUInt32BE(0, 17); // buttons = 0
    sock.write(msg);
    return true;
  } catch (e) {
    return false;
  }
}

function sendScrcpyTouch(sock, action, x, y, width = 720, height = 1600) {
  try {
    if (!sock || sock.destroyed) return false;
    // 32-byte SC_CONTROL_MSG_TYPE_INJECT_TOUCH_EVENT (type = 2)
    const msg = Buffer.alloc(32);
    msg.writeUInt8(2, 0); // type: INJECT_TOUCH_EVENT
    msg.writeUInt8(action, 1); // 0=DOWN, 1=UP, 2=MOVE
    msg.writeBigUInt64BE(0xfffffffffffffffen, 2); // POINTER_ID_GENERIC_FINGER (-2n) for instant native gesture tracking
    msg.writeUInt32BE(Math.max(0, Math.min(width, Math.round(x))), 10);
    msg.writeUInt32BE(Math.max(0, Math.min(height, Math.round(y))), 14);
    msg.writeUInt16BE(width, 18);
    msg.writeUInt16BE(height, 20);
    msg.writeUInt16BE(action === 1 ? 0 : 0xffff, 22); // pressure (1.0 when touching, 0 when released)
    msg.writeUInt32BE(action === 0 ? 1 : 0, 24); // action_button: AMOTION_EVENT_BUTTON_PRIMARY on down
    msg.writeUInt32BE(action === 1 ? 0 : 1, 28); // buttons: AMOTION_EVENT_BUTTON_PRIMARY active while touching
    sock.write(msg);
    return true;
  } catch (e) {
    return false;
  }
}

function sendScrcpyText(sock, text) {
  try {
    if (!sock || sock.destroyed || !text) return false;
    const textBuf = Buffer.from(text, 'utf8');
    // SC_CONTROL_MSG_TYPE_INJECT_TEXT (type = 1): 1 byte type, 4 bytes length, text bytes
    const msg = Buffer.alloc(5 + textBuf.length);
    msg.writeUInt8(1, 0); // type: INJECT_TEXT
    msg.writeUInt32BE(textBuf.length, 1);
    textBuf.copy(msg, 5);
    sock.write(msg);
    return true;
  } catch (e) {
    return false;
  }
}

function sendScrcpyKeycode(sock, keycode) {
  try {
    if (!sock || sock.destroyed || keycode === undefined) return false;
    // 14-byte SC_CONTROL_MSG_TYPE_INJECT_KEYCODE (type = 0)
    // DOWN
    const down = Buffer.alloc(14);
    down.writeUInt8(0, 0);
    down.writeUInt8(0, 1); // AKEY_EVENT_ACTION_DOWN
    down.writeUInt32BE(keycode, 2);
    down.writeUInt32BE(0, 6);
    down.writeUInt32BE(0, 10);
    sock.write(down);

    // UP
    const up = Buffer.alloc(14);
    up.writeUInt8(0, 0);
    up.writeUInt8(1, 1); // AKEY_EVENT_ACTION_UP
    up.writeUInt32BE(keycode, 2);
    up.writeUInt32BE(0, 6);
    up.writeUInt32BE(0, 10);
    sock.write(up);
    return true;
  } catch (e) {
    return false;
  }
}

async function ensureDeviceAwake(serial) {
  try {
    execFile(adbPath, ['-s', serial, 'shell', 'settings put global stay_on_while_plugged_in 3'], () => {});
    execFile(adbPath, ['-s', serial, 'shell', 'svc power stayon true'], () => {});
    execFile(adbPath, ['-s', serial, 'shell', 'input keyevent 224'], () => {});
    execFile(adbPath, ['-s', serial, 'shell', 'wm dismiss-keyguard'], () => {});
  } catch (e) {}
}

async function wakePhone(serial) {
  try {
    sendShellInput(serial, 'input keyevent 224'); // KEYCODE_WAKEUP
    sendShellInput(serial, 'wm dismiss-keyguard');
  } catch (e) {}
}

const lastTouchState = new Map(); // serial -> { isDown, x, y, width, height, time }

// Watchdog: auto-release stuck touch pointers if mobile connection drops mid-gesture
setInterval(() => {
  const now = Date.now();
  for (const [serial, state] of lastTouchState.entries()) {
    if (state.isDown && now - state.time > 4000) {
      const sock = controlSockets.get(serial);
      if (sock && !sock.destroyed) {
        sendScrcpyTouch(sock, 1, state.x, state.y, state.width, state.height);
      }
      state.isDown = false;
    }
  }
}, 1000);

async function injectInput(serial, action, data) {
  try {
    if (!data) data = {};
    const sock = controlSockets.get(serial);
    const dims = deviceDimensions.get(serial);
    const targetW = dims ? dims.width : (data.width || 720);
    const targetH = dims ? dims.height : (data.height || 1600);
    const srcW = data.width || 720;
    const srcH = data.height || 1600;

    const scaleX = (x) => Math.round(((x || 0) / srcW) * targetW);
    const scaleY = (y) => Math.round(((y || 0) / srcH) * targetH);

    const x = scaleX(data.x);
    const y = scaleY(data.y);

    if (sock && !sock.destroyed) {
      switch (action) {
        case 'touch_down': {
          const prev = lastTouchState.get(serial);
          if (prev && prev.isDown) {
            sendScrcpyTouch(sock, 1, prev.x, prev.y, prev.width, prev.height);
          }
          lastTouchState.set(serial, { isDown: true, x, y, width: targetW, height: targetH, time: Date.now() });
          sendScrcpyTouch(sock, 0, x, y, targetW, targetH);
          return true;
        }
        case 'touch_move': {
          lastTouchState.set(serial, { isDown: true, x, y, width: targetW, height: targetH, time: Date.now() });
          sendScrcpyTouch(sock, 2, x, y, targetW, targetH);
          return true;
        }
        case 'touch_up': {
          lastTouchState.set(serial, { isDown: false, x, y, width: targetW, height: targetH, time: Date.now() });
          sendScrcpyTouch(sock, 1, x, y, targetW, targetH);
          return true;
        }
        case 'scroll':
          sendScrcpyScroll(sock, x, y, targetW, targetH, data.hScroll || 0, data.vScroll || 0);
          return true;
        case 'tap':
          sendScrcpyTouch(sock, 0, x, y, targetW, targetH);
          setTimeout(() => {
            const s = controlSockets.get(serial);
            if (s && !s.destroyed) {
              sendScrcpyTouch(s, 1, x, y, targetW, targetH);
            }
          }, 25);
          return true;
        case 'text':
          if (data && data.text) {
            return sendScrcpyText(sock, data.text);
          }
          return true;
        case 'key_event':
          if (data && data.keyCode !== undefined) {
            return sendScrcpyKeycode(sock, data.keyCode);
          }
          return true;
        case 'swipe': {
          const sx = scaleX(data.startX);
          const sy = scaleY(data.startY);
          const ex = scaleX(data.endX);
          const ey = scaleY(data.endY);
          const steps = 6;
          const duration = Math.min(120, Math.max(50, data.durationMs || 80));
          const interval = Math.floor(duration / steps);

          // Human-like ease-out bezier curve: starts fast, accelerates smoothly, decelerates into fling
          sendScrcpyTouch(sock, 0, sx, sy, targetW, targetH); // ACTION_DOWN

          for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const ease = 1 - Math.pow(1 - t, 3); // Cubic ease-out
            const curX = Math.round(sx + (ex - sx) * ease);
            const curY = Math.round(sy + (ey - sy) * ease);

            setTimeout(() => {
              const s = controlSockets.get(serial);
              if (s && !s.destroyed) {
                if (i < steps) {
                  sendScrcpyTouch(s, 2, curX, curY, targetW, targetH); // ACTION_MOVE
                } else {
                  sendScrcpyTouch(s, 2, ex, ey, targetW, targetH); // Final position
                  sendScrcpyTouch(s, 1, ex, ey, targetW, targetH); // ACTION_UP with natural inertia
                }
              }
            }, i * interval);
          }
          return true;
        }
        case 'back':
          sendScrcpyKeycode(sock, 4); // AKEYCODE_BACK
          return true;
        case 'home':
          sendScrcpyKeycode(sock, 3); // AKEYCODE_HOME
          return true;
        case 'recents':
          sendScrcpyKeycode(sock, 187); // AKEYCODE_APP_SWITCH
          return true;
        case 'power':
          sendScrcpyKeycode(sock, 26); // AKEYCODE_POWER
          // Trigger immediate keyframe generation upon screen power toggle
          setTimeout(() => {
            const s = controlSockets.get(serial);
            if (s && !s.destroyed) {
              try { s.write(Buffer.from([17])); } catch (e) {}
            }
          }, 150);
          return true;
        case 'volume_up':
          sendScrcpyKeycode(sock, 24); // AKEYCODE_VOLUME_UP
          return true;
        case 'volume_down':
          sendScrcpyKeycode(sock, 25); // AKEYCODE_VOLUME_DOWN
          return true;
        case 'reboot':
          try {
            execFile(adbPath, ['-s', serial, 'reboot'], () => {});
          } catch (e) {}
          return true;
      }
    }

    // Fallback via high-speed interactive shell
    switch (action) {
      case 'scroll': {
        const v = data.vScroll || 0;
        const startY = v < 0 ? 1100 : 500;
        const endY = v < 0 ? 400 : 1200;
        sendShellInput(serial, `input swipe 360 ${startY} 360 ${endY} 150`);
        return true;
      }
      case 'tap': {
        const x = Math.round(data.x);
        const y = Math.round(data.y);
        sendShellInput(serial, `input tap ${x} ${y}`);
        return true;
      }
      case 'touch_down':
      case 'touch_move':
      case 'touch_up':
        return true;
      case 'swipe': {
        const { startX, startY, endX, endY, durationMs } = data;
        const dur = Math.max(100, Math.round(durationMs || 150));
        sendShellInput(serial, `input swipe ${Math.round(startX)} ${Math.round(startY)} ${Math.round(endX)} ${Math.round(endY)} ${dur}`);
        return true;
      }
      case 'back':
        sendShellInput(serial, 'input keyevent 4');
        return true;
      case 'home':
        sendShellInput(serial, 'input keyevent 3');
        return true;
      case 'recents':
        sendShellInput(serial, 'input keyevent 187');
        return true;
      case 'power':
        sendShellInput(serial, 'input keyevent 26');
        return true;
      case 'volume_up':
        sendShellInput(serial, 'input keyevent 24');
        return true;
      case 'volume_down':
        sendShellInput(serial, 'input keyevent 25');
        return true;
      case 'reboot':
        try {
          execFile(adbPath, ['-s', serial, 'reboot'], () => {});
        } catch (e) {}
        return true;
      case 'rotate':
        const r = data && data.orientation === 'landscape' ? '1' : '0';
        sendShellInput(serial, `settings put system user_rotation ${r}`);
        return true;
      case 'text':
        const escaped = (data.text || '').replace(/([^\w])/g, '\\$1');
        sendShellInput(serial, `input text ${escaped}`);
        return true;
      case 'key_event':
        sendShellInput(serial, `input keyevent ${data.keyCode}`);
        return true;
    }
  } catch (e) {
    console.error(`[Agent] Error injecting ${action}:`, e.message);
  }
  return false;
}

// Discovered devices & streaming loops
let registeredDevices = new Map(); // deviceId -> serial
let deviceIdToSerial = new Map();  // deviceId -> serial
let serialToDeviceIds = new Map(); // serial -> Set<deviceId>
let serialToActiveDeviceId = new Map(); // serial -> active streaming deviceId
let activeStreams = new Map();     // serial -> { stop, serial }
let cachedKeyframes = new Map();   // serial -> Buffer
let ws = null;
let isReconnecting = false;

function connectWebSocket() {
  if (!config.agentAuthToken) {
    console.warn('[StreamBridge] Missing agentAuthToken in credentials. Waiting for enrollment...');
    return;
  }

  const wsProto = config.backendUrl.startsWith('https') ? 'wss:' : 'ws:';
  const host = config.backendUrl.replace(/^https?:\/\//, '');
  const wsUrl = `${wsProto}//${host}/ws?token=${encodeURIComponent(config.agentAuthToken)}&type=agent`;

  console.log(`[StreamBridge] Connecting to Cloud Signaling: ${wsProto}//${host}/ws...`);

  let pingInterval = null;

  try {
    ws = new WsClient(wsUrl);

    ws.onopen = () => {
      console.log('[StreamBridge] 🟢 Connected to Cloud Signaling Gateway successfully.');
      isReconnecting = false;

      // Active heartbeat ping every 15s to keep Cloudflare / Nginx tunnels permanently alive
      if (pingInterval) clearInterval(pingInterval);
      pingInterval = setInterval(() => {
        if (ws && ws.readyState === 1) {
          try {
            if (typeof ws.ping === 'function') {
              ws.ping();
            } else {
              ws.send(JSON.stringify({ type: 'ping' }));
            }
          } catch (e) {}
        }
      }, 15000);

      // Re-register each physical phone exactly once with its active cloud device ID
      const registeredSerials = new Set();
      for (const [devId, ser] of registeredDevices.entries()) {
        if (registeredSerials.has(ser)) continue;
        registeredSerials.add(ser);
        const activeDevId = serialToActiveDeviceId.get(ser) || devId;
        console.log(`[StreamBridge] Registering active device producer: ${activeDevId} (${ser})`);
        ws.send(JSON.stringify({ type: 'agent-register-device', deviceId: activeDevId, serial: ser }));
      }
    };

    ws.onmessage = async (event) => {
      try {
        const text = typeof event.data === 'string' ? event.data : event.data.toString();
        const msg = JSON.parse(text);
        await handleMessage(msg);
      } catch (e) {
        console.error('[StreamBridge] Error handling message:', e.message);
      }
    };

    ws.onclose = (e) => {
      if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
      console.warn(`[StreamBridge] 🟡 WebSocket disconnected (code: ${e.code || 'closed'}). Reconnecting in 3s...`);
      // DO NOT stop scrcpy streams on WS disconnect — keep video pipeline alive for seamless viewer reconnects
      scheduleReconnect();
    };

    ws.onerror = (e) => {
      if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
      console.warn('[StreamBridge] 🔴 WebSocket error:', e.message || 'connection failed');
    };
  } catch (err) {
    console.error('[StreamBridge] Connection error:', err.message);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (isReconnecting) return;
  isReconnecting = true;
  setTimeout(() => {
    connectWebSocket();
  }, 3000);
}

async function handleMessage(msg) {
  switch (msg.type) {
    case 'start-stream':
    case 'request-stream': {
      const { deviceId, serial } = msg;
      const targetSerial = serial || deviceIdToSerial.get(deviceId) || registeredDevices.get(deviceId) || (activeStreams.keys().next().value) || '';
      console.log(`[StreamBridge] 📺 Received stream request for device: ${deviceId} (${targetSerial})`);
      if (targetSerial) {
        if (deviceId) {
          serialToActiveDeviceId.set(targetSerial, deviceId);
        }
        // Force scrcpy to produce an immediate fresh IDR keyframe and config packet
        const ctrl = controlSockets.get(targetSerial);
        if (ctrl && !ctrl.destroyed) {
          try { ctrl.write(Buffer.from([17])); } catch (e) {}
        }
        const cached = cachedKeyframes.get(targetSerial);
        if (cached && ws && ws.readyState === 1) {
          const targetDevId = serialToActiveDeviceId.get(targetSerial) || deviceId;
          try { ws.send(Buffer.concat([Buffer.from(targetDevId, 'utf8'), cached])); } catch (e) {}
        }
        startStream(deviceId, targetSerial);
      }
      break;
    }

    case 'refresh-stream':
    case 'request-keyframe': {
      const { deviceId, serial } = msg;
      const targetSerial = serial || deviceIdToSerial.get(deviceId) || registeredDevices.get(deviceId) || (activeStreams.keys().next().value) || '';
      if (targetSerial) {
        const ctrl = controlSockets.get(targetSerial);
        if (ctrl && !ctrl.destroyed) {
          try { ctrl.write(Buffer.from([17])); } catch (e) {}
        }
        const cached = cachedKeyframes.get(targetSerial);
        if (cached && ws && ws.readyState === 1) {
          const targetDevId = serialToActiveDeviceId.get(targetSerial) || deviceId;
          try { ws.send(Buffer.concat([Buffer.from(targetDevId, 'utf8'), cached])); } catch (e) {}
        }
      }
      break;
    }

    case 'idle-stream': {
      const { deviceId } = msg;
      console.log(`[StreamBridge] ⏸️ Received idle-stream request for device: ${deviceId}`);
      break;
    }

    case 'control-input': {
      const { deviceId, action, data } = msg;
      const serial = msg.serial || deviceIdToSerial.get(deviceId) || registeredDevices.get(deviceId) || (activeStreams.keys().next().value) || (shellSessions.keys().next().value) || '';
      if (serial) {
        await injectInput(serial, action, data);
      }
      break;
    }
  }
}

function startStream(deviceId, targetSerial) {
  const serial = targetSerial || deviceIdToSerial.get(deviceId) || registeredDevices.get(deviceId) || (activeStreams.keys().next().value) || '';
  if (!serial) {
    console.warn(`[StreamBridge] Cannot start stream for ${deviceId}: no serial mapped.`);
    return;
  }

  ensureDeviceAwake(serial);

  deviceIdToSerial.set(deviceId, serial);
  serialToActiveDeviceId.set(serial, deviceId);
  if (!serialToDeviceIds.has(serial)) {
    serialToDeviceIds.set(serial, new Set());
  }
  serialToDeviceIds.get(serial).add(deviceId);

  const deviceIdBuf = Buffer.from(deviceId, 'utf8');

  // If capture pipeline is already running for this physical device serial, push cached keyframe instantly to viewer
  if (activeStreams.has(serial)) {
    const cached = cachedKeyframes.get(serial);
    if (cached && ws && ws.readyState === 1) {
      console.log(`[StreamBridge] ⚡ Immediate sync: pushing cached keyframe to viewer for ${serial}`);
      ws.send(Buffer.concat([deviceIdBuf, cached]));
    }
    return;
  }

  console.log(`[StreamBridge] 🚀 Launching pure 60 FPS hardware scrcpy stream for ${deviceId} (${serial})...`);

  let active = true;
  let scrcpyProc = null;    // Video + Control process (always stable)
  let audioProc = null;     // Audio-only process (independent, crash-safe)
  let server = null;
  let audioServer = null;
  let videoSock = null;
  let audioSock = null;
  let controlSock = null;
  let framesSent = 0;
  let lastStatsTime = Date.now();
  let cachedConfig = null;
  let scid = '';
  let audioScid = '';

  const streamObj = {
    stop: () => {
      active = false;
      activeStreams.delete(serial);
      if (controlSock) { controlSock.destroy(); controlSockets.delete(serial); }
      if (videoSock) { try { videoSock.destroy(); } catch (e) {} }
      if (audioSock) { try { audioSock.destroy(); } catch (e) {} }
      if (server) { try { server.close(); } catch (e) {} }
      if (audioServer) { try { audioServer.close(); } catch (e) {} }
      if (scrcpyProc) { try { scrcpyProc.kill(); } catch (e) {} }
      if (audioProc) { try { audioProc.kill(); } catch (e) {} }
      if (scid) {
        execFile(adbPath, ['-s', serial, 'reverse', '--remove', `localabstract:scrcpy_${scid}`], () => {});
      }
      if (audioScid) {
        execFile(adbPath, ['-s', serial, 'reverse', '--remove', `localabstract:scrcpy_${audioScid}`], () => {});
      }
    },
    serial,
  };
  activeStreams.set(serial, streamObj);

  // ─── Shared helpers (defined before async IIFE so both pipelines can use them) ───
  const AUD_PREFIX = Buffer.from('AUD:');
  let cachedTargetDevId = '';
  let targetDevIdBuf = Buffer.alloc(0);
  function getTargetDevIdBuf(devId) {
    if (devId !== cachedTargetDevId) {
      cachedTargetDevId = devId;
      targetDevIdBuf = Buffer.from(devId, 'utf8');
    }
    return targetDevIdBuf;
  }

  // ─── Video socket handler ───────────────────────────────────────────────────────
  function setupVideoSocket(sock) {
    let buf = Buffer.alloc(0);
    let parsedHeader = false;

    sock.on('data', (chunk) => {
      if (!active) return;
      buf = Buffer.concat([buf, chunk]);

      if (!parsedHeader && buf.length >= 76) {
        const deviceName = buf.subarray(0, 64).toString('utf8').replace(/\0/g, '');
        const codec = buf.subarray(64, 68).toString('utf8');
        const width = buf.readUInt32BE(68);
        const height = buf.readUInt32BE(72);
        deviceDimensions.set(serial, { width, height });
        console.log(`[StreamBridge] 📱 Scrcpy Video Ready: ${deviceName} [${width}x${height}, ${codec}]`);
        buf = buf.subarray(76);
        parsedHeader = true;

        if (ws && ws.readyState === 1) {
          const targetDevId = serialToActiveDeviceId.get(serial) || deviceId;
          try {
            ws.send(JSON.stringify({ type: 'device-dimensions', deviceId: targetDevId, serial, width, height }));
          } catch (e) {}
        }
      }

      if (parsedHeader) {
        while (buf.length >= 12) {
          const rawHeader = buf.readBigUInt64BE(0);
          const size = buf.readUInt32BE(8);
          if (buf.length < 12 + size) break;

          const isConfig = (rawHeader & 0x8000000000000000n) !== 0n;
          const isKeyframe = (rawHeader & 0x4000000000000000n) !== 0n;
          const packetData = buf.subarray(12, 12 + size);
          buf = buf.subarray(12 + size);

          if (isConfig) {
            cachedConfig = packetData;
          } else if (isKeyframe) {
            const fullKeyframe = cachedConfig ? Buffer.concat([cachedConfig, packetData]) : packetData;
            cachedKeyframes.set(serial, fullKeyframe);
            if (ws && ws.readyState === 1) {
              const targetDevId = serialToActiveDeviceId.get(serial) || deviceId;
              if (targetDevId) {
                try { ws.send(Buffer.concat([getTargetDevIdBuf(targetDevId), fullKeyframe])); } catch (e) {}
              }
            }
            framesSent++;
          } else {
            if (ws && ws.readyState === 1) {
              // 256KB buffer limit: guarantees stream latency never exceeds ~100ms
              if (ws.bufferedAmount <= 256 * 1024) {
                const targetDevId = serialToActiveDeviceId.get(serial) || deviceId;
                if (targetDevId) {
                  try { ws.send(Buffer.concat([getTargetDevIdBuf(targetDevId), packetData])); } catch (e) {}
                }
                framesSent++;
              } else {
                // Network congestion: request immediate IDR keyframe to cleanly resume at live edge
                const ctrl = controlSockets.get(serial);
                if (ctrl && !ctrl.destroyed) {
                  try { ctrl.write(Buffer.from([17])); } catch (e) {}
                }
              }
            }
          }

          const now = Date.now();
          if (now - lastStatsTime >= 3000) {
            const fps = Math.round((framesSent * 1000) / (now - lastStatsTime));
            console.log(`[Stream] ⚡ scrcpy hardware stream: ~${fps} FPS | ${serial}`);
            framesSent = 0;
            lastStatsTime = now;
          }
        }
      }
    });

    sock.on('error', () => {});
    sock.on('close', () => {
      if (active) setTimeout(() => startStream(deviceId, serial), 1000);
    });
  }

  // ─── Audio socket handler ───────────────────────────────────────────────────────
  function setupAudioSocket(sock) {
    let buf = Buffer.alloc(0);
    let parsedAudioHeader = false;
    let audioBatch = Buffer.alloc(0);
    let lastAudioFlush = Date.now();

    function flushAudio() {
      if (audioBatch.length === 0) return;
      if (ws && ws.readyState === 1 && ws.bufferedAmount <= 256 * 1024) {
        const targetDevId = serialToActiveDeviceId.get(serial) || deviceId;
        if (targetDevId) {
          try {
            ws.send(Buffer.concat([getTargetDevIdBuf(targetDevId), AUD_PREFIX, audioBatch]));
          } catch (e) {}
        }
      }
      audioBatch = Buffer.alloc(0);
      lastAudioFlush = Date.now();
    }

    sock.on('data', (chunk) => {
      if (!active) return;
      try {
        buf = Buffer.concat([buf, chunk]);

        // Scrcpy stream socket sends: 64-byte deviceName + 4-byte codec = 68 bytes total header
        if (!parsedAudioHeader && buf.length >= 68) {
          const deviceName = buf.subarray(0, 64).toString('utf8').replace(/\0/g, '');
          const codec = buf.subarray(64, 68).toString('utf8').replace(/\0/g, '');
          console.log(`[StreamBridge] 🔊 Audio-only scrcpy ready: ${deviceName} [codec: ${codec || 'raw'}] for ${serial}`);
          buf = buf.subarray(68);
          parsedAudioHeader = true;
        }

        if (parsedAudioHeader) {
          while (buf.length >= 12) {
            const rawHeader = buf.readBigUInt64BE(0);
            const isConfig = (rawHeader & 0x8000000000000000n) !== 0n;
            const size = buf.readUInt32BE(8);
            if (buf.length < 12 + size) break;

            const audioData = buf.subarray(12, 12 + size);
            buf = buf.subarray(12 + size);

            if (isConfig || audioData.length === 0) continue;

            audioBatch = Buffer.concat([audioBatch, audioData]);
            const now = Date.now();
            // Batch ~20-30ms audio packets for low-latency, uninterrupted playback
            if (audioBatch.length >= 4096 || now - lastAudioFlush >= 25) {
              flushAudio();
            }
          }
        }
      } catch (audioErr) {
        console.warn('[Audio parser warning]', audioErr.message);
      }
    });

    sock.on('error', (err) => console.warn(`[Audio] socket error for ${serial}:`, err.message));
    sock.on('close', () => {
      audioSock = null;
      console.log(`[Audio] socket closed for ${serial}`);
    });
  }

  // ─── PIPELINE 1: Video + Control (always rock-solid, audio=false) ───────────────
  (async () => {
    try {
      // Push scrcpy-server.jar once
      if (scrcpyServerJarPath) {
        await execAdb(['-s', serial, 'push', scrcpyServerJarPath, '/data/local/tmp/scrcpy-server.jar']);
      }

      // Ephemeral port + ADB reverse tunnel (scid must be <= 0x7fffffff to avoid Java Integer.parseInt overflow)
      scid = Math.floor(Math.random() * 0x7fffffff).toString(16).padStart(8, '0');
      server = net.createServer();
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const port = server.address().port;
      await execAdb(['-s', serial, 'reverse', `localabstract:scrcpy_${scid}`, `tcp:${port}`]);

      // Accept exactly 2 sockets: Video → Control
      server.on('connection', (sock) => {
        if (!active) { sock.destroy(); return; }
        try { sock.setNoDelay(true); } catch (e) {}
        sock.on('error', (err) => console.warn(`[Video/Control] Socket error on ${serial}:`, err.message));

        if (!videoSock) {
          videoSock = sock;
          setupVideoSocket(sock);
        } else if (!controlSock) {
          controlSock = sock;
          controlSockets.set(serial, sock);
          console.log(`[StreamBridge] 🎮 Control channel active for ${serial}`);
        }
      });

      server.on('error', (err) => console.error(`[StreamBridge] Video server error for ${serial}:`, err.message));

      // Scrcpy: video + control ONLY — zero audio risk
      scrcpyProc = spawn(adbPath, [
        '-s', serial, 'shell',
        'CLASSPATH=/data/local/tmp/scrcpy-server.jar',
        'app_process', '/', 'com.genymobile.scrcpy.Server',
        '3.3.4',
        `scid=${scid}`,
        'log_level=info',
        'cleanup=false',
        'video_bit_rate=2500000',
        'max_fps=60',
        'stay_awake=true',
        'control=true',
        'audio=false',
        'video_codec_options=i-frame-interval:int=1,low-latency:int=1',
        'downsize_on_error=true',
      ]);

      scrcpyProc.stdout.on('data', (d) => {
        const text = d.toString().trim();
        if (text.includes('Device:') || text.includes('ERROR') || text.includes('WARN')) {
          console.log('[scrcpy-video]', text);
        }
      });
      scrcpyProc.stderr.on('data', (d) => {
        const text = d.toString().trim();
        if (text) console.warn('[scrcpy-video err]', text);
      });
      scrcpyProc.on('error', (err) => console.error(`[StreamBridge] Video scrcpy error for ${serial}:`, err.message));
      scrcpyProc.on('exit', (code) => {
        console.warn(`[StreamBridge] Video scrcpy exited for ${serial} (code: ${code}). Restarting in 1s...`);
        if (active) {
          activeStreams.delete(serial);
          setTimeout(() => startStream(deviceId, serial), 1000);
        }
      });

      // ─── PIPELINE 2: Audio-only (completely independent, crash-safe) ───────────
      // Delay 2s so video+control is fully connected before audio starts
      setTimeout(() => startAudioPipeline(), 2000);

    } catch (err) {
      console.error(`[StreamBridge] Video pipeline error for ${serial}:`, err.message);
      activeStreams.delete(serial);
      if (active) setTimeout(() => startStream(deviceId, serial), 2000);
    }
  })();

  // ─── Audio pipeline — runs entirely independently of video ─────────────────────
  // If audio fails or crashes, video+control keep running without interruption.
  function startAudioPipeline() {
    if (!active) return;

    // Clean up any previous audio process/server
    if (audioProc) { try { audioProc.kill(); } catch (e) {} audioProc = null; }
    if (audioServer) { try { audioServer.close(); } catch (e) {} audioServer = null; }
    if (audioSock) { try { audioSock.destroy(); } catch (e) {} audioSock = null; }
    if (audioScid) {
      execFile(adbPath, ['-s', serial, 'reverse', '--remove', `localabstract:scrcpy_${audioScid}`], () => {});
    }

    (async () => {
      try {
        // Separate scid (<= 0x7fffffff to avoid Java Integer.parseInt overflow)
        audioScid = Math.floor(Math.random() * 0x7fffffff).toString(16).padStart(8, '0');
        audioServer = net.createServer();
        await new Promise((resolve) => audioServer.listen(0, '127.0.0.1', resolve));
        const audioPort = audioServer.address().port;
        await execAdb(['-s', serial, 'reverse', `localabstract:scrcpy_${audioScid}`, `tcp:${audioPort}`]);

        console.log(`[StreamBridge] 🎵 Starting audio-only scrcpy pipeline for ${serial}...`);

        // Accept exactly 1 socket: Audio only (video=false → no video socket, control=false → no control socket)
        audioServer.on('connection', (sock) => {
          if (!active) { sock.destroy(); return; }
          try { sock.setNoDelay(true); } catch (e) {}
          if (!audioSock) {
            audioSock = sock;
            setupAudioSocket(sock);
          } else {
            sock.destroy(); // unexpected extra connection
          }
        });

        audioServer.on('error', (err) => {
          console.warn(`[Audio] Server error for ${serial}:`, err.message);
        });

        // audio-only scrcpy: video=false, control=false → opens exactly 1 socket (audio)
        audioProc = spawn(adbPath, [
          '-s', serial, 'shell',
          'CLASSPATH=/data/local/tmp/scrcpy-server.jar',
          'app_process', '/', 'com.genymobile.scrcpy.Server',
          '3.3.4',
          `scid=${audioScid}`,
          'log_level=warn',
          'cleanup=false',
          'video=false',
          'audio=true',
          'audio_codec=raw',
          'audio_source=output', // Captures full system audio and mutes physical device speakers
          'control=false',
        ]);

        audioProc.stdout.on('data', (d) => {
          const text = d.toString().trim();
          if (text.includes('ERROR')) console.warn('[scrcpy-audio]', text);
        });
        audioProc.stderr.on('data', (d) => {
          const text = d.toString().trim();
          if (text && !text.includes('INFO')) console.warn('[scrcpy-audio err]', text);
        });
        audioProc.on('error', (err) => {
          console.warn(`[Audio] scrcpy-audio error for ${serial}:`, err.message);
        });
        audioProc.on('exit', (code) => {
          audioProc = null;
          audioSock = null;
          if (active) {
            // Audio crashed → retry after 5s without touching video
            console.warn(`[Audio] scrcpy-audio exited (code: ${code}) for ${serial}. Retrying audio in 5s...`);
            setTimeout(() => startAudioPipeline(), 5000);
          }
        });

      } catch (audioErr) {
        // Audio pipeline failed to start → retry quietly, video is unaffected
        console.warn(`[Audio] Pipeline start failed for ${serial}: ${audioErr.message}. Retrying in 8s...`);
        if (active) setTimeout(() => startAudioPipeline(), 8000);
      }
    })();
  }
}

function stopStream(deviceId) {
  const serial = deviceIdToSerial.get(deviceId);
  if (serial) {
    const stream = activeStreams.get(serial);
    if (stream) {
      if (stream.stop) stream.stop();
      activeStreams.delete(serial);
      console.log(`[StreamBridge] Stopped stream for device: ${deviceId} (${serial})`);
    }
  }
}

function stopAllStreams() {
  for (const serial of activeStreams.keys()) {
    const stream = activeStreams.get(serial);
    if (stream && stream.stop) stream.stop();
  }
  activeStreams.clear();
}

// Device discovery & Cloud Sync
let loggedNoDevices = false;
let knownSerials = new Set();

async function discoverAndSync() {
  try {
    const raw = await execAdb(['devices', '-l']);
    const lines = raw.split('\n');
    const devices = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('List of devices') || trimmed.startsWith('*') || trimmed.startsWith('daemon')) continue;

      const parts = trimmed.split(/\s+/);
      if (parts.length < 2) continue;

      const serial = parts[0];
      const state = parts[1];

      if (state !== 'device') continue;

      let model = 'Android Phone';
      let manufacturer = 'Generic';
      let androidVersion = '14';
      let screenWidth = 720;
      let screenHeight = 1600;

      try {
        const props = await execAdb(['-s', serial, 'shell', 'getprop'], 5000);
        const mModel = props.match(/\[ro\.product\.model\]:\s*\[(.*?)\]/);
        if (mModel) model = mModel[1];
        const mMfg = props.match(/\[ro\.product\.manufacturer\]:\s*\[(.*?)\]/);
        if (mMfg) manufacturer = mMfg[1];
        const mVer = props.match(/\[ro\.build\.version\.release\]:\s*\[(.*?)\]/);
        if (mVer) androidVersion = mVer[1];

        const sizeOut = await execAdb(['-s', serial, 'shell', 'wm', 'size'], 3000);
        const mSize = sizeOut.match(/Physical size:\s*(\d+)x(\d+)/) || sizeOut.match(/size:\s*(\d+)x(\d+)/);
        if (mSize) {
          screenWidth = parseInt(mSize[1], 10);
          screenHeight = parseInt(mSize[2], 10);
        }
      } catch (e) {}

      devices.push({
        adbSerial: serial,
        deviceName: `${manufacturer} ${model}`.trim(),
        model,
        manufacturer,
        androidVersion,
        screenWidth,
        screenHeight,
        connectionType: serial.includes(':') ? 'wifi' : 'usb',
        status: 'online',
      });
    }

    if (devices.length === 0) {
      if (!loggedNoDevices) {
        console.log('[Device] ⚠️ No Android devices detected. Connect a phone via USB with USB Debugging enabled.');
        loggedNoDevices = true;
      }
      return;
    }

    loggedNoDevices = false;

    // Log newly detected devices
    for (const d of devices) {
      if (!knownSerials.has(d.adbSerial)) {
        console.log(`[Device] 📱 Discovered: ${d.deviceName} (${d.adbSerial}) [${d.screenWidth}x${d.screenHeight}]`);
        knownSerials.add(d.adbSerial);
      }
    }

    if (config.agentId) {
      const resp = await fetch(`${config.backendUrl}/api/devices/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: config.agentId,
          organizationId: config.organizationId,
          devices,
        }),
      });

      if (resp.ok) {
        const data = await resp.json();
        if (Array.isArray(data.devices)) {
          for (const d of data.devices) {
            const devId = d.id;
            const ser = d.adb_serial || d.adbSerial;
            const isNew = !registeredDevices.has(devId);
            if (isNew) {
              console.log(`[Device] ☁️ Synced with Cloud Fleet: ${d.device_name} (ID: ${devId})`);
              // Clear stale ID mappings for this serial
              for (const [oldId, oldSer] of registeredDevices.entries()) {
                if (oldSer === ser && oldId !== devId) {
                  registeredDevices.delete(oldId);
                  deviceIdToSerial.delete(oldId);
                }
              }
              registeredDevices.set(devId, ser);
              deviceIdToSerial.set(devId, ser);
              serialToActiveDeviceId.set(ser, devId);
              if (!serialToDeviceIds.has(ser)) {
                serialToDeviceIds.set(ser, new Set());
              }
              serialToDeviceIds.get(ser).add(devId);

              if (ws && ws.readyState === 1) {
                ws.send(JSON.stringify({
                  type: 'agent-register-device',
                  deviceId: devId,
                  serial: ser,
                }));
              }
            } else {
              registeredDevices.set(devId, ser);
              deviceIdToSerial.set(devId, ser);
              if (!serialToActiveDeviceId.has(ser)) {
                serialToActiveDeviceId.set(ser, devId);
              }
            }

            // Initiate or map screen stream for this device serial only if not yet active
            if (!activeStreams.has(ser)) {
              console.log(`[StreamBridge] 🚀 Auto-starting video stream for ${d.device_name} (${ser})...`);
              startStream(devId, ser);
            }
          }
        }
      } else {
        console.warn(`[Sync] Sync warning: HTTP ${resp.status}`);
      }
    }
  } catch (err) {
    // Keep loop resilient
  }
}

// Periodic heartbeat
async function sendHeartbeat() {
  if (!config.agentId) return;
  try {
    await fetch(`${config.backendUrl}/api/agents/${config.agentId}/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId: config.organizationId }),
    });
  } catch (e) {}
}

// Start agent
console.log('[Agent] Initializing background polling loops (Device discovery every 3s)...');
connectWebSocket();
discoverAndSync();
setInterval(discoverAndSync, 3000);
setInterval(sendHeartbeat, 10000);

console.log('===============================================================================');
console.log('       🟢 VERTEX SAAS AGENT IS OPERATIONAL & MONITORING LIVE ACTIVITY          ');
console.log('===============================================================================');
