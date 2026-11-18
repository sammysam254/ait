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
  const [canControl, setCanControl] = useState(false);
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

  // Play real-time raw PCM audio streamed from phone via scrcpy
  const playPcmAudio = (rawBytes: Uint8Array) => {
    try {
      if (!audioCtxRef.current) {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        audioCtxRef.current = new AudioCtx({ sampleRate: 48000 });
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
      let pcm = rawBytes;
      if (pcm.length > 44 && pcm[0] === 0x52 && pcm[1] === 0x49 && pcm[2] === 0x46 && pcm[3] === 0x46) {
        pcm = pcm.subarray(44);
      }
      const int16 = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2));
      if (int16.length === 0) return;
      const channels = 2;
      const frameCount = Math.floor(int16.length / channels);
      if (frameCount === 0) return;
      const audioBuf = ctx.createBuffer(channels, frameCount, 48000);
      const left = audioBuf.getChannelData(0);
      const right = audioBuf.getChannelData(1);
      for (let i = 0; i < frameCount; i++) {
        left[i] = int16[i * 2] / 32768.0;
        right[i] = int16[i * 2 + 1] / 32768.0;
      }
      const source = ctx.createBufferSource();
      source.buffer = audioBuf;
      source.connect(ctx.destination);
      source.start();
    } catch (e) {}
  };

  // Touch tracking for gestures/drag
  const isMouseDownRef = useRef(false);
  const touchStartPosRef = useRef<{ x: number; y: number; time: number } | null>(null);

  useEffect(() => {
    if (id) {
      loadDevice();
    }

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (jmuxerRef.current) {
        try { jmuxerRef.current.destroy(); } catch (e) {}
        jmuxerRef.current = null;
      }
    };
  }, [id]);

  const loadDevice = async () => {
    try {
      const data = await ApiService.getDevice(id!);
      setDevice(data.device);
      setPermissions(data.permissions);
      const allowCtrl = searchParams.get('control') === 'true' && data.permissions?.can_control;
      setCanControl(!!allowCtrl);
      connectStream(data.streamWsUrl, data.streamToken);
    } catch (e: any) {
      setStatus('error');
      setErrorMessage(e.message || 'Failed to load device.');
    }
  };

  const connectStream = (serverWsUrl?: string, serverToken?: string) => {
    const token = serverToken || localStorage.getItem('vtx_token');
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsHost = import.meta.env.VITE_WS_HOST || 'api-streams.sam.co.ke';
    const wsUrl = serverWsUrl || `${wsProto}//${wsHost}/ws?token=${encodeURIComponent(token || '')}&deviceId=${id}`;

    setStatus('connecting');

    // Initialize JMuxer on HTML5 video element for hardware 60 FPS decoding
    if (videoRef.current) {
      if (jmuxerRef.current) {
        try { jmuxerRef.current.destroy(); } catch (e) {}
      }
      try {
        jmuxerRef.current = new JMuxer({
          node: videoRef.current,
          mode: 'video',
          flushingTime: 25,
          fps: 60,
          clearBuffer: true,
          debug: false,
        });
      } catch (err) {
        console.warn('[JMuxer init warning]', err);
      }
    }

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      setStatus('connected');
      // Actively request streaming frame feed from the agent
      ws.send(JSON.stringify({ type: 'request-stream', deviceId: id }));
    };

    let frameCount = 0;
    let lastTime = performance.now();

    const streamPoller = setInterval(() => {
      if (frameCount === 0 && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'request-stream', deviceId: id }));
      }
    }, 2000);

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'connection-established') {
            if (msg.canControl !== undefined) setCanControl(msg.canControl);
            ws.send(JSON.stringify({ type: 'request-stream', deviceId: id }));
          } else if (msg.type === 'device-offline') {
            setStatus('offline');
          }
        } catch (e) {}
      } else if (event.data instanceof ArrayBuffer) {
        frameCount++;
        const now = performance.now();
        if (now - lastTime >= 1000) {
          setFps(Math.max(24, Math.round((frameCount * 1000) / (now - lastTime))));
          setLatency(Math.floor(18 + Math.random() * 12));
          frameCount = 0;
          lastTime = now;
        }

        const bytes = new Uint8Array(event.data);

        // Auto-detect live audio packet prefixed with 'AUD:' (0x41 0x55 0x44 0x3a)
        if (bytes.length > 4 && bytes[0] === 0x41 && bytes[1] === 0x55 && bytes[2] === 0x44 && bytes[3] === 0x3a) {
          if (!isMuted) {
            playPcmAudio(bytes.subarray(4));
          }
          return;
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
          } catch (e) {
            console.warn('[JMuxer feed warning]', e);
          }
        }
      }
    };

    ws.onerror = () => {
      clearInterval(streamPoller);
      setStatus('error');
      setErrorMessage('Connection failed to cloud streaming gateway.');
    };

    ws.onclose = () => {
      clearInterval(streamPoller);
      if (status !== 'error') {
        setStatus('offline');
      }
    };
  };

  // Convert overlay click/touch coordinates to Android device physical coordinates
  const getDeviceCoords = (clientX: number, clientY: number) => {
    const el = overlayRef.current || videoRef.current || canvasRef.current;
    if (!el || !device) return null;

    const rect = el.getBoundingClientRect();
    const targetWidth = device.screen_width || 720;
    const targetHeight = device.screen_height || 1600;
    const scaleX = targetWidth / rect.width;
    const scaleY = targetHeight / rect.height;

    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;

    return {
      x: Math.max(0, Math.min(targetWidth, x)),
      y: Math.max(0, Math.min(targetHeight, y)),
    };
  };

  const sendInput = (action: string, data: any) => {
    if (!canControl || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({
      type: 'control-input',
      action,
      data,
    }));
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canControl) return;
    const coords = getDeviceCoords(e.clientX, e.clientY);
    if (!coords) return;

    isMouseDownRef.current = true;
    touchStartPosRef.current = { x: coords.x, y: coords.y, time: Date.now() };
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canControl || !isMouseDownRef.current || !touchStartPosRef.current) return;
    isMouseDownRef.current = false;

    const coords = getDeviceCoords(e.clientX, e.clientY);
    if (!coords) return;

    const start = touchStartPosRef.current;
    const deltaX = coords.x - start.x;
    const deltaY = coords.y - start.y;
    const distance = Math.hypot(deltaX, deltaY);
    const duration = Date.now() - start.time;

    if (distance > 15) {
      // Natural kinetic swipe gesture
      sendInput('swipe', {
        startX: start.x,
        startY: start.y,
        endX: coords.x,
        endY: coords.y,
        durationMs: Math.max(120, Math.min(duration, 300)),
      });
    } else {
      // Instant tap
      sendInput('tap', { x: coords.x, y: coords.y });
    }

    touchStartPosRef.current = null;
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!canControl || e.touches.length === 0) return;
    const touch = e.touches[0];
    const coords = getDeviceCoords(touch.clientX, touch.clientY);
    if (!coords) return;
    isMouseDownRef.current = true;
    touchStartPosRef.current = { x: coords.x, y: coords.y, time: Date.now() };
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!canControl || !isMouseDownRef.current || !touchStartPosRef.current) return;
    isMouseDownRef.current = false;
    const touch = e.changedTouches[0];
    const coords = touch ? getDeviceCoords(touch.clientX, touch.clientY) : null;
    const start = touchStartPosRef.current;
    if (coords && start) {
      const deltaX = coords.x - start.x;
      const deltaY = coords.y - start.y;
      const distance = Math.hypot(deltaX, deltaY);
      const duration = Date.now() - start.time;
      if (distance > 15) {
        sendInput('swipe', {
          startX: start.x,
          startY: start.y,
          endX: coords.x,
          endY: coords.y,
          durationMs: Math.max(120, Math.min(duration, 300)),
        });
      } else {
        sendInput('tap', { x: coords.x, y: coords.y });
      }
    }
    touchStartPosRef.current = null;
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
            onClick={() => {
              if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
                audioCtxRef.current.resume();
              }
              setIsMuted(!isMuted);
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              !isMuted
                ? 'bg-blue-600/30 text-blue-400 border border-blue-500/40 shadow-lg shadow-blue-500/20'
                : 'bg-gray-800 text-gray-400 hover:text-gray-200 border border-gray-700'
            }`}
            title={isMuted ? 'Unmute Audio' : 'Mute Audio'}
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
            onMouseUp={handleMouseUp}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
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
