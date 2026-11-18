/**
 * Standalone Vertex SaaS Host Agent Runner
 * Zero external dependencies: Uses built-in Node.js APIs (WebSocket, fetch, child_process, fs, path).
 */
const { execFile, execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

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

// Locate Scrcpy executable
function findScrcpy() {
  const candidates = [
    path.join(agentDir, 'scrcpy', 'scrcpy.exe'),
    path.join(__dirname, 'resources', 'scrcpy-win64-v3.3.4', 'scrcpy.exe'),
    path.join(__dirname, '..', 'resources', 'scrcpy-win64-v3.3.4', 'scrcpy.exe'),
    path.join(process.cwd(), 'resources', 'scrcpy-win64-v3.3.4', 'scrcpy.exe'),
    'scrcpy.exe',
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

const scrcpyPath = findScrcpy();
console.log('[Agent] Scrcpy Executable    :', scrcpyPath || 'Not found');

// Locate ADB
function findAdb() {
  const candidates = [
    path.join(agentDir, 'scrcpy', 'adb.exe'),
    path.join(__dirname, 'resources', 'scrcpy-win64-v3.3.4', 'adb.exe'),
    path.join(__dirname, '..', 'resources', 'scrcpy-win64-v3.3.4', 'adb.exe'),
    path.join(process.cwd(), 'resources', 'scrcpy-win64-v3.3.4', 'adb.exe'),
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

// Persistent interactive ADB shell per device for 0ms instantaneous control response
const shellSessions = new Map(); // serial -> ChildProcess

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

async function wakePhone(serial) {
  try {
    sendShellInput(serial, 'input keyevent 224'); // KEYCODE_WAKEUP
  } catch (e) {}
}

async function injectInput(serial, action, data) {
  try {
    switch (action) {
      case 'tap': {
        const x = Math.round(data.x);
        const y = Math.round(data.y);
        console.log(`[Input] 👉 Instant Tap (${x}, ${y}) on ${serial}`);
        sendShellInput(serial, `input tap ${x} ${y}`);
        return true;
      }
      case 'swipe': {
        const { startX, startY, endX, endY, durationMs } = data;
        const dur = Math.max(100, Math.round(durationMs || 150));
        console.log(`[Input] 👆 Smooth Swipe (${Math.round(startX)}, ${Math.round(startY)}) -> (${Math.round(endX)}, ${Math.round(endY)}) [${dur}ms] on ${serial}`);
        sendShellInput(serial, `input swipe ${Math.round(startX)} ${Math.round(startY)} ${Math.round(endX)} ${Math.round(endY)} ${dur}`);
        return true;
      }
      case 'back':
        console.log(`[Input] ◀️ Key: BACK on ${serial}`);
        sendShellInput(serial, 'input keyevent 4');
        return true;
      case 'home':
        console.log(`[Input] 🔘 Key: HOME on ${serial}`);
        sendShellInput(serial, 'input keyevent 3');
        return true;
      case 'recents':
        console.log(`[Input] ⏹️ Key: RECENTS on ${serial}`);
        sendShellInput(serial, 'input keyevent 187');
        return true;
      case 'rotate':
        const r = data && data.orientation === 'landscape' ? '1' : '0';
        console.log(`[Input] 🔄 Rotate: ${data && data.orientation === 'landscape' ? 'Landscape' : 'Portrait'} on ${serial}`);
        sendShellInput(serial, `settings put system user_rotation ${r}`);
        return true;
      case 'text':
        console.log(`[Input] ⌨️ Text: "${data.text}" on ${serial}`);
        const escaped = (data.text || '').replace(/([^\w])/g, '\\$1');
        sendShellInput(serial, `input text ${escaped}`);
        return true;
      case 'key_event':
        console.log(`[Input] 🔘 Keycode: ${data.keyCode} on ${serial}`);
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

  try {
    ws = new WsClient(wsUrl);

    ws.onopen = () => {
      console.log('[StreamBridge] 🟢 Connected to Cloud Signaling Gateway successfully.');
      isReconnecting = false;
      // Re-register all known devices
      for (const [devId, ser] of registeredDevices.entries()) {
        console.log(`[StreamBridge] Registering device producer: ${devId} (${ser})`);
        ws.send(JSON.stringify({ type: 'agent-register-device', deviceId: devId, serial: ser }));

        const cached = cachedKeyframes.get(ser);
        if (cached && ws.readyState === 1) {
          ws.send(Buffer.concat([Buffer.from(devId, 'utf8'), cached]));
        }
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
      console.warn(`[StreamBridge] 🟡 WebSocket disconnected (code: ${e.code || 'closed'}). Reconnecting in 3s...`);
      stopAllStreams();
      scheduleReconnect();
    };

    ws.onerror = (e) => {
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
      const targetSerial = serial || deviceIdToSerial.get(deviceId) || registeredDevices.get(deviceId) || '';
      console.log(`[StreamBridge] 📺 Received start-stream request for device: ${deviceId} (${targetSerial})`);
      startStream(deviceId, targetSerial);
      break;
    }

    case 'idle-stream': {
      const { deviceId } = msg;
      console.log(`[StreamBridge] ⏸️ Received idle-stream request for device: ${deviceId}`);
      break;
    }

    case 'control-input': {
      const { deviceId, action, data } = msg;
      const serial = msg.serial || deviceIdToSerial.get(deviceId) || registeredDevices.get(deviceId) || '';
      if (serial) {
        await injectInput(serial, action, data);
      }
      break;
    }
  }
}

function startStream(deviceId, targetSerial) {
  const serial = targetSerial || deviceIdToSerial.get(deviceId) || registeredDevices.get(deviceId);
  if (!serial) {
    console.warn(`[StreamBridge] Cannot start stream for ${deviceId}: no serial mapped.`);
    return;
  }

  deviceIdToSerial.set(deviceId, serial);
  if (!serialToDeviceIds.has(serial)) {
    serialToDeviceIds.set(serial, new Set());
  }
  serialToDeviceIds.get(serial).add(deviceId);

  const deviceIdBuf = Buffer.from(deviceId, 'utf8');

  // If capture pipeline is already running for this physical device serial, push cached keyframe and reuse
  if (activeStreams.has(serial)) {
    const cached = cachedKeyframes.get(serial);
    if (cached && ws && ws.readyState === 1) {
      console.log(`[StreamBridge] ⚡ Immediate sync: pushing cached keyframe to viewer for ${serial}`);
      ws.send(Buffer.concat([deviceIdBuf, cached]));
    }
    return;
  }

  console.log(`[StreamBridge] 🚀 Starting clean 60 FPS hardware stream for ${deviceId} (${serial})...`);
  wakePhone(serial);

  let active = true;
  let screenrecordProc = null;
  let audioProc = null;
  let framesSent = 0;
  let lastStatsTime = Date.now();
  let nalBuffer = Buffer.alloc(0);
  let currentSps = null;
  let currentPps = null;

  const startH264Pipeline = () => {
    if (!active) return;
    try {
      nalBuffer = Buffer.alloc(0);
      screenrecordProc = spawn(adbPath, [
        '-s', serial,
        'exec-out',
        'screenrecord',
        '--output-format=h264',
        '--size', '720x1600',
        '--bit-rate', '8000000',
        '--time-limit', '0',
        '-'
      ], { stdio: ['ignore', 'pipe', 'ignore'] });

      screenrecordProc.stdout.on('data', (chunk) => {
        if (!active || !ws || ws.readyState !== 1) return;

        nalBuffer = Buffer.concat([nalBuffer, chunk]);

        // Find Annex B start codes: 00 00 00 01 (4 bytes) or 00 00 01 (3 bytes)
        const startOffsets = [];
        for (let i = 0; i <= nalBuffer.length - 4; i++) {
          if (nalBuffer[i] === 0x00 && nalBuffer[i + 1] === 0x00) {
            if (nalBuffer[i + 2] === 0x01) {
              startOffsets.push(i);
            } else if (nalBuffer[i + 2] === 0x00 && nalBuffer[i + 3] === 0x01) {
              startOffsets.push(i);
              i++;
            }
          }
        }

        // When we have at least 2 boundaries, slice and emit complete NAL units
        if (startOffsets.length >= 2) {
          for (let k = 0; k < startOffsets.length - 1; k++) {
            const start = startOffsets[k];
            const end = startOffsets[k + 1];
            const completeNal = nalBuffer.subarray(start, end);

            // Check NAL type
            const nalType = (completeNal[2] === 0x01 ? completeNal[3] : completeNal[4]) & 0x1f;

            if (nalType === 7) {
              currentSps = completeNal;
            } else if (nalType === 8) {
              currentPps = completeNal;
            } else if (nalType === 5) {
              // IDR Keyframe: Combine SPS + PPS + IDR into a single atomic keyframe
              let fullKeyframe = completeNal;
              if (currentSps && currentPps) {
                fullKeyframe = Buffer.concat([currentSps, currentPps, completeNal]);
              }
              cachedKeyframes.set(serial, fullKeyframe);

              const devIds = serialToDeviceIds.get(serial);
              if (devIds) {
                for (const dId of devIds) {
                  ws.send(Buffer.concat([Buffer.from(dId, 'utf8'), fullKeyframe]));
                }
              }
              framesSent++;
            } else {
              // Delta frame (P-frame slice or other NAL)
              const devIds = serialToDeviceIds.get(serial);
              if (devIds) {
                for (const dId of devIds) {
                  ws.send(Buffer.concat([Buffer.from(dId, 'utf8'), completeNal]));
                }
              }
              framesSent++;
            }
          }
          nalBuffer = nalBuffer.subarray(startOffsets[startOffsets.length - 1]);

          const now = Date.now();
          if (now - lastStatsTime >= 3000) {
            const fps = Math.round((framesSent * 1000) / (now - lastStatsTime));
            console.log(`[Stream] ⚡ ws-scrcpy clean 60 FPS hardware stream: ~${fps} FPS | ${serial}`);
            framesSent = 0;
            lastStatsTime = now;
          }
        }
      });

      screenrecordProc.on('exit', () => {
        if (active) {
          setTimeout(startH264Pipeline, 200);
        }
      });

      screenrecordProc.on('error', (err) => {
        console.warn(`[Stream] Pipeline warning: ${err.message}. Retrying in 400ms...`);
        if (active) setTimeout(startH264Pipeline, 400);
      });
    } catch (e) {
      if (active) setTimeout(startH264Pipeline, 400);
    }
  };

  startH264Pipeline();

  // Headless audio capture via scrcpy (zero popup desktop window)
  const scrcpyBin = findScrcpy();
  if (scrcpyBin) {
    try {
      audioProc = spawn(scrcpyBin, [
        '-s', serial,
        '--no-video',
        '--no-playback',
        '--audio-codec=raw',
        '--record=-',
        '--record-format=wav'
      ], { stdio: ['ignore', 'pipe', 'ignore'] });

      audioProc.stdout.on('data', (audioChunk) => {
        if (!active || !ws || ws.readyState !== 1) return;
        const devIds = serialToDeviceIds.get(serial);
        if (devIds) {
          for (const dId of devIds) {
            // Prefix audio packets with 'AUD:' + deviceId (36 chars)
            ws.send(Buffer.concat([Buffer.from('AUD:' + dId, 'utf8'), audioChunk]));
          }
        }
      });

      audioProc.on('error', () => {});
    } catch (e) {}
  }

  activeStreams.set(serial, {
    stop: () => {
      active = false;
      if (screenrecordProc) {
        try { screenrecordProc.kill(); } catch (e) {}
      }
      if (audioProc) {
        try { audioProc.kill(); } catch (e) {}
      }
    },
    serial
  });
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
            if (!registeredDevices.has(devId)) {
              console.log(`[Device] ☁️ Synced with Cloud Fleet: ${d.device_name} (ID: ${devId})`);
            }
            registeredDevices.set(devId, ser);
            deviceIdToSerial.set(devId, ser);
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

            // Initiate or map screen stream for this device serial
            if (!activeStreams.has(ser)) {
              console.log(`[StreamBridge] 🚀 Auto-starting video stream for ${d.device_name} (${ser})...`);
            }
            startStream(devId, ser);
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
