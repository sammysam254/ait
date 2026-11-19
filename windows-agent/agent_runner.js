/**
 * Standalone Vertex SaaS Host Agent Runner
 * Zero external dependencies: Uses built-in Node.js APIs (WebSocket, fetch, child_process, fs, path).
 */
const { execFile, execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');

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
    // 32-byte SC_CONTROL_MSG_TYPE_INJECT_TOUCH_EVENT (type = 2)
    const msg = Buffer.alloc(32);
    msg.writeUInt8(2, 0); // type: INJECT_TOUCH_EVENT
    msg.writeUInt8(action, 1); // 0=DOWN, 1=UP, 2=MOVE
    msg.writeBigUInt64BE(0xfffffffffffffffen, 2); // SC_POINTER_ID_GENERIC_FINGER (UINT64_C(-2))
    msg.writeUInt32BE(Math.max(0, Math.min(width, Math.round(x))), 10);
    msg.writeUInt32BE(Math.max(0, Math.min(height, Math.round(y))), 14);
    msg.writeUInt16BE(width, 18);
    msg.writeUInt16BE(height, 20);
    msg.writeUInt16BE(action === 1 ? 0 : 0xffff, 22); // pressure (1.0 when touching, 0 when released)
    msg.writeUInt32BE(0, 24); // action_button: 0 for touch events
    msg.writeUInt32BE(0, 28); // buttons_state: 0 for native touchscreen finger events
    sock.write(msg);
    return true;
  } catch (e) {
    return false;
  }
}

function sendScrcpyKeycode(sock, keycode) {
  try {
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

async function injectInput(serial, action, data) {
  try {
    const sock = controlSockets.get(serial);
    const screenWidth = data.width || 720;
    const screenHeight = data.height || 1600;

    if (action === 'touch_down' || action === 'tap') {
      wakePhone(serial);
    }

    if (sock && !sock.destroyed) {
      switch (action) {
        case 'touch_down':
          sendScrcpyTouch(sock, 0, data.x, data.y, screenWidth, screenHeight);
          return true;
        case 'touch_move':
          sendScrcpyTouch(sock, 2, data.x, data.y, screenWidth, screenHeight);
          return true;
        case 'touch_up':
          sendScrcpyTouch(sock, 1, data.x, data.y, screenWidth, screenHeight);
          return true;
        case 'scroll':
          sendScrcpyScroll(sock, data.x, data.y, screenWidth, screenHeight, data.hScroll || 0, data.vScroll || 0);
          return true;
        case 'tap':
          sendScrcpyTouch(sock, 0, data.x, data.y, screenWidth, screenHeight);
          setTimeout(() => {
            if (controlSockets.has(serial)) {
              sendScrcpyTouch(controlSockets.get(serial), 1, data.x, data.y, screenWidth, screenHeight);
            }
          }, 35);
          return true;
        case 'back':
          sendScrcpyKeycode(sock, 4); // AKEYCODE_BACK
          return true;
        case 'home':
          sendScrcpyKeycode(sock, 3); // AKEYCODE_HOME
          return true;
        case 'recents':
          sendScrcpyKeycode(sock, 187); // AKEYCODE_APP_SWITCH
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
          try { ws.ping(); } catch (e) {}
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
      stopAllStreams();
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
    case 'start-stream': {
      const { deviceId, serial } = msg;
      const targetSerial = serial || deviceIdToSerial.get(deviceId) || registeredDevices.get(deviceId) || (activeStreams.keys().next().value) || '';
      console.log(`[StreamBridge] 📺 Received start-stream request for device: ${deviceId} (${targetSerial})`);
      if (targetSerial) {
        ensureDeviceAwake(targetSerial);
        if (deviceId) {
          serialToActiveDeviceId.set(targetSerial, deviceId);
        }
        startStream(deviceId, targetSerial);
      }
      break;
    }

    case 'request-keyframe': {
      const { deviceId, serial } = msg;
      const targetSerial = serial || deviceIdToSerial.get(deviceId) || registeredDevices.get(deviceId) || (activeStreams.keys().next().value) || '';
      const cached = cachedKeyframes.get(targetSerial);
      if (cached && ws && ws.readyState === 1) {
        const targetDevId = serialToActiveDeviceId.get(targetSerial) || deviceId;
        if (targetDevId) {
          ws.send(Buffer.concat([Buffer.from(targetDevId, 'utf8'), cached]));
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
  let scrcpyProc = null;
  let server = null;
  let videoSock = null;
  let audioSock = null;
  let controlSock = null;
  let framesSent = 0;
  let lastStatsTime = Date.now();
  let cachedConfig = null;
  let scid = '';

  const streamObj = {
    stop: () => {
      active = false;
      activeStreams.delete(serial);
      if (controlSock) { controlSock.destroy(); controlSockets.delete(serial); }
      if (videoSock) videoSock.destroy();
      if (audioSock) audioSock.destroy();
      if (server) server.close();
      if (scrcpyProc) {
        try { scrcpyProc.kill(); } catch (e) {}
      }
      if (scid) {
        execFile(adbPath, ['-s', serial, 'reverse', '--remove', `localabstract:scrcpy_${scid}`], () => {});
      }
    },
    serial,
  };
  activeStreams.set(serial, streamObj);

  (async () => {
    try {
      // 1. Ensure scrcpy-server.jar is pushed to phone
      if (scrcpyServerJarPath) {
        await execAdb(['-s', serial, 'push', scrcpyServerJarPath, '/data/local/tmp/scrcpy-server.jar']);
      }

      // 2. Create local reverse TCP server on ephemeral port (avoids Win 10013 port conflicts)
      scid = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
      server = net.createServer();
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const port = server.address().port;

      // 3. Set up ADB reverse tunnel
      await execAdb(['-s', serial, 'reverse', `localabstract:scrcpy_${scid}`, `tcp:${port}`]);

      // 4. Accept the 3 scrcpy sockets (Video -> Audio -> Control)
      server.on('connection', (sock) => {
        if (!active) {
          sock.destroy();
          return;
        }

        try { sock.setNoDelay(true); } catch (e) {}

        if (!videoSock) {
          videoSock = sock;
          setupVideoSocket(sock);
        } else if (!audioSock) {
          audioSock = sock;
          setupAudioSocket(sock);
        } else if (!controlSock) {
          controlSock = sock;
          controlSockets.set(serial, sock);
          console.log(`[StreamBridge] 🎮 Native Scrcpy Control channel active for ${serial} (instant no-delay)`);
        }
      });

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
          }

          if (parsedHeader) {
            while (buf.length >= 12) {
              const rawHeader = buf.readBigUInt64BE(0);
              const size = buf.readUInt32BE(8);

              if (buf.length < 12 + size) {
                break; // Wait for full frame
              }

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
                    ws.send(Buffer.concat([Buffer.from(targetDevId, 'utf8'), fullKeyframe]));
                  }
                }
                framesSent++;
              } else {
                // Complete delta frame
                if (ws && ws.readyState === 1) {
                  // Congestion backpressure: if socket has > 256KB buffered, skip delta frame to keep edge smooth
                  if (ws.bufferedAmount <= 256 * 1024) {
                    const targetDevId = serialToActiveDeviceId.get(serial) || deviceId;
                    if (targetDevId) {
                      ws.send(Buffer.concat([Buffer.from(targetDevId, 'utf8'), packetData]));
                    }
                    framesSent++;
                  }
                }
              }

              const now = Date.now();
              if (now - lastStatsTime >= 3000) {
                const fps = Math.round((framesSent * 1000) / (now - lastStatsTime));
                console.log(`[Stream] ⚡ scrcpy pure 60 FPS hardware stream: ~${fps} FPS | ${serial}`);
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

      function setupAudioSocket(sock) {
        let buf = Buffer.alloc(0);
        let parsedAudioHeader = false;

        sock.on('data', (chunk) => {
          if (!active) return;
          buf = Buffer.concat([buf, chunk]);

          if (!parsedAudioHeader && buf.length >= 4) {
            const codec = buf.subarray(0, 4).toString('utf8');
            console.log(`[StreamBridge] 🔊 Scrcpy Audio Ready [codec: ${codec}]`);
            buf = buf.subarray(4);
            parsedAudioHeader = true;
          }

          if (parsedAudioHeader) {
            while (buf.length >= 12) {
              const size = buf.readUInt32BE(8);
              if (buf.length < 12 + size) {
                break;
              }
              const audioData = buf.subarray(12, 12 + size);
              buf = buf.subarray(12 + size);

              if (ws && ws.readyState === 1 && audioData.length > 0) {
                // Audio backpressure protection
                if (ws.bufferedAmount < 512 * 1024) {
                  const targetDevId = serialToActiveDeviceId.get(serial) || deviceId;
                  if (targetDevId) {
                    ws.send(Buffer.concat([Buffer.from(targetDevId, 'utf8'), Buffer.from('AUD:'), audioData]));
                  }
                }
              }
            }
          }
        });

        sock.on('error', () => {});
      }

      // 5. Spawn scrcpy-server with smooth 60 FPS profile (4 Mbps, 1200px bounds, stay_awake=true)
      scrcpyProc = spawn(adbPath, [
        '-s', serial,
        'shell',
        'CLASSPATH=/data/local/tmp/scrcpy-server.jar',
        'app_process', '/', 'com.genymobile.scrcpy.Server',
        '3.3.4',
        `scid=${scid}`,
        'log_level=info',
        'cleanup=false',
        'max_size=1200',
        'video_bit_rate=4000000',
        'stay_awake=true',
        'control=true',
        'audio=true',
        'audio_codec=raw',
        'video_codec_options=i-frame-interval:int=1',
      ]);

      scrcpyProc.stdout.on('data', (d) => {
        const text = d.toString().trim();
        if (text.includes('Device:')) console.log('[scrcpy]', text);
      });

      scrcpyProc.on('exit', () => {
        if (active) {
          activeStreams.delete(serial);
          setTimeout(() => startStream(deviceId, serial), 1500);
        }
      });
    } catch (err) {
      console.error(`[StreamBridge] Pure scrcpy pipeline error for ${serial}:`, err.message);
      activeStreams.delete(serial);
      if (active) setTimeout(() => startStream(deviceId, serial), 3000);
    }
  })();
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
