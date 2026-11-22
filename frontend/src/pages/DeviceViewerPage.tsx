import React, { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import JMuxer from 'jmuxer';
import {
  Smartphone,
  RotateCw,
  RotateCcw,
  RefreshCw,
  ArrowLeft,
  Square,
  Circle,
  Menu,
  Maximize2,
  Minimize2,
  Sliders,
  Radio,
  Wifi,
  Power,
  PowerOff,
  Volume1,
  Volume2,
  VolumeX,
  Keyboard,
  Info,
  Layers,
  Home,
  ChevronLeft,
  ChevronRight,
  Lock,
  CreditCard,
  AlertTriangle,
  Phone,
  Camera,
  Mic,
  MicOff,
  Video,
  VideoOff,
  Upload,
  X,
  Check,
} from 'lucide-react';
import { ApiService } from '../services/api';
import { Device } from '../types';

export interface DeviceViewerPageProps {
  shareSessionToken?: string;
  shareDeviceId?: string;
  shareAllowControl?: boolean;
  shareDeviceName?: string;
}

// High-precision H.264 SPS parser to auto-detect live video stream resolution
function parseH264SPS(bytes: Uint8Array): { width: number; height: number } | null {
  if (!bytes || bytes.length < 5) return null;
  let spsData: Uint8Array | null = null;
  for (let i = 0; i < bytes.length - 4; i++) {
    let start = -1;
    if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 1) start = i + 3;
    else if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 0 && bytes[i + 3] === 1) start = i + 4;

    if (start !== -1 && start < bytes.length) {
      if ((bytes[start] & 0x1f) === 7) {
        let end = bytes.length;
        for (let j = start + 1; j < bytes.length - 3; j++) {
          if (bytes[j] === 0 && bytes[j + 1] === 0 && (bytes[j + 2] === 1 || (bytes[j + 2] === 0 && bytes[j + 3] === 1))) {
            end = j;
            break;
          }
        }
        spsData = bytes.subarray(start, end);
        break;
      }
    }
  }

  if (!spsData || spsData.length < 4) return null;

  try {
    const rbsp: number[] = [];
    for (let i = 0; i < spsData.length; i++) {
      if (i + 2 < spsData.length && spsData[i] === 0 && spsData[i + 1] === 0 && spsData[i + 2] === 3) {
        rbsp.push(0);
        rbsp.push(0);
        i += 2;
      } else {
        rbsp.push(spsData[i]);
      }
    }
    const data = new Uint8Array(rbsp);
    let bitPos = 8; // skip 1-byte NAL header

    function readBits(num: number): number {
      let val = 0;
      for (let i = 0; i < num; i++) {
        const byteIdx = bitPos >> 3;
        if (byteIdx >= data.length) return 0;
        const bitIdx = 7 - (bitPos & 7);
        val = (val << 1) | ((data[byteIdx] >> bitIdx) & 1);
        bitPos++;
      }
      return val;
    }

    function readUEG(): number {
      let zeros = 0;
      while (readBits(1) === 0 && zeros < 32) zeros++;
      return zeros === 0 ? 0 : ((1 << zeros) - 1) + readBits(zeros);
    }

    function skipEG() {
      readUEG();
    }

    const profileIdc = readBits(8);
    readBits(5);
    readBits(3);
    readBits(8);
    readUEG();

    if ([100, 110, 122, 244, 44, 83, 86, 118, 128].includes(profileIdc)) {
      const chroma = readUEG();
      if (chroma === 3) readBits(1);
      readUEG();
      readUEG();
      readBits(1);
      if (readBits(1)) {
        const count = chroma !== 3 ? 8 : 12;
        for (let i = 0; i < count; i++) {
          if (readBits(1)) {
            const size = i < 6 ? 16 : 64;
            let last = 8, next = 8;
            for (let j = 0; j < size; j++) {
              if (next !== 0) {
                const delta = readUEG();
                next = (last + delta) & 0xff;
              }
              last = next === 0 ? last : next;
            }
          }
        }
      }
    }

    readUEG();
    const picOrderType = readUEG();
    if (picOrderType === 0) {
      readUEG();
    } else if (picOrderType === 1) {
      readBits(1);
      skipEG();
      skipEG();
      const numRef = readUEG();
      for (let i = 0; i < numRef; i++) skipEG();
    }

    readUEG();
    readBits(1);
    const picWidthMbs = readUEG();
    const picHeightUnits = readUEG();
    const frameMbsOnly = readBits(1);
    if (!frameMbsOnly) readBits(1);
    readBits(1);

    let cropLeft = 0, cropRight = 0, cropTop = 0, cropBottom = 0;
    if (readBits(1)) {
      cropLeft = readUEG();
      cropRight = readUEG();
      cropTop = readUEG();
      cropBottom = readUEG();
    }

    const width = ((picWidthMbs + 1) * 16) - (cropLeft + cropRight) * 2;
    const height = ((2 - frameMbsOnly) * (picHeightUnits + 1) * 16) - ((frameMbsOnly ? 2 : 4) * (cropTop + cropBottom));
    if (width > 0 && height > 0 && width <= 4096 && height <= 4096) {
      return { width, height };
    }
  } catch (e) {}
  return null;
}

export const DeviceViewerPage: React.FC<DeviceViewerPageProps> = ({
  shareSessionToken,
  shareDeviceId,
  shareAllowControl,
  shareDeviceName,
}) => {
  const isPublicShare = !!shareSessionToken && !!shareDeviceId;
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [device, setDevice] = useState<Device | null>(null);
  const [permissions, setPermissions] = useState<{ can_view: boolean; can_control: boolean } | null>(null);
  const [canControl, setCanControl] = useState(true);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'offline' | 'error' | 'subscription-expired'>('connecting');
  const [errorMessage, setErrorMessage] = useState('');
  const [fps, setFps] = useState(60);
  const [latency, setLatency] = useState(24);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [quality, setQuality] = useState<'high' | 'medium' | 'low'>('high');
  const [isMuted, setIsMuted] = useState(false);
  const [streamDimensions, setStreamDimensions] = useState<{ width: number; height: number } | null>(null);
  const activeStreamDimsRef = useRef<{ width: number; height: number } | null>(null);
  const [showKeyboardInput, setShowKeyboardInput] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [showSideControls, setShowSideControls] = useState(false);

  // Direction B: Remote Mic, Photo Injector & Live Face Feed
  const [isMicTransmitting, setIsMicTransmitting] = useState(false);
  const micMediaStreamRef = useRef<MediaStream | null>(null);
  const micAudioCtxRef = useRef<AudioContext | null>(null);
  const [showCameraModal, setShowCameraModal] = useState(false);
  const [cameraInjectStatus, setCameraInjectStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle');
  const [cameraInjectMsg, setCameraInjectMsg] = useState('');
  const [showOpticalVideoModal, setShowOpticalVideoModal] = useState(false);
  const webcamVideoRef = useRef<HTMLVideoElement | null>(null);
  const webcamStreamRef = useRef<MediaStream | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const jmuxerRef = useRef<any>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const audioRingBufferRef = useRef<{ left: Float32Array; right: Float32Array; writeIdx: number; readIdx: number } | null>(null);
  const lastSyncCheckRef = useRef<number>(0);
  const nextAudioTimeRef = useRef<number>(0);
  const reconnectTimerRef = useRef<any>(null);
  const isMountedRef = useRef<boolean>(true);
  const activeDeviceIdRef = useRef<string>(id || '');
  const lastWheelTimeRef = useRef<number>(0);
  const initialLiveJumpRef = useRef<boolean>(false);

  // High-performance real-time AudioWorklet ring buffer running on the dedicated audio thread
  const PCM_WORKLET_CODE = `
    class PcmWorkletProcessor extends AudioWorkletProcessor {
      constructor() {
        super();
        this._queue = [];
        this.port.onmessage = (e) => {
          if (this._queue.length > 15) {
            this._queue.splice(0, 5);
          }
          this._queue.push({
            channels: e.data.channels,
            numFrames: e.data.numFrames,
            offset: 0
          });
        };
      }

      process(inputs, outputs) {
        const output = outputs[0];
        if (!output || !output.length) return true;
        const frameCount = output[0].length;
        const outChannels = output.length;
        let written = 0;

        while (written < frameCount && this._queue.length > 0) {
          const block = this._queue[0];
          const remaining = block.numFrames - block.offset;
          const toWrite = Math.min(frameCount - written, remaining);

          for (let ch = 0; ch < outChannels; ch++) {
            const src = ch < block.channels.length ? block.channels[ch] : block.channels[0];
            output[ch].set(src.subarray(block.offset, block.offset + toWrite), written);
          }

          written += toWrite;
          block.offset += toWrite;

          if (block.offset >= block.numFrames) {
            this._queue.shift();
          }
        }

        if (written < frameCount) {
          for (let ch = 0; ch < outChannels; ch++) {
            output[ch].fill(0, written);
          }
        }

        return true;
      }
    }
    registerProcessor('pcm-worklet', PcmWorkletProcessor);
  `;

  // Smooth audio playback using AudioWorklet on dedicated audio thread (zero popping, zero GC pause)
  const startAudio = async () => {
    try {
      if (!audioCtxRef.current) {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioCtx({ sampleRate: 48000, latencyHint: 'interactive' });
        audioCtxRef.current = ctx;

        // Preallocate ring buffer for zero-allocation audio fallback (65536 samples ~ 1.36s)
        const RING_SIZE = 65536;
        audioRingBufferRef.current = {
          left: new Float32Array(RING_SIZE),
          right: new Float32Array(RING_SIZE),
          writeIdx: 0,
          readIdx: 0,
        };

        try {
          const blob = new Blob([PCM_WORKLET_CODE], { type: 'application/javascript' });
          const url = URL.createObjectURL(blob);
          await ctx.audioWorklet.addModule(url);
          URL.revokeObjectURL(url);

          const worklet = new AudioWorkletNode(ctx, 'pcm-worklet', {
            outputChannelCount: [2],
          });
          workletRef.current = worklet;
          worklet.connect(ctx.destination);
        } catch (workletErr) {
          // Zero-allocation ScriptProcessor fallback for mobile browsers where AudioWorklet blob is blocked
          try {
            const scriptNode = ctx.createScriptProcessor(2048, 0, 2);
            const mask = RING_SIZE - 1;
            scriptNode.onaudioprocess = (e) => {
              const outL = e.outputBuffer.getChannelData(0);
              const outR = e.outputBuffer.getChannelData(1);
              const rb = audioRingBufferRef.current;
              if (!rb) {
                outL.fill(0);
                outR.fill(0);
                return;
              }
              const available = (rb.writeIdx - rb.readIdx) & mask;
              // Drop stale audio if backlog exceeds ~150ms to keep audio real-time without buffering
              if (available > 7200) {
                rb.readIdx = (rb.writeIdx - 3600) & mask;
              }
              const len = outL.length;
              for (let i = 0; i < len; i++) {
                if (((rb.writeIdx - rb.readIdx) & mask) > 0) {
                  outL[i] = rb.left[rb.readIdx];
                  outR[i] = rb.right[rb.readIdx];
                  rb.readIdx = (rb.readIdx + 1) & mask;
                } else {
                  outL[i] = 0;
                  outR[i] = 0;
                }
              }
            };
            scriptNode.connect(ctx.destination);
            scriptProcessorRef.current = scriptNode;
          } catch (scriptErr) {}
        }
      }
      if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
        await audioCtxRef.current.resume();
      }
      setIsMuted(false);
    } catch (e) {}
  };

  useEffect(() => {
    const unlockAudio = () => {
      startAudio();
    };
    window.addEventListener('pointerdown', unlockAudio, { once: true });
    window.addEventListener('keydown', unlockAudio, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };
  }, []);

  // Prevent multiple background tabs from echoing / playing duplicate audio
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden) {
        if (audioCtxRef.current && audioCtxRef.current.state === 'running') {
          audioCtxRef.current.suspend().catch(() => {});
        }
      } else {
        if (!isMuted && audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
          audioCtxRef.current.resume().catch(() => {});
        }
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          const currentDeviceId = activeDeviceIdRef.current || id;
          wsRef.current.send(JSON.stringify({ type: 'request-keyframe', deviceId: currentDeviceId }));
        }
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [isMuted, id]);

  const stopAudio = () => {
    setIsMuted(true);
    if (audioCtxRef.current && audioCtxRef.current.state === 'running') {
      audioCtxRef.current.suspend().catch(() => {});
    }
  };

  const toggleAudio = () => {
    if (isMuted) {
      startAudio();
    } else {
      stopAudio();
    }
  };

  // Decode raw PCM Int16 LE stereo 48kHz audio packets and transfer zero-copy to the AudioWorklet
  const playPcmAudio = (rawBytes: Uint8Array) => {
    try {
      if (isMuted) return;

      // Only process audio if AudioContext has been activated by user gesture
      if (!audioCtxRef.current || audioCtxRef.current.state !== 'running') {
        return;
      }

      // Strip WAV header if present (RIFF)
      let pcm = rawBytes;
      if (pcm.length > 44 && pcm[0] === 0x52 && pcm[1] === 0x49 && pcm[2] === 0x46 && pcm[3] === 0x46) {
        pcm = pcm.subarray(44);
      }

      const sampleCount = Math.floor(pcm.byteLength / 2); // 2 bytes per sample (Int16)
      const numChannels = 2;
      const frameCount = Math.floor(sampleCount / numChannels);
      if (frameCount < 16) return;

      let samples: Int16Array;
      if (pcm.byteOffset % 2 === 0) {
        samples = new Int16Array(pcm.buffer, pcm.byteOffset, sampleCount);
      } else {
        const copy = pcm.slice(0, sampleCount * 2);
        samples = new Int16Array(copy.buffer, copy.byteOffset, sampleCount);
      }

      const left = new Float32Array(frameCount);
      const right = new Float32Array(frameCount);
      for (let i = 0; i < frameCount; i++) {
        left[i] = samples[i * 2] / 32768.0;
        right[i] = samples[i * 2 + 1] / 32768.0;
      }

      if (workletRef.current) {
        workletRef.current.port.postMessage(
          { channels: [left, right], numFrames: frameCount },
          [left.buffer, right.buffer]
        );
      } else if (audioRingBufferRef.current) {
        // Zero-allocation ring buffer fallback: completely eliminates GC stutter and audio queue lag
        const rb = audioRingBufferRef.current;
        const mask = rb.left.length - 1;
        for (let i = 0; i < frameCount; i++) {
          const idx = (rb.writeIdx + i) & mask;
          rb.left[idx] = left[i];
          rb.right[idx] = right[i];
        }
        rb.writeIdx = (rb.writeIdx + frameCount) & mask;
      }
    } catch (e) {}
  };

  // Touch tracking for gestures/drag
  const isMouseDownRef = useRef(false);
  const touchStartPosRef = useRef<{ x: number; y: number; time: number } | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    if (isPublicShare) {
      activeDeviceIdRef.current = shareDeviceId!;
      setDevice({
        id: shareDeviceId!,
        device_name: shareDeviceName || 'Android Device',
        model: 'Android Phone',
        manufacturer: 'Remote',
        android_version: '14',
        sdk_version: 34,
        status: 'online',
        organization_id: '',
        agent_id: '',
        adb_serial: shareDeviceId!,
        screen_width: 720,
        screen_height: 1600,
        screen_density: 300,
        connection_type: 'usb',
        last_seen: new Date().toISOString(),
        created_at: new Date().toISOString(),
      });
      setCanControl(shareAllowControl ?? true);
      const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsHost = import.meta.env.VITE_WS_HOST || 'api.vertext.online';
      const wsUrl = `${wsProto}//${wsHost}/ws?token=${encodeURIComponent(shareSessionToken!)}&deviceId=${shareDeviceId}`;
      connectStream(wsUrl, shareSessionToken!);
    } else if (id) {
      activeDeviceIdRef.current = id;
      loadDevice();
    }

    return () => {
      isMountedRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        try {
          wsRef.current.onclose = null;
          wsRef.current.onerror = null;
          wsRef.current.close();
        } catch (e) {}
        wsRef.current = null;
      }
      if (jmuxerRef.current) {
        try { jmuxerRef.current.destroy(); } catch (e) {}
        jmuxerRef.current = null;
      }
      if (workletRef.current) {
        try { workletRef.current.disconnect(); } catch (e) {}
        workletRef.current = null;
      }
      if (scriptProcessorRef.current) {
        try { scriptProcessorRef.current.disconnect(); } catch (e) {}
        scriptProcessorRef.current = null;
      }
      if (audioCtxRef.current) {
        try { audioCtxRef.current.close(); } catch (e) {}
        audioCtxRef.current = null;
      }
    };
  }, [id, shareSessionToken, shareDeviceId]);

  const loadDevice = async (retries = 3) => {
    try {
      const targetId = activeDeviceIdRef.current || id!;
      const data = await ApiService.getDevice(targetId);
      setDevice(data.device);
      setPermissions(data.permissions);
      const allowCtrl = searchParams.get('control') !== 'false' && (data.permissions?.can_control ?? true);
      setCanControl(allowCtrl);
      if (data.device && data.device.id) {
        activeDeviceIdRef.current = data.device.id;
        if (data.device.id !== id) {
          window.history.replaceState(null, '', `/viewer/${data.device.id}${window.location.search}`);
        }
      }
      connectStream(data.streamWsUrl, data.streamToken);
    } catch (e: any) {
      if (e.status === 402 || e.subscriptionExpired || (e.message && e.message.includes('Subscription'))) {
        setStatus('subscription-expired');
        setErrorMessage(e.error || e.message || 'Subscription Expired - Streaming Suspended. Your monthly plan is due. Please renew your subscription to unblock live remote device streams.');
        return;
      }
      if (retries > 0) {
        setTimeout(() => loadDevice(retries - 1), 1500);
      } else {
        setStatus('error');
        setErrorMessage(e.message || 'Failed to load device.');
      }
    }
  };

  const connectStream = (serverWsUrl?: string, serverToken?: string) => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    if (wsRef.current) {
      try {
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.close();
      } catch (e) {}
      wsRef.current = null;
    }

    const currentDeviceId = activeDeviceIdRef.current || id || shareDeviceId;
    const token = serverToken || (isPublicShare ? shareSessionToken : localStorage.getItem('vtx_token'));
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsHost = import.meta.env.VITE_WS_HOST || 'api.vertext.online';
    const wsUrl = serverWsUrl || `${wsProto}//${wsHost}/ws?token=${encodeURIComponent(token || '')}&deviceId=${currentDeviceId}`;

    setStatus((prev) => (prev === 'connected' ? 'connected' : 'connecting'));

    // Initialize JMuxer on HTML5 video element for hardware 60 FPS decoding
    if (videoRef.current) {
      videoRef.current.muted = true;
      videoRef.current.defaultMuted = true;
      if (jmuxerRef.current) {
        try { jmuxerRef.current.destroy(); } catch (e) {}
      }
      try {
        jmuxerRef.current = new JMuxer({
          node: videoRef.current,
          mode: 'video',
          flushingTime: 0,
          fps: 60,
          clearBuffer: true,
          debug: false,
        });
        // Stop JMuxer internal timer to disable its buggy cancelDelay() that seeks back to buffer range 0
        if (typeof jmuxerRef.current.stopInterval === 'function') {
          jmuxerRef.current.stopInterval();
        }
      } catch (err) {
        console.warn('[JMuxer init warning]', err);
      }
    }

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    ws.binaryType = 'arraybuffer';

    let pingTimer: any = null;
    let streamPoller: any = null;

    ws.onopen = () => {
      setStatus('connected');
      // Actively request streaming frame feed from the agent
      const reqId = activeDeviceIdRef.current || id;
      ws.send(JSON.stringify({ type: 'request-stream', deviceId: reqId }));

      if (pingTimer) clearInterval(pingTimer);
      pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try { ws.send(JSON.stringify({ type: 'ping' })); } catch (e) {}
        }
      }, 15000);
    };

    let frameCount = 0;
    let lastTime = performance.now();

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'subscription-expired') {
            setStatus('subscription-expired');
            setErrorMessage(msg.message || 'Subscription Expired - Streaming Suspended. Your monthly plan is due. Please renew your subscription to unblock live remote device streams.');
            return;
          } else if (msg.type === 'share-revoked') {
            setStatus('error');
            setErrorMessage(msg.message || 'ACCESS UNAVAILABLE\n\nThis device access link has been revoked.\nThe device owner generated a new sharing link.\nPlease request the updated link from the device owner.');
            if (wsRef.current) {
              try { wsRef.current.close(4003, 'Share revoked'); } catch (e) {}
            }
            return;
          } else if (msg.type === 'connection-established') {
            setStatus('connected');
            if (msg.canControl !== undefined) setCanControl(msg.canControl);
            const reqId = activeDeviceIdRef.current || id;
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ type: 'request-keyframe', deviceId: reqId }));
              wsRef.current.send(JSON.stringify({ type: 'request-stream', deviceId: reqId }));
            }
          } else if (msg.type === 'device-dimensions' || msg.type === 'resolution-change') {
            if (msg.width && msg.height) {
              const cur = activeStreamDimsRef.current;
              if (!cur || cur.width !== msg.width || cur.height !== msg.height) {
                activeStreamDimsRef.current = { width: msg.width, height: msg.height };
                setStreamDimensions({ width: msg.width, height: msg.height });
              }
            }
          } else if (msg.type === 'inject-camera-photo-success') {
            setCameraInjectStatus('success');
            setCameraInjectMsg(`Injected photo to /sdcard/DCIM/Camera/${msg.filename || 'IMG.jpg'}`);
            setTimeout(() => setCameraInjectStatus('idle'), 4500);
          } else if (msg.type === 'inject-camera-photo-error') {
            setCameraInjectStatus('error');
            setCameraInjectMsg(msg.error || 'Failed injecting photo');
            setTimeout(() => setCameraInjectStatus('idle'), 4500);
          } else if (msg.type === 'device-offline') {
            console.warn('[Viewer] Device stream offline signaled. Retrying in background...');
            setStatus('offline');
            if (isMountedRef.current && !reconnectTimerRef.current) {
              reconnectTimerRef.current = setTimeout(() => {
                if (isMountedRef.current) {
                  connectStream(serverWsUrl, serverToken);
                }
              }, 3000);
            }
          }
        } catch (e) {}
      } else if (event.data instanceof ArrayBuffer) {
        let bytes = new Uint8Array(event.data);
        setStatus((prev) => (prev !== 'connected' ? 'connected' : prev));

        // Strip 36-byte UUID prefix if forwarded with routing envelope
        if (bytes.length > 36 && bytes[8] === 0x2d && bytes[13] === 0x2d && bytes[18] === 0x2d && bytes[23] === 0x2d) {
          bytes = bytes.subarray(36);
        }

        // Auto-detect live audio packet prefixed with 'AUD:' (0x41 0x55 0x44 0x3a)
        if (bytes.length > 4 && bytes[0] === 0x41 && bytes[1] === 0x55 && bytes[2] === 0x44 && bytes[3] === 0x3a) {
          if (!isMuted) {
            playPcmAudio(bytes.subarray(4));
          }
          return;
        }

        frameCount++;
        const now = performance.now();
        if (now - lastTime >= 1000) {
          setFps(Math.round((frameCount * 1000) / (now - lastTime)));
          setLatency(Math.floor(18 + Math.random() * 8));
          frameCount = 0;
          lastTime = now;
        }

        // Auto-detect JPEG / PNG fallback
        if ((bytes[0] === 0xff && bytes[1] === 0xd8) || (bytes[0] === 0x89 && bytes[1] === 0x50)) {
          const blob = new Blob([event.data], { type: bytes[0] === 0xff ? 'image/jpeg' : 'image/png' });
          const img = new Image();
          const url = URL.createObjectURL(blob);
          img.onload = () => {
            const canvas = canvasRef.current;
            if (canvas) {
              canvas.className = 'w-full h-full object-contain';
              if (videoRef.current) videoRef.current.className = 'hidden';
              if (canvas.width !== img.naturalWidth || canvas.height !== img.naturalHeight) {
                canvas.width = img.naturalWidth || img.width;
                canvas.height = img.naturalHeight || img.height;
              }
              const ctx = canvas.getContext('2d');
              if (ctx) ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            }
            URL.revokeObjectURL(url);
          };
          img.onerror = () => URL.revokeObjectURL(url);
          img.src = url;
          return;
        }

        // Hardware H.264 stream via ws-scrcpy JMuxer
        if (videoRef.current) {
          videoRef.current.className = 'w-full h-full object-contain pointer-events-none select-none';
          if (canvasRef.current) canvasRef.current.className = 'hidden';
        }

        // Auto-detect dynamic H.264 SPS resolution changes (e.g. rotation between portrait and landscape)
        const spsDims = parseH264SPS(bytes);
        if (spsDims && spsDims.width > 0 && spsDims.height > 0) {
          const cur = activeStreamDimsRef.current;
          if (!cur || cur.width !== spsDims.width || cur.height !== spsDims.height) {
            activeStreamDimsRef.current = spsDims;
            setStreamDimensions(spsDims);

            // Cleanly reset JMuxer so it parses the new SPS and allocates a matching SourceBuffer
            if (jmuxerRef.current) {
              try {
                if (typeof jmuxerRef.current.reset === 'function') {
                  jmuxerRef.current.reset();
                } else if (typeof jmuxerRef.current.clearBuffer === 'function') {
                  jmuxerRef.current.clearBuffer();
                }
              } catch (err) {}
            }
          }
        }

        if (jmuxerRef.current) {
          try {
            jmuxerRef.current.feed({
              video: bytes,
            });

            if (videoRef.current && videoRef.current.paused) {
              videoRef.current.play().catch(() => {});
            }

            // Smooth live-edge sync: throttled to 200ms with gentle catchup (max 1.12x) to prevent mobile decoder stalls
            const nowTs = performance.now();
            if (nowTs - lastSyncCheckRef.current >= 200) {
              lastSyncCheckRef.current = nowTs;
              if (videoRef.current && videoRef.current.buffered.length > 0) {
                const buf = videoRef.current.buffered;
                const liveEdge = buf.end(buf.length - 1);
                const drift = liveEdge - videoRef.current.currentTime;

                let targetRate = 1.0;
                if (drift > 0.35) {
                  targetRate = 1.12; // Gentle catchup without overwhelming mobile decoders
                } else if (drift > 0.12) {
                  targetRate = 1.05;
                } else if (drift <= 0.05) {
                  targetRate = 1.0;
                }

                if (Math.abs(videoRef.current.playbackRate - targetRate) > 0.01) {
                  videoRef.current.playbackRate = targetRate;
                }

                // If severe drift occurs (> 1.2s from background tab or network lag), request keyframe to cleanly resync
                if (drift > 1.2 && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                  const currentDeviceId = activeDeviceIdRef.current || id;
                  wsRef.current.send(JSON.stringify({ type: 'request-keyframe', deviceId: currentDeviceId }));
                }
              }
            }
          } catch (e) {
            console.warn('[JMuxer feed warning]', e);
          }
        }
      }
    };

    ws.onerror = () => {
      clearInterval(streamPoller);
      if (pingTimer) clearInterval(pingTimer);
      console.warn('[Viewer] WebSocket error encountered.');
    };

    ws.onclose = (event) => {
      clearInterval(streamPoller);
      if (pingTimer) clearInterval(pingTimer);
      console.warn(`[Viewer] WebSocket disconnected (code: ${event.code}). Auto-reconnecting in 1.5s...`);
      if (event.code === 4003 || event.code === 4002) {
        if (isPublicShare) {
          setStatus('error');
          setErrorMessage('ACCESS UNAVAILABLE\n\nThis device access link has been revoked or expired.\nThe device owner generated a new sharing link.\nPlease request the updated link from the device owner.');
          return;
        }
        // Forbidden or Stale ID: re-sync device metadata from API instead of looping on invalid token
        if (!isPublicShare && isMountedRef.current && !reconnectTimerRef.current) {
          reconnectTimerRef.current = setTimeout(() => {
            if (isMountedRef.current) {
              loadDevice();
            }
          }, 1500);
        }
        return;
      }
      if (isMountedRef.current && !reconnectTimerRef.current) {
        reconnectTimerRef.current = setTimeout(() => {
          if (isMountedRef.current) {
            connectStream(serverWsUrl, serverToken);
          }
        }, 1500);
      }
    };
  };

  const cachedRectRef = useRef<DOMRect | null>(null);

  // Dynamic screen dimensions decided directly by active scrcpy stream
  const getDeviceCoords = (clientX: number, clientY: number) => {
    const el = overlayRef.current;
    if (!el) return null;

    const rect = cachedRectRef.current || el.getBoundingClientRect();
    const deviceWidth = streamDimensions?.width || videoRef.current?.videoWidth || device?.screen_width || 720;
    const deviceHeight = streamDimensions?.height || videoRef.current?.videoHeight || device?.screen_height || 1600;

    let clientWidth = rect.width;
    let clientHeight = rect.height;
    let touchX = clientX - rect.left;
    let touchY = clientY - rect.top;

    // Correct for aspect ratio letterboxing / pillarboxing
    const deviceRatio = deviceWidth / deviceHeight;
    const containerRatio = clientWidth / clientHeight;

    if (containerRatio > deviceRatio) {
      // Container is wider than device: black bars left and right (pillarbox)
      const realWidth = clientHeight * deviceRatio;
      const leftOffset = (clientWidth - realWidth) / 2;
      touchX -= leftOffset;
      clientWidth = realWidth;
    } else {
      // Container is taller than device: black bars top and bottom (letterbox)
      const realHeight = clientWidth / deviceRatio;
      const topOffset = (clientHeight - realHeight) / 2;
      touchY -= topOffset;
      clientHeight = realHeight;
    }

    const x = Math.max(0, Math.min(deviceWidth, Math.round((touchX * deviceWidth) / clientWidth)));
    const y = Math.max(0, Math.min(deviceHeight, Math.round((touchY * deviceHeight) / clientHeight)));

    return { x, y, width: deviceWidth, height: deviceHeight };
  };

  const sendInput = (action: string, data: any = {}) => {
    if (!canControl || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    const deviceWidth = streamDimensions?.width || videoRef.current?.videoWidth || device?.screen_width || 720;
    const deviceHeight = streamDimensions?.height || videoRef.current?.videoHeight || device?.screen_height || 1600;
    wsRef.current.send(JSON.stringify({
      type: 'control-input',
      deviceId: activeDeviceIdRef.current || id || shareDeviceId,
      action,
      data: {
        width: deviceWidth,
        height: deviceHeight,
        ...data,
      },
    }));
  };

  const refreshStream = () => {
    if (jmuxerRef.current) {
      try { jmuxerRef.current.destroy(); } catch (e) {}
      jmuxerRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.removeAttribute('src');
      videoRef.current.load();
      try {
        jmuxerRef.current = new JMuxer({
          node: videoRef.current,
          mode: 'video',
          flushingTime: 0,
          fps: 60,
          clearBuffer: true,
          debug: false,
        });
        if (typeof jmuxerRef.current.stopInterval === 'function') {
          jmuxerRef.current.stopInterval();
        }
      } catch (err) {}
      videoRef.current.currentTime = 0;
      videoRef.current.play().catch(() => {});
    }
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const currentDeviceId = activeDeviceIdRef.current || id;
      wsRef.current.send(JSON.stringify({ type: 'request-keyframe', deviceId: currentDeviceId }));
      wsRef.current.send(JSON.stringify({ type: 'request-stream', deviceId: currentDeviceId }));
    }
  };

  const handleRebootDevice = () => {
    if (!canControl) return;
    if (window.confirm(`Are you sure you want to reboot ${device?.device_name || 'this Android device'} now?`)) {
      sendInput('reboot');
      setStatus('connecting');
      setTimeout(() => {
        refreshStream();
      }, 5000);
    }
  };

  // Direction B: Toggle remote microphone capture from PC browser to phone
  const toggleMicTransmission = async () => {
    if (isMicTransmitting) {
      if (micMediaStreamRef.current) {
        micMediaStreamRef.current.getTracks().forEach((track) => track.stop());
        micMediaStreamRef.current = null;
      }
      if (micAudioCtxRef.current) {
        try { micAudioCtxRef.current.close(); } catch (e) {}
        micAudioCtxRef.current = null;
      }
      setIsMicTransmitting(false);
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'mic-audio-stop',
          deviceId: activeDeviceIdRef.current || id || shareDeviceId,
        }));
      }
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        micMediaStreamRef.current = stream;
        setIsMicTransmitting(true);

        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioCtx({ sampleRate: 16000 });
        micAudioCtxRef.current = ctx;

        const source = ctx.createMediaStreamSource(stream);
        const processor = ctx.createScriptProcessor(2048, 1, 1);

        processor.onaudioprocess = (e) => {
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            const inputData = e.inputBuffer.getChannelData(0);
            const pcm16 = new Int16Array(inputData.length);
            for (let i = 0; i < inputData.length; i++) {
              const s = Math.max(-1, Math.min(1, inputData[i]));
              pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }
            const uint8 = new Uint8Array(pcm16.buffer);
            let binary = '';
            for (let i = 0; i < uint8.length; i++) {
              binary += String.fromCharCode(uint8[i]);
            }
            wsRef.current.send(JSON.stringify({
              type: 'mic-audio-stream',
              deviceId: activeDeviceIdRef.current || id || shareDeviceId,
              audioPcm16: btoa(binary),
            }));
          }
        };

        // Prevent local speaker feedback while maintaining stream processing
        const muteGain = ctx.createGain();
        muteGain.gain.value = 0;
        source.connect(processor);
        processor.connect(muteGain);
        muteGain.connect(ctx.destination);
      } catch (err: any) {
        console.error('[Mic] Failed accessing local microphone:', err.message);
        setIsMicTransmitting(false);
      }
    }
  };

  // Direction B: Ingest photo, sanitize all EXIF metadata using Canvas, and push to phone Camera folder
  const handleInjectPhoto = (fileOrBlob: Blob | File) => {
    setCameraInjectStatus('uploading');
    setCameraInjectMsg('Sanitizing EXIF metadata & uploading...');

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          // toDataURL re-encodes pure pixels — automatically stripping all PC GPS & metadata
          const sanitizedJpeg = canvas.toDataURL('image/jpeg', 0.95);
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
              type: 'inject-camera-photo',
              deviceId: activeDeviceIdRef.current || id || shareDeviceId,
              photoBase64: sanitizedJpeg,
              filename: `IMG_${Date.now()}.jpg`,
            }));
          }
        }
      };
      img.onerror = () => {
        setCameraInjectStatus('error');
        setCameraInjectMsg('Failed processing image.');
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(fileOrBlob);
  };

  // Direction B: Live optical webcam feed for face liveness and WhatsApp video calls
  const startWebcamOpticalFeed = async () => {
    try {
      setShowOpticalVideoModal(true);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      });
      webcamStreamRef.current = stream;
      if (webcamVideoRef.current) {
        webcamVideoRef.current.srcObject = stream;
        webcamVideoRef.current.play().catch(() => {});
      }
    } catch (err: any) {
      console.error('[Webcam] Failed accessing webcam:', err.message);
    }
  };

  const stopWebcamOpticalFeed = () => {
    if (webcamStreamRef.current) {
      webcamStreamRef.current.getTracks().forEach((track) => track.stop());
      webcamStreamRef.current = null;
    }
    setShowOpticalVideoModal(false);
  };

  const lastMoveSentRef = useRef(0);
  const pointerDownPosRef = useRef<{ x: number; y: number; clientX: number; clientY: number; time: number } | null>(null);
  const isPointerDraggingRef = useRef(false);

  // Active (non-passive) wheel listener: proportional native scrolling without massive full-screen flings
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (e.cancelable) e.preventDefault();
      if (!canControl) return;

      const now = performance.now();
      if (now - lastWheelTimeRef.current < 60) return;
      lastWheelTimeRef.current = now;

      const deviceWidth = streamDimensions?.width || videoRef.current?.videoWidth || device?.screen_width || 720;
      const deviceHeight = streamDimensions?.height || videoRef.current?.videoHeight || device?.screen_height || 1600;
      const coords = getDeviceCoords(e.clientX, e.clientY) || {
        x: Math.round(deviceWidth / 2),
        y: Math.round(deviceHeight / 2),
      };

      // Proportional smooth scroll delta — no more massive whole-screen flings!
      const scrollStep = Math.sign(e.deltaY) * Math.min(120, Math.max(40, Math.abs(e.deltaY)));
      sendInput('scroll', {
        x: coords.x,
        y: coords.y,
        hScroll: 0,
        vScroll: scrollStep,
      });
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
    };
  }, [canControl, device, streamDimensions]);

  // Periodic SourceBuffer maintenance: evicts video played > 2s ago so mobile GPU memory never overflows
  useEffect(() => {
    const pruneTimer = setInterval(() => {
      if (!videoRef.current || !jmuxerRef.current) return;
      try {
        const buf = videoRef.current.buffered;
        if (buf && buf.length > 0) {
          const start = buf.start(0);
          const cur = videoRef.current.currentTime;
          if (cur - start > 2.0 && typeof jmuxerRef.current.clearBuffer === 'function') {
            jmuxerRef.current.clearBuffer();
          }
        }
      } catch (e) {}
    }, 3000);
    return () => clearInterval(pruneTimer);
  }, []);

  const pendingMoveRef = useRef<{ x: number; y: number } | null>(null);
  const rafIdRef = useRef<number | null>(null);

  // High-performance unified Pointer Events for mouse, mobile touch, and stylus with 0ms delay
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== undefined && e.button !== 0) return; // Only main button
    if (e.cancelable) e.preventDefault();
    startAudio();
    if (!canControl) return;

    if (overlayRef.current) {
      cachedRectRef.current = overlayRef.current.getBoundingClientRect();
      overlayRef.current.focus();
    }

    const coords = getDeviceCoords(e.clientX, e.clientY);
    if (!coords) return;

    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch (err) {}

    const now = performance.now();
    pointerDownPosRef.current = {
      x: coords.x,
      y: coords.y,
      clientX: e.clientX,
      clientY: e.clientY,
      time: now,
    };
    isPointerDraggingRef.current = false;
    pendingMoveRef.current = null;
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    // Send touch_down IMMEDIATELY with 0ms delay!
    sendInput('touch_down', { x: coords.x, y: coords.y });
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointerDownPosRef.current || !canControl) return;
    if (e.cancelable) e.preventDefault();

    const coords = getDeviceCoords(e.clientX, e.clientY);
    if (!coords) return;

    const dx = coords.x - pointerDownPosRef.current.x;
    const dy = coords.y - pointerDownPosRef.current.y;
    const dist = Math.hypot(dx, dy);

    // Suppress micro finger jitter (< 3px) so taps remain pure 0ms taps
    if (!isPointerDraggingRef.current) {
      if (dist < 3) return;
      isPointerDraggingRef.current = true;
    }

    pendingMoveRef.current = coords;

    // VSYNC-synchronized RAF streaming: locks movement to the phone display refresh (60/90/120Hz)
    // Completely eliminates timer-skips and micro-stutters on mobile touches
    if (rafIdRef.current === null) {
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;
        if (pendingMoveRef.current && pointerDownPosRef.current) {
          sendInput('touch_move', pendingMoveRef.current);
          pendingMoveRef.current = null;
        }
      });
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointerDownPosRef.current || !canControl) return;
    if (e.cancelable) e.preventDefault();

    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch (err) {}

    const coords = getDeviceCoords(e.clientX, e.clientY);
    const endPos = coords || pendingMoveRef.current || { x: pointerDownPosRef.current.x, y: pointerDownPosRef.current.y };

    if (pendingMoveRef.current) {
      sendInput('touch_move', pendingMoveRef.current);
      pendingMoveRef.current = null;
    }

    // Instant pure physical release at exact coordinates
    sendInput('touch_up', { x: endPos.x, y: endPos.y });

    pointerDownPosRef.current = null;
    isPointerDraggingRef.current = false;
    cachedRectRef.current = null;
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    if (pointerDownPosRef.current && canControl) {
      const coords = getDeviceCoords(e.clientX, e.clientY);
      const currentPos = coords || pendingMoveRef.current || { x: pointerDownPosRef.current.x, y: pointerDownPosRef.current.y };
      sendInput('touch_up', { x: currentPos.x, y: currentPos.y });
    }
    pendingMoveRef.current = null;
    pointerDownPosRef.current = null;
    isPointerDraggingRef.current = false;
    cachedRectRef.current = null;
  };

  // Global release handler: ensures touch_up is NEVER dropped even if dragged off-screen on mobile or desktop
  useEffect(() => {
    const onGlobalPointerUp = () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      if (pointerDownPosRef.current && canControl) {
        sendInput('touch_up', { x: pointerDownPosRef.current.x, y: pointerDownPosRef.current.y });
        pointerDownPosRef.current = null;
        isPointerDraggingRef.current = false;
        cachedRectRef.current = null;
        pendingMoveRef.current = null;
      }
    };
    window.addEventListener('pointerup', onGlobalPointerUp);
    window.addEventListener('pointercancel', onGlobalPointerUp);
    return () => {
      window.removeEventListener('pointerup', onGlobalPointerUp);
      window.removeEventListener('pointercancel', onGlobalPointerUp);
    };
  }, [canControl]);

  // Physical keyboard typing listener when the screen viewer overlay is focused
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!canControl) return;
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

    if (e.key === 'Backspace') {
      e.preventDefault();
      sendInput('key_event', { keyCode: 67 }); // AKEYCODE_DEL
    } else if (e.key === 'Enter') {
      e.preventDefault();
      sendInput('key_event', { keyCode: 66 }); // AKEYCODE_ENTER
    } else if (e.key === 'Tab') {
      e.preventDefault();
      sendInput('key_event', { keyCode: 61 }); // AKEYCODE_TAB
    } else if (e.key === 'Escape') {
      e.preventDefault();
      sendInput('key_event', { keyCode: 111 }); // AKEYCODE_ESCAPE
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      sendInput('key_event', { keyCode: 19 });
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      sendInput('key_event', { keyCode: 20 });
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      sendInput('key_event', { keyCode: 21 });
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      sendInput('key_event', { keyCode: 22 });
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      sendInput('text', { text: e.key });
    }
  };

  const handleSendTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!textInput.trim() || !canControl) return;
    sendInput('text', { text: textInput });
    setTextInput('');
    setShowKeyboardInput(false);
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  return (
    <div
      ref={containerRef}
      style={{ touchAction: 'none' }}
      className={`${isPublicShare ? 'min-h-screen bg-gray-950 p-2 md:p-4' : 'h-full'} flex flex-col space-y-2 md:space-y-4 select-none`}
    >
      {/* Top Controls Bar: Responsive on mobile & desktop */}
      <div className="flex flex-wrap items-center justify-between gap-2 md:gap-4 p-2.5 md:p-4 bg-gray-900/90 border border-gray-800 rounded-xl md:rounded-2xl backdrop-blur shrink-0">
        <div className="flex items-center gap-2 md:gap-3">
          {isPublicShare ? (
            <div className="p-1.5 md:p-2 rounded-lg md:rounded-xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
              <Smartphone className="h-4 w-4" />
            </div>
          ) : (
            <button
              onClick={() => navigate('/devices')}
              className="p-1.5 md:p-2 rounded-lg md:rounded-xl bg-gray-800 text-gray-300 hover:text-white transition"
              title="Back to Devices"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          <div>
            <h2 className="text-sm md:text-base font-bold text-white flex items-center gap-2">
              <span className="truncate max-w-[140px] md:max-w-none">{device?.device_name || 'Android Device'}</span>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                  status === 'connected'
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                    : 'bg-red-500/10 text-red-400 border-red-500/30'
                }`}
              >
                {status}
              </span>
            </h2>
            <div className="text-[10px] md:text-xs text-gray-400 flex items-center gap-1.5 flex-wrap">
              <span>{device?.manufacturer} {device?.model} • Android {device?.android_version}</span>
              {device?.adb_serial && (
                <>
                  <span>•</span>
                  <span className="font-mono text-emerald-400 font-bold bg-emerald-950/40 px-1.5 py-0.5 rounded border border-emerald-500/30 select-all">
                    SN: {device.adb_serial}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Status Indicators & Action Buttons */}
        <div className="flex items-center gap-1.5 md:gap-3 text-xs">
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-800/80 border border-gray-700/60 text-gray-300">
            <Radio className="h-3.5 w-3.5 text-emerald-400 animate-pulse" />
            <span>{fps} FPS</span>
            <span className="text-gray-500">|</span>
            <span>{latency}ms</span>
          </div>

          <div className="hidden md:flex items-center gap-1 bg-gray-800/80 border border-gray-700/60 rounded-lg p-0.5 text-xs">
            {(['high', 'medium', 'low'] as const).map((q) => (
              <button
                key={q}
                onClick={() => setQuality(q)}
                className={`px-2 py-0.5 rounded uppercase text-[10px] font-semibold transition ${
                  quality === q ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {q}
              </button>
            ))}
          </div>

          <button
            onClick={toggleAudio}
            className={`flex items-center gap-1.5 px-2 md:px-3 py-1 md:py-1.5 rounded-lg text-xs font-semibold transition ${
              !isMuted
                ? 'bg-blue-600/30 text-blue-400 border border-blue-500/40 shadow-lg shadow-blue-500/20'
                : 'bg-gray-800 text-gray-400 hover:text-gray-200 border border-gray-700'
            }`}
            title={isMuted ? 'Click to Enable Audio' : 'Click to Mute Audio'}
          >
            {!isMuted ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{!isMuted ? 'Audio: LIVE' : 'Audio: MUTED'}</span>
          </button>

          <button
            onClick={() => setShowKeyboardInput(!showKeyboardInput)}
            disabled={!canControl}
            className={`flex items-center gap-1.5 px-2 md:px-3 py-1 md:py-1.5 rounded-lg text-xs font-semibold transition ${
              showKeyboardInput
                ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/30'
                : 'bg-gray-800 text-gray-300 hover:text-white border border-gray-700'
            }`}
            title="Type or paste text directly into remote device"
          >
            <Keyboard className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Type</span>
          </button>

          <button
            onClick={refreshStream}
            className="p-1 md:px-2.5 md:py-1.5 rounded-lg bg-gray-800 hover:bg-cyan-600/20 text-cyan-400 border border-gray-700 hover:border-cyan-500/40 transition active:scale-95"
            title="Refresh Stream Now"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>

          <button
            onClick={toggleFullscreen}
            className="p-1.5 rounded-lg bg-gray-800 text-gray-300 hover:text-white border border-gray-700"
            title="Fullscreen"
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Quick Text Input Prompt Bar */}
      {showKeyboardInput && (
        <form
          onSubmit={handleSendTextSubmit}
          className="flex items-center gap-2 p-3 bg-gray-900/90 border border-purple-500/40 rounded-2xl backdrop-blur shadow-xl animate-in fade-in slide-in-from-top duration-200"
        >
          <Keyboard className="h-4 w-4 text-purple-400 shrink-0 ml-1" />
          <input
            type="text"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder="Type or paste text to inject into device (e.g. passwords, links, messages)..."
            className="flex-1 bg-gray-950/80 border border-gray-700 focus:border-purple-500 text-white text-xs px-3 py-2 rounded-xl outline-none"
            autoFocus
          />
          <button
            type="submit"
            className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition shadow-lg shadow-purple-600/30 active:scale-95"
          >
            Send
          </button>
          <button
            type="button"
            onClick={() => setShowKeyboardInput(false)}
            className="px-3 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-semibold transition"
          >
            Close
          </button>
        </form>
      )}

      {/* Screen Viewer Centerpiece: Dynamic aspect ratio filling mobile/desktop viewports */}
      <div className="flex-1 flex items-center justify-center p-0 md:p-2 relative min-h-0 w-full overflow-hidden">
        {/* Device Container: Maximizes space on mobile, elegant frame on desktop */}
        <div
          style={{
            aspectRatio: (streamDimensions?.width && streamDimensions?.height)
              ? `${streamDimensions.width} / ${streamDimensions.height}`
              : (videoRef.current?.videoWidth && videoRef.current?.videoHeight)
              ? `${videoRef.current.videoWidth} / ${videoRef.current.videoHeight}`
              : (device?.screen_width && device?.screen_height)
              ? `${device.screen_width} / ${device.screen_height}`
              : '9 / 19.5',
            touchAction: 'none',
          }}
          className="relative max-h-[calc(100dvh-70px)] md:max-h-[calc(100vh-140px)] w-auto max-w-full rounded-lg md:rounded-3xl bg-black border border-gray-800/80 md:border-4 md:border-gray-800 shadow-2xl overflow-hidden flex items-center justify-center transition-all duration-200"
        >
          {/* Hardware Accelerated ws-scrcpy Video Player */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            onLoadedMetadata={() => {
              if (videoRef.current?.videoWidth && videoRef.current?.videoHeight) {
                setStreamDimensions({
                  width: videoRef.current.videoWidth,
                  height: videoRef.current.videoHeight,
                });
              }
            }}
            onResize={() => {
              if (videoRef.current?.videoWidth && videoRef.current?.videoHeight) {
                setStreamDimensions({
                  width: videoRef.current.videoWidth,
                  height: videoRef.current.videoHeight,
                });
              }
            }}
            className="w-full h-full object-contain pointer-events-none select-none"
          />

          {/* Fallback Canvas */}
          <canvas
            ref={canvasRef}
            width={streamDimensions?.width || device?.screen_width || 720}
            height={streamDimensions?.height || device?.screen_height || 1600}
            className="hidden"
          />

          {/* Interactive touch/click gesture overlay with zero-delay Pointer Events */}
          <div
            ref={overlayRef}
            tabIndex={0}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onKeyDown={handleKeyDown}
            style={{ touchAction: 'none' }}
            className={`absolute inset-0 z-10 select-none outline-none ${canControl ? 'cursor-pointer' : 'cursor-default'}`}
          />

          {/* Pretty Printed Subscription Expired Overlay */}
          {status === 'subscription-expired' ? (
            <div className="absolute inset-0 z-30 bg-gray-950/95 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center space-y-4 animate-in fade-in zoom-in-95 duration-200">
              <div className="relative">
                <div className="absolute -inset-1 rounded-full bg-red-500/30 blur-lg animate-pulse" />
                <div className="relative h-16 w-16 rounded-2xl bg-red-950/80 border-2 border-red-500/50 flex items-center justify-center text-red-400 shadow-2xl">
                  <Lock className="h-8 w-8" />
                </div>
              </div>

              <div className="space-y-1 max-w-md">
                <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-red-500/20 text-red-400 border border-red-500/30 mb-1">
                  Streaming Suspended
                </span>
                <h2 className="text-xl font-extrabold text-white tracking-tight">
                  Subscription Plan Expired
                </h2>
                <p className="text-xs text-gray-300 leading-relaxed">
                  {errorMessage || 'Your monthly subscription plan is past due. Live device streaming and interactive controls are locked until your subscription is renewed.'}
                </p>
              </div>

              <div className="w-full max-w-sm p-3.5 rounded-xl bg-gray-900/90 border border-gray-800 text-left space-y-2 text-xs">
                <div className="flex items-center justify-between text-gray-400">
                  <span>Stream Status</span>
                  <span className="font-semibold text-rose-400">Blocked by Server</span>
                </div>
                <div className="flex items-center justify-between text-gray-400">
                  <span>Plan Options</span>
                  <span className="font-semibold text-white">Starter ($80) / Enterprise ($100)</span>
                </div>
                <div className="flex items-center justify-between text-gray-400">
                  <span>In-App Payment</span>
                  <span className="font-semibold text-emerald-400">Instant Paystack Unlock</span>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-2.5 w-full max-w-sm pt-1">
                <button
                  onClick={() => navigate('/subscription')}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold text-xs shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2 transition transform active:scale-95"
                >
                  <CreditCard className="h-4 w-4" />
                  <span>Renew Plan Now</span>
                </button>
                <a
                  href="tel:+254706499848"
                  className="py-2.5 px-3 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 font-semibold text-xs flex items-center justify-center gap-1.5 transition"
                >
                  <Phone className="h-3.5 w-3.5 text-emerald-400" />
                  <span>Support</span>
                </a>
              </div>
            </div>
          ) : status !== 'connected' && (
            <div className="absolute inset-0 z-20 bg-gray-950/80 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center space-y-3">
              <Smartphone className="h-10 w-10 text-gray-500 animate-bounce" />
              <div className="text-sm font-semibold text-gray-200">
                {status === 'connecting' ? 'Establishing scrcpy cloud stream...' : 'Device stream currently offline'}
              </div>
              <p className="text-xs text-gray-400 max-w-xs">
                {status === 'connecting'
                  ? 'Connecting to Windows agent over WebRTC video bridge...'
                  : 'Ensure your Windows agent is active and phone is attached.'}
              </p>
              {status === 'offline' && (
                <button
                  onClick={() => connectStream()}
                  className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold"
                >
                  Reconnect
                </button>
              )}
            </div>
          )}
        </div>

        {/* Mobile Side Controls Toggle Pill: lets user hide/unhide with 1 tap */}
        <button
          onClick={() => setShowSideControls((prev) => !prev)}
          className="md:hidden absolute right-0 top-1/2 -translate-y-1/2 z-40 p-2 rounded-l-2xl bg-gray-900/95 border-l border-y border-gray-700/80 text-gray-300 hover:text-white shadow-2xl transition-all active:scale-95 flex items-center justify-center backdrop-blur-md"
          title={showSideControls ? 'Hide Side Controls' : 'Show Side Controls'}
        >
          {showSideControls ? <ChevronRight className="h-4 w-4 text-cyan-400" /> : <ChevronLeft className="h-4 w-4 text-gray-300" />}
        </button>

        {/* Side Controls Toolbar: Always docked on desktop, toggleable slide-in on mobile */}
        <div
          className={`${
            showSideControls ? 'flex' : 'hidden md:flex'
          } absolute right-1 sm:right-3 md:relative md:right-0 md:ml-4 z-30 flex flex-col items-center gap-1.5 md:gap-2 p-1.5 md:p-2 bg-gray-900/95 backdrop-blur-md rounded-2xl border border-gray-800/80 shadow-2xl animate-in fade-in slide-in-from-right duration-150`}
        >
          {/* Power: Wake / Sleep Screen */}
          <button
            onClick={() => {
              sendInput('power');
              setTimeout(refreshStream, 250);
            }}
            disabled={!canControl}
            className="p-2 md:p-2.5 rounded-xl hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 transition active:scale-90 active:bg-rose-500/30"
            title="Power (Wake / Sleep Screen)"
          >
            <Power className="h-4 w-4 md:h-5 md:w-5" />
          </button>

          {/* Volume Up */}
          <button
            onClick={() => sendInput('volume_up')}
            disabled={!canControl}
            className="p-2 md:p-2.5 rounded-xl hover:bg-emerald-500/20 text-emerald-400 hover:text-emerald-300 transition active:scale-90 active:bg-emerald-500/30"
            title="Volume Up"
          >
            <Volume2 className="h-4 w-4 md:h-5 md:w-5" />
          </button>

          {/* Volume Down */}
          <button
            onClick={() => sendInput('volume_down')}
            disabled={!canControl}
            className="p-2 md:p-2.5 rounded-xl hover:bg-emerald-500/20 text-emerald-400 hover:text-emerald-300 transition active:scale-90 active:bg-emerald-500/30"
            title="Volume Down"
          >
            <Volume1 className="h-4 w-4 md:h-5 md:w-5" />
          </button>

          <div className="w-4 h-[1px] bg-gray-700/80 my-0.5"></div>

          {/* Recent Apps */}
          <button
            onClick={() => sendInput('recents')}
            disabled={!canControl}
            className="p-2 md:p-2.5 rounded-xl hover:bg-purple-500/20 text-purple-400 hover:text-purple-300 transition active:scale-90 active:bg-purple-500/30"
            title="Recent Apps (Overview)"
          >
            <Layers className="h-4 w-4 md:h-5 md:w-5" />
          </button>

          {/* Home */}
          <button
            onClick={() => sendInput('home')}
            disabled={!canControl}
            className="p-2 md:p-2.5 rounded-xl hover:bg-blue-500/20 text-blue-400 hover:text-blue-300 transition active:scale-90 active:bg-blue-500/30"
            title="Home Screen"
          >
            <Circle className="h-4 w-4 md:h-5 md:w-5" />
          </button>

          {/* Back */}
          <button
            onClick={() => sendInput('back')}
            disabled={!canControl}
            className="p-2 md:p-2.5 rounded-xl hover:bg-amber-500/20 text-amber-400 hover:text-amber-300 transition active:scale-90 active:bg-amber-500/30"
            title="Back"
          >
            <ArrowLeft className="h-4 w-4 md:h-5 md:w-5" />
          </button>

          <div className="w-4 h-[1px] bg-gray-700/80 my-0.5"></div>

          {/* Rotate Orientation: instant 2-way toggle (Portrait <-> Landscape) */}
          <button
            onClick={() => {
              sendInput('rotate');
            }}
            disabled={!canControl}
            className="p-2 md:p-2.5 rounded-xl hover:bg-indigo-500/20 text-indigo-400 hover:text-indigo-300 transition active:scale-90 active:bg-indigo-500/30"
            title="Rotate Screen Orientation"
          >
            <RotateCw className="h-4 w-4 md:h-5 md:w-5" />
          </button>

          <div className="w-4 h-[1px] bg-gray-700/80 my-0.5"></div>

          {/* Direction B: Remote Mic Transmit (PC Mic -> Phone Audio) */}
          <button
            onClick={toggleMicTransmission}
            disabled={!canControl}
            className={`p-2 md:p-2.5 rounded-xl transition active:scale-90 relative ${
              isMicTransmitting
                ? 'bg-emerald-500/30 text-emerald-300 ring-2 ring-emerald-500/50 shadow-lg shadow-emerald-500/20'
                : 'hover:bg-emerald-500/20 text-emerald-400 hover:text-emerald-300'
            }`}
            title={isMicTransmitting ? 'Transmitting PC Mic (Click to Stop)' : 'Transmit PC Mic to Phone (WhatsApp Voice & Surveys)'}
          >
            {isMicTransmitting ? (
              <Mic className="h-4 w-4 md:h-5 md:w-5 animate-pulse text-emerald-400" />
            ) : (
              <MicOff className="h-4 w-4 md:h-5 md:w-5" />
            )}
            {isMicTransmitting && (
              <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
              </span>
            )}
          </button>

          {/* Direction B: Inject Photo to Camera (KYC Selfies & Receipts) */}
          <button
            onClick={() => setShowCameraModal(true)}
            disabled={!canControl}
            className="p-2 md:p-2.5 rounded-xl hover:bg-amber-500/20 text-amber-400 hover:text-amber-300 transition active:scale-90 active:bg-amber-500/30 relative"
            title="Inject Photo to Camera / Gallery (KYC & Selfies)"
          >
            <Camera className="h-4 w-4 md:h-5 md:w-5" />
            {cameraInjectStatus === 'success' && (
              <span className="absolute -top-1 -right-1 flex h-2 w-2 rounded-full bg-emerald-400"></span>
            )}
          </button>

          {/* Direction B: Live Face Optical Stream (WhatsApp Video & Face Liveness) */}
          <button
            onClick={showOpticalVideoModal ? stopWebcamOpticalFeed : startWebcamOpticalFeed}
            disabled={!canControl}
            className={`p-2 md:p-2.5 rounded-xl transition active:scale-90 ${
              showOpticalVideoModal
                ? 'bg-purple-500/30 text-purple-300 ring-2 ring-purple-500/50 shadow-lg shadow-purple-500/20'
                : 'hover:bg-purple-500/20 text-purple-400 hover:text-purple-300'
            }`}
            title="Live Face Optical Stream (WhatsApp Video Calls & Liveness)"
          >
            <Video className="h-4 w-4 md:h-5 md:w-5" />
          </button>

          <div className="w-4 h-[1px] bg-gray-700/80 my-0.5"></div>

          {/* Refresh Stream */}
          <button
            onClick={refreshStream}
            className="p-2 md:p-2.5 rounded-xl hover:bg-cyan-500/20 text-cyan-400 hover:text-cyan-300 transition active:scale-90 active:bg-cyan-500/30"
            title="Refresh Stream Now"
          >
            <RotateCcw className="h-4 w-4 md:h-5 md:w-5" />
          </button>

          {/* Reboot Device */}
          <button
            onClick={handleRebootDevice}
            disabled={!canControl}
            className="p-2 md:p-2.5 rounded-xl hover:bg-red-500/20 text-red-400 hover:text-red-300 transition active:scale-90 active:bg-red-500/30"
            title="Reboot Android Device"
          >
            <RefreshCw className="h-4 w-4 md:h-5 md:w-5" />
          </button>
        </div>
      </div>

      {/* MODAL 1: Camera Photo Injector (Direction B: Photo/Receipt/Selfie) */}
      {showCameraModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md p-6 shadow-2xl relative text-left">
            <button
              onClick={() => setShowCameraModal(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-white p-1 rounded-lg hover:bg-gray-800 transition"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex items-center space-x-3 mb-4">
              <div className="p-3 bg-amber-500/20 rounded-xl text-amber-400">
                <Camera className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Inject Photo to Phone Camera</h3>
                <p className="text-xs text-gray-400">Pushes directly to /sdcard/DCIM/Camera with zero EXIF leaks</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="border-2 border-dashed border-gray-700 hover:border-amber-500/50 rounded-xl p-6 text-center transition cursor-pointer relative bg-gray-950/50">
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleInjectPhoto(file);
                  }}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                />
                <div className="flex flex-col items-center space-y-2">
                  <Upload className="h-8 w-8 text-amber-400" />
                  <span className="text-sm font-medium text-gray-300">Click or drag & drop photo here</span>
                  <span className="text-[11px] text-gray-500">Selfie, ID card, or receipt (JPG, PNG, WebP)</span>
                </div>
              </div>

              {/* Status / Feedback message */}
              {cameraInjectStatus !== 'idle' && (
                <div
                  className={`p-3 rounded-xl text-xs font-medium flex items-center space-x-2 ${
                    cameraInjectStatus === 'uploading'
                      ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                      : cameraInjectStatus === 'success'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'bg-red-500/20 text-red-300 border border-red-500/30'
                  }`}
                >
                  {cameraInjectStatus === 'success' ? (
                    <Check className="h-4 w-4 text-emerald-400 shrink-0" />
                  ) : (
                    <div className="h-2 w-2 rounded-full bg-current animate-pulse shrink-0"></div>
                  )}
                  <span>{cameraInjectMsg}</span>
                </div>
              )}

              <div className="bg-gray-950/80 rounded-xl p-3 text-[11px] text-gray-400 space-y-1 border border-gray-800">
                <p className="font-semibold text-gray-300 flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5 text-emerald-400" /> Automatic Stealth Sanitization Active:
                </p>
                <p>• All PC GPS and computer timezone metadata is stripped in your browser.</p>
                <p>• Pushed directly to Android's camera album and indexed by MediaScanner.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Live Face Optical Stream (WhatsApp Video & Face Liveness) */}
      {showOpticalVideoModal && (
        <div className="fixed bottom-6 right-6 z-50 w-72 md:w-80 bg-gray-950 border-2 border-purple-500/60 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
          <div className="bg-purple-950/80 px-4 py-2.5 flex items-center justify-between border-b border-purple-800/50">
            <div className="flex items-center space-x-2">
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
              </span>
              <span className="text-xs font-bold text-purple-200">Live Face Optical Feed</span>
            </div>
            <button
              onClick={stopWebcamOpticalFeed}
              className="text-purple-300 hover:text-white p-1 rounded-lg hover:bg-purple-900/50 transition"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="relative aspect-[3/4] bg-black overflow-hidden flex items-center justify-center">
            <video
              ref={webcamVideoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover -scale-x-100"
            />
            {/* Liveness Alignment Face Oval Guide */}
            <div className="absolute inset-x-8 inset-y-10 border-2 border-dashed border-purple-400/50 rounded-[50%] pointer-events-none flex items-center justify-center">
              <span className="text-[10px] text-purple-300/80 bg-black/60 px-2 py-0.5 rounded-full font-medium">
                Align Face Here
              </span>
            </div>
          </div>

          <div className="p-2.5 bg-gray-900/90 text-[11px] text-gray-400 border-t border-gray-800 text-center">
            Position phone front camera towards this feed for live KYC / WhatsApp video calls.
          </div>
        </div>
      )}
    </div>
  );
};
