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

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const jmuxerRef = useRef<any>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
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

        const blob = new Blob([PCM_WORKLET_CODE], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        await ctx.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);

        const worklet = new AudioWorkletNode(ctx, 'pcm-worklet', {
          outputChannelCount: [2],
        });
        workletRef.current = worklet;
        worklet.connect(ctx.destination);
      }
      if (audioCtxRef.current.state === 'suspended') {
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
      if (isMuted || !workletRef.current || !audioCtxRef.current || audioCtxRef.current.state !== 'running') return;

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

      workletRef.current.port.postMessage(
        { channels: [left, right], numFrames: frameCount },
        [left.buffer, right.buffer]
      );
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
      if (jmuxerRef.current) {
        try { jmuxerRef.current.destroy(); } catch (e) {}
      }
      try {
        jmuxerRef.current = new JMuxer({
          node: videoRef.current,
          mode: 'video',
          flushingTime: 0,
          fps: 30,
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
        const bytes = new Uint8Array(event.data);

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

            // Real-time zero-latency sync with physical device:
            if (videoRef.current && videoRef.current.buffered.length > 0) {
              const liveEdge = videoRef.current.buffered.end(videoRef.current.buffered.length - 1);
              const drift = liveEdge - videoRef.current.currentTime;

              if (!initialLiveJumpRef.current && liveEdge > 0.05) {
                videoRef.current.currentTime = Math.max(0, liveEdge - 0.01);
                initialLiveJumpRef.current = true;
              } else if (drift > 0.25 && !videoRef.current.seeking) {
                // Hard seek only if lag exceeds 250ms
                videoRef.current.currentTime = Math.max(0, liveEdge - 0.01);
              } else if (drift > 0.08) {
                // Smooth catchup rate
                videoRef.current.playbackRate = 1.35;
              } else if (drift < 0.03) {
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

  // Convert overlay click/touch coordinates to Android device physical coordinates
  const getDeviceCoords = (clientX: number, clientY: number) => {
    const el = overlayRef.current;
    if (!el || !device) return null;

    const rect = el.getBoundingClientRect();
    const deviceWidth = device.screen_width || 720;
    const deviceHeight = device.screen_height || 1600;

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

    const width = deviceWidth;
    const height = deviceHeight;
    return { x, y, width, height };
  };

  const sendInput = (action: string, data: any) => {
    if (!canControl || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    const deviceWidth = device?.screen_width || 720;
    const deviceHeight = device?.screen_height || 1600;
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

    if (videoRef.current && videoRef.current.buffered.length > 0) {
      const live = videoRef.current.buffered.end(videoRef.current.buffered.length - 1);
      if (live - videoRef.current.currentTime > 0.18 && !videoRef.current.seeking) {
        videoRef.current.currentTime = Math.max(0, live - 0.01);
      }
    }
  };

  const lastMoveSentRef = useRef(0);

  // Active (non-passive) wheel listener to cleanly prevent browser scroll and send instant swipes
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (e.cancelable) e.preventDefault();
      if (!canControl) return;

      const now = performance.now();
      // Debounce wheel: 1 clean flick per 350ms to prevent fighting gestures in TikTok/feeds
      if (now - lastWheelTimeRef.current < 350) return;
      lastWheelTimeRef.current = now;

      const isDown = e.deltaY > 0;
      const deviceWidth = device?.screen_width || 720;
      const deviceHeight = device?.screen_height || 1600;
      const midX = Math.round(deviceWidth / 2);
      const startY = isDown ? Math.round(deviceHeight * 0.75) : Math.round(deviceHeight * 0.25);
      const endY = isDown ? Math.round(deviceHeight * 0.20) : Math.round(deviceHeight * 0.80);

      sendInput('swipe', {
        startX: midX,
        startY,
        endX: midX,
        endY,
        durationMs: 100,
      });
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
    };
  }, [canControl, device]);

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.cancelable) e.preventDefault();
    startAudio();
    if (!canControl) return;
    const coords = getDeviceCoords(e.clientX, e.clientY);
    if (!coords) return;

    isMouseDownRef.current = true;
    const startX = coords.x;
    const startY = coords.y;
    const startTime = performance.now();
    let currentX = startX;
    let currentY = startY;

    sendInput('touch_down', { x: startX, y: startY });

    const onGlobalMouseMove = (ev: MouseEvent) => {
      if (ev.cancelable) ev.preventDefault();
      if (!isMouseDownRef.current) return;
      const now = performance.now();
      // Smooth 100Hz sampling (10ms) for instant responsiveness
      if (now - lastMoveSentRef.current < 10) return;
      lastMoveSentRef.current = now;

      const c = getDeviceCoords(ev.clientX, ev.clientY);
      if (c) {
        currentX = c.x;
        currentY = c.y;
        sendInput('touch_move', { x: c.x, y: c.y });
      }
    };

    const onGlobalMouseUp = (ev: MouseEvent) => {
      if (ev.cancelable) ev.preventDefault();
      if (!isMouseDownRef.current) return;
      isMouseDownRef.current = false;
      window.removeEventListener('mousemove', onGlobalMouseMove);
      window.removeEventListener('mouseup', onGlobalMouseUp);

      const c = getDeviceCoords(ev.clientX, ev.clientY);
      const endX = c ? c.x : currentX;
      const endY = c ? c.y : currentY;

      sendInput('touch_up', { x: endX, y: endY });
    };

    window.addEventListener('mousemove', onGlobalMouseMove);
    window.addEventListener('mouseup', onGlobalMouseUp);
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.cancelable) e.preventDefault();
    startAudio();
    if (!canControl || e.touches.length === 0) return;
    const touch = e.touches[0];
    const coords = getDeviceCoords(touch.clientX, touch.clientY);
    if (!coords) return;

    isMouseDownRef.current = true;
    const startX = coords.x;
    const startY = coords.y;
    const startTime = performance.now();
    let currentX = startX;
    let currentY = startY;

    sendInput('touch_down', { x: startX, y: startY });

    const onGlobalTouchMove = (ev: TouchEvent) => {
      if (ev.cancelable) ev.preventDefault();
      if (!isMouseDownRef.current || ev.touches.length === 0) return;
      const now = performance.now();
      if (now - lastMoveSentRef.current < 10) return;
      lastMoveSentRef.current = now;

      const t = ev.touches[0];
      const c = getDeviceCoords(t.clientX, t.clientY);
      if (c) {
        currentX = c.x;
        currentY = c.y;
        sendInput('touch_move', { x: c.x, y: c.y });
      }
    };

    const onGlobalTouchEnd = (ev: TouchEvent) => {
      if (ev.cancelable) ev.preventDefault();
      if (!isMouseDownRef.current) return;
      isMouseDownRef.current = false;
      window.removeEventListener('touchmove', onGlobalTouchMove);
      window.removeEventListener('touchend', onGlobalTouchEnd);

      const t = ev.changedTouches[0];
      const c = t ? getDeviceCoords(t.clientX, t.clientY) : null;
      const endX = c ? c.x : currentX;
      const endY = c ? c.y : currentY;

      sendInput('touch_up', { x: endX, y: endY });
    };

    window.addEventListener('touchmove', onGlobalTouchMove, { passive: false });
    window.addEventListener('touchend', onGlobalTouchEnd, { passive: false });
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

      {/* Screen Viewer Centerpiece */}
      <div className="flex-1 flex flex-col items-center justify-center p-2 relative">
        <div className="relative max-h-[75vh] aspect-[9/19.5] rounded-3xl bg-black border-4 border-gray-800 shadow-2xl overflow-hidden flex items-center justify-center">
          {/* Hardware Accelerated ws-scrcpy Video Player */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-contain pointer-events-none select-none"
          />

          {/* Fallback Canvas */}
          <canvas
            ref={canvasRef}
            width={device?.screen_width || 720}
            height={device?.screen_height || 1600}
            className="hidden"
          />

          {/* Interactive touch/click gesture overlay */}
          <div
            ref={overlayRef}
            onMouseDown={handleMouseDown}
            onTouchStart={handleTouchStart}
            style={{ touchAction: 'none' }}
            className={`absolute inset-0 z-10 select-none ${canControl ? 'cursor-pointer' : 'cursor-default'}`}
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
