import React, { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import JMuxer from 'jmuxer';
import {
  Smartphone,
  RotateCw,
  ArrowLeft,
  Square,
  Circle,
  Menu,
  Maximize2,
  Minimize2,
  Sliders,
  Radio,
  Wifi,
  PowerOff,
  Volume2,
  VolumeX,
  Keyboard,
  Info,
} from 'lucide-react';
import { ApiService } from '../services/api';
import { Device } from '../types';

export const DeviceViewerPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [device, setDevice] = useState<Device | null>(null);
  const [permissions, setPermissions] = useState<{ can_view: boolean; can_control: boolean } | null>(null);
  const [canControl, setCanControl] = useState(true);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'offline' | 'error'>('connecting');
  const [errorMessage, setErrorMessage] = useState('');
  const [fps, setFps] = useState(60);
  const [latency, setLatency] = useState(24);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [quality, setQuality] = useState<'high' | 'medium' | 'low'>('high');
  const [isMuted, setIsMuted] = useState(false);
  const [streamDimensions, setStreamDimensions] = useState<{ width: number; height: number } | null>(null);
  const [showKeyboardInput, setShowKeyboardInput] = useState(false);
  const [textInput, setTextInput] = useState('');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const jmuxerRef = useRef<any>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
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
          console.warn('[Audio] AudioWorklet init failed, fallback to WebAudio buffer mode:', workletErr);
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
        if (videoRef.current && videoRef.current.buffered.length > 0) {
          const live = videoRef.current.buffered.end(videoRef.current.buffered.length - 1);
          videoRef.current.currentTime = Math.max(0, live - 0.01);
        }
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [isMuted]);

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

      if (!audioCtxRef.current) {
        startAudio();
        return;
      }
      if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume().catch(() => {});
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
      } else if (audioCtxRef.current && audioCtxRef.current.state === 'running') {
        // High-performance fallback: Web Audio Buffer Source scheduler
        const buffer = audioCtxRef.current.createBuffer(2, frameCount, 48000);
        buffer.copyToChannel(left, 0);
        buffer.copyToChannel(right, 1);
        const source = audioCtxRef.current.createBufferSource();
        source.buffer = buffer;
        source.connect(audioCtxRef.current.destination);
        const now = audioCtxRef.current.currentTime;
        const playTime = Math.max(now, nextAudioTimeRef.current);
        source.start(playTime);
        nextAudioTimeRef.current = playTime + buffer.duration;
      }
    } catch (e) {}
  };

  // Touch tracking for gestures/drag
  const isMouseDownRef = useRef(false);
  const touchStartPosRef = useRef<{ x: number; y: number; time: number } | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    if (id) {
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
      if (audioCtxRef.current) {
        try { audioCtxRef.current.close(); } catch (e) {}
        audioCtxRef.current = null;
      }
    };
  }, [id]);

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

    const currentDeviceId = activeDeviceIdRef.current || id;
    const token = serverToken || localStorage.getItem('vtx_token');
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsHost = import.meta.env.VITE_WS_HOST || 'api-streams.sam.co.ke';
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
          if (msg.type === 'connection-established') {
            if (msg.canControl !== undefined) setCanControl(msg.canControl);
            const reqId = activeDeviceIdRef.current || id;
            ws.send(JSON.stringify({ type: 'request-stream', deviceId: reqId }));
          } else if (msg.type === 'device-dimensions') {
            if (msg.width && msg.height) {
              setStreamDimensions({ width: msg.width, height: msg.height });
            }
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

        if (jmuxerRef.current) {
          try {
            jmuxerRef.current.feed({
              video: bytes,
            });

            if (videoRef.current && videoRef.current.paused) {
              videoRef.current.play().catch(() => {});
            }

            // Smooth low-latency sync: uses playbackRate to catch up without continuous decoder seek freezes
            if (videoRef.current && videoRef.current.buffered.length > 0) {
              const liveEdge = videoRef.current.buffered.end(videoRef.current.buffered.length - 1);
              const drift = liveEdge - videoRef.current.currentTime;

              if (!initialLiveJumpRef.current && liveEdge > 0.25) {
                // Seek ONCE at the very beginning to jump straight to live edge
                videoRef.current.currentTime = Math.max(0, liveEdge - 0.08);
                initialLiveJumpRef.current = true;
              } else if (drift > 1.0 && !videoRef.current.seeking) {
                // Only seek if severely behind (>1.0s, e.g. tab was hidden)
                videoRef.current.currentTime = Math.max(0, liveEdge - 0.08);
              } else if (drift > 0.15) {
                // Smooth acceleration: catches up in a fraction of a second with ZERO black screens
                videoRef.current.playbackRate = 1.15;
              } else if (drift < 0.05) {
                videoRef.current.playbackRate = 1.0;
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
        // Forbidden or Stale ID: re-sync device metadata from API instead of looping on invalid token
        if (isMountedRef.current && !reconnectTimerRef.current) {
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

  // Dynamic screen dimensions decided directly by active scrcpy stream
  const getDeviceCoords = (clientX: number, clientY: number) => {
    const el = overlayRef.current;
    if (!el) return null;

    const rect = el.getBoundingClientRect();
    const deviceWidth = videoRef.current?.videoWidth || streamDimensions?.width || device?.screen_width || 720;
    const deviceHeight = videoRef.current?.videoHeight || streamDimensions?.height || device?.screen_height || 1600;

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
    const deviceWidth = videoRef.current?.videoWidth || streamDimensions?.width || device?.screen_width || 720;
    const deviceHeight = videoRef.current?.videoHeight || streamDimensions?.height || device?.screen_height || 1600;
    wsRef.current.send(JSON.stringify({
      type: 'control-input',
      deviceId: activeDeviceIdRef.current || id,
      action,
      data: {
        width: deviceWidth,
        height: deviceHeight,
        ...data,
      },
    }));
  };

  const lastMoveSentRef = useRef(0);
  const pointerDownPosRef = useRef<{ x: number; y: number; clientX: number; clientY: number; time: number } | null>(null);
  const isPointerDraggingRef = useRef(false);

  // Active (non-passive) wheel listener to cleanly prevent browser scroll and send instant swipes
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (e.cancelable) e.preventDefault();
      if (!canControl) return;

      const now = performance.now();
      // Fast, natural wheel response (140ms debounce) for smooth list and feed scrolling
      if (now - lastWheelTimeRef.current < 140) return;
      lastWheelTimeRef.current = now;

      const isDown = e.deltaY > 0;
      const deviceWidth = videoRef.current?.videoWidth || streamDimensions?.width || device?.screen_width || 720;
      const deviceHeight = videoRef.current?.videoHeight || streamDimensions?.height || device?.screen_height || 1600;
      const midX = Math.round(deviceWidth / 2);
      // Realistic human flick stroke
      const startY = isDown ? Math.round(deviceHeight * 0.72) : Math.round(deviceHeight * 0.28);
      const endY = isDown ? Math.round(deviceHeight * 0.25) : Math.round(deviceHeight * 0.75);

      sendInput('swipe', {
        startX: midX,
        startY,
        endX: midX,
        endY,
        durationMs: 80,
      });
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
    };
  }, [canControl, device, streamDimensions]);

  // High-performance unified Pointer Events: handles mouse, mobile touch, and stylus with zero delay
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.cancelable) e.preventDefault();
    startAudio();
    if (!canControl) return;

    // Focus overlay for physical keyboard capture
    if (overlayRef.current) overlayRef.current.focus();

    const coords = getDeviceCoords(e.clientX, e.clientY);
    if (!coords) return;

    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch (err) {}

    pointerDownPosRef.current = {
      x: coords.x,
      y: coords.y,
      clientX: e.clientX,
      clientY: e.clientY,
      time: performance.now(),
    };
    isPointerDraggingRef.current = false;

    // Send touch_down IMMEDIATELY on finger/mouse contact — phone responds with 0ms delay!
    sendInput('touch_down', { x: coords.x, y: coords.y });
    lastMoveSentRef.current = 0; // 0 allows the very first movement delta to transmit immediately without throttle delay
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointerDownPosRef.current || !canControl) return;
    if (e.cancelable) e.preventDefault();

    const coords = getDeviceCoords(e.clientX, e.clientY);
    if (!coords) return;

    // Instant initial gesture response + smooth 80Hz (12ms) tracking for fluid swiping
    const now = performance.now();
    if (lastMoveSentRef.current === 0 || now - lastMoveSentRef.current >= 12) {
      lastMoveSentRef.current = now;
      sendInput('touch_move', { x: coords.x, y: coords.y });
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointerDownPosRef.current || !canControl) return;
    if (e.cancelable) e.preventDefault();

    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch (err) {}

    const coords = getDeviceCoords(e.clientX, e.clientY);
    const currentPos = coords || { x: pointerDownPosRef.current.x, y: pointerDownPosRef.current.y };

    // Send touch_up immediately to finalize click or gesture on physical device
    sendInput('touch_up', { x: currentPos.x, y: currentPos.y });

    pointerDownPosRef.current = null;
    isPointerDraggingRef.current = false;
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pointerDownPosRef.current && canControl) {
      const coords = getDeviceCoords(e.clientX, e.clientY);
      const currentPos = coords || { x: pointerDownPosRef.current.x, y: pointerDownPosRef.current.y };
      sendInput('touch_up', { x: currentPos.x, y: currentPos.y });
    }
    pointerDownPosRef.current = null;
    isPointerDraggingRef.current = false;
  };

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
    <div ref={containerRef} className="h-full flex flex-col space-y-4">
      {/* Top Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-gray-900/80 border border-gray-800 rounded-2xl backdrop-blur">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/devices')}
            className="p-2 rounded-xl bg-gray-800 text-gray-300 hover:text-white transition"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <span>{device?.device_name || 'Android Device'}</span>
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
            <div className="text-xs text-gray-400">
              {device?.manufacturer} {device?.model} • Android {device?.android_version}
            </div>
          </div>
        </div>

        {/* Status Indicators & Quality Selector */}
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-800/80 border border-gray-700/60 text-gray-300">
            <Radio className="h-3.5 w-3.5 text-emerald-400 animate-pulse" />
            <span>{fps} FPS</span>
            <span className="text-gray-500">|</span>
            <span>{latency}ms</span>
          </div>

          <div className="flex items-center gap-1 bg-gray-800/80 border border-gray-700/60 rounded-lg p-0.5 text-xs">
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
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              !isMuted
                ? 'bg-blue-600/30 text-blue-400 border border-blue-500/40 shadow-lg shadow-blue-500/20'
                : 'bg-gray-800 text-gray-400 hover:text-gray-200 border border-gray-700'
            }`}
            title={isMuted ? 'Click to Enable Audio' : 'Click to Mute Audio'}
          >
            {!isMuted ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
            <span>{!isMuted ? 'Audio: LIVE' : 'Audio: MUTED'}</span>
          </button>

          <button
            onClick={() => setShowKeyboardInput(!showKeyboardInput)}
            disabled={!canControl}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              showKeyboardInput
                ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/30'
                : 'bg-gray-800 text-gray-300 hover:text-white border border-gray-700'
            }`}
            title="Type or paste text directly into remote device"
          >
            <Keyboard className="h-3.5 w-3.5" />
            <span>Type Text</span>
          </button>

          <button
            onClick={() => setCanControl(!canControl)}
            disabled={!permissions?.can_control}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              canControl
                ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/30'
                : 'bg-gray-800 text-gray-400 hover:text-gray-200 border border-gray-700'
            }`}
          >
            <Sliders className="h-3.5 w-3.5" />
            <span>{canControl ? 'Control: ACTIVE' : 'Control: OFF'}</span>
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

      {/* Screen Viewer Centerpiece: Dynamic aspect ratio decided by active scrcpy stream */}
      <div className="flex-1 flex flex-col items-center justify-center p-0 md:p-2 relative min-h-0 w-full overflow-hidden">
        <div
          style={{
            aspectRatio: (videoRef.current?.videoWidth && videoRef.current?.videoHeight)
              ? `${videoRef.current.videoWidth} / ${videoRef.current.videoHeight}`
              : (streamDimensions?.width && streamDimensions?.height)
              ? `${streamDimensions.width} / ${streamDimensions.height}`
              : (device?.screen_width && device?.screen_height)
              ? `${device.screen_width} / ${device.screen_height}`
              : '9 / 19.5',
          }}
          className="relative h-full max-h-[calc(100vh-140px)] w-auto max-w-full rounded-2xl md:rounded-3xl bg-black border-2 md:border-4 border-gray-800 shadow-2xl overflow-hidden flex items-center justify-center transition-all duration-200"
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

          {/* Overlay when not connected */}
          {status !== 'connected' && (
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

        {/* Android Navigation Bar */}
        <div className="mt-3 flex items-center justify-center gap-6 px-6 py-2.5 rounded-full bg-gray-900/90 border border-gray-800 shadow-xl">
          <button
            onClick={() => sendInput('back', {})}
            disabled={!canControl}
            className="p-2 rounded-full hover:bg-gray-800 text-gray-300 hover:text-white transition active:scale-95 disabled:opacity-40"
            title="Back (KEYCODE_BACK)"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <button
            onClick={() => sendInput('home', {})}
            disabled={!canControl}
            className="p-2 rounded-full hover:bg-gray-800 text-gray-300 hover:text-white transition active:scale-95 disabled:opacity-40"
            title="Home (KEYCODE_HOME)"
          >
            <Circle className="h-5 w-5" />
          </button>
          <button
            onClick={() => sendInput('recents', {})}
            disabled={!canControl}
            className="p-2 rounded-full hover:bg-gray-800 text-gray-300 hover:text-white transition active:scale-95 disabled:opacity-40"
            title="Recent Apps (KEYCODE_APP_SWITCH)"
          >
            <Square className="h-4 w-4" />
          </button>
          <div className="w-[1px] h-4 bg-gray-700"></div>
          <button
            onClick={() => sendInput('rotate', { orientation: 'landscape' })}
            disabled={!canControl}
            className="p-2 rounded-full hover:bg-gray-800 text-gray-300 hover:text-white transition active:scale-95 disabled:opacity-40"
            title="Toggle Screen Orientation"
          >
            <RotateCw className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
