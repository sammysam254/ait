import React, { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
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
  const [fps, setFps] = useState(30);
  const [latency, setLatency] = useState(42);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [quality, setQuality] = useState<'high' | 'medium' | 'low'>('high');

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

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

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      setStatus('connected');
      // Actively request streaming frame feed from the agent
      ws.send(JSON.stringify({ type: 'request-stream', deviceId: id }));
    };

    let frameCount = 0;
    let videoDecoder: VideoDecoder | null = null;
    let isDecoderConfigured = false;

    // Initialize WebCodecs hardware H.264 video decoder for ws-scrcpy
    if (typeof window !== 'undefined' && 'VideoDecoder' in window) {
      try {
        videoDecoder = new VideoDecoder({
          output: (frame: VideoFrame) => {
            const canvas = canvasRef.current;
            if (canvas) {
              if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
                canvas.width = frame.displayWidth;
                canvas.height = frame.displayHeight;
              }
              const ctx = canvas.getContext('2d');
              if (ctx) {
                ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
              }
            }
            frame.close();
          },
          error: (err) => {
            console.warn('[ws-scrcpy decoder error]', err);
          },
        });

        videoDecoder.configure({
          codec: 'avc1.42001f', // Baseline Profile level 3.1
          optimizeForLatency: true,
        });
        isDecoderConfigured = true;
      } catch (err) {
        console.warn('[WebCodecs init failed]', err);
        videoDecoder = null;
      }
    }

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
        const bytes = new Uint8Array(event.data);

        // Check for H.264 Annex B NAL unit from scrcpy-server (00 00 00 01 or 00 00 01)
        const isH264 = (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x00 && bytes[3] === 0x01) ||
                       (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01);

        if (isH264 && videoDecoder && isDecoderConfigured && videoDecoder.state === 'configured') {
          try {
            const nalOffset = (bytes[2] === 0x01) ? 3 : 4;
            const nalType = bytes[nalOffset] & 0x1f;
            const isKey = nalType === 5 || nalType === 7 || nalType === 8;

            videoDecoder.decode(new EncodedVideoChunk({
              type: isKey ? 'key' : 'delta',
              timestamp: performance.now() * 1000,
              data: event.data,
            }));
            return;
          } catch (e) {
            // Fallback to image decoder if single packet error
          }
        }

        // Binary image stream from Android (auto-detect JPEG or PNG fallback)
        const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
        const blob = new Blob([event.data], { type: isJpeg ? 'image/jpeg' : 'image/png' });
        const img = new Image();
        const url = URL.createObjectURL(blob);
        img.onload = () => {
          const canvas = canvasRef.current;
          if (canvas) {
            if (canvas.width !== img.naturalWidth || canvas.height !== img.naturalHeight) {
              canvas.width = img.naturalWidth || img.width;
              canvas.height = img.naturalHeight || img.height;
            }
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            }
          }
          URL.revokeObjectURL(url);
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
        };
        img.src = url;
      }
    };

    ws.onerror = () => {
      clearInterval(streamPoller);
      if (videoDecoder && videoDecoder.state !== 'closed') {
        try { videoDecoder.close(); } catch (e) {}
      }
      setStatus('error');
      setErrorMessage('Connection failed to cloud streaming gateway.');
    };

    ws.onclose = () => {
      clearInterval(streamPoller);
      if (videoDecoder && videoDecoder.state !== 'closed') {
        try { videoDecoder.close(); } catch (e) {}
      }
      if (status !== 'error') {
        setStatus('offline');
      }
    };
  };

  // Convert canvas click/touch coordinates to Android device physical coordinates
  const getDeviceCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !device) return null;

    const rect = canvas.getBoundingClientRect();
    const targetWidth = canvas.width || device.screen_width || 720;
    const targetHeight = canvas.height || device.screen_height || 1600;
    const scaleX = targetWidth / rect.width;
    const scaleY = targetHeight / rect.height;

    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

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

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canControl) return;
    const coords = getDeviceCoords(e);
    if (!coords) return;

    isMouseDownRef.current = true;
    touchStartPosRef.current = { x: coords.x, y: coords.y, time: Date.now() };
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canControl || !isMouseDownRef.current || !touchStartPosRef.current) return;
    isMouseDownRef.current = false;

    const coords = getDeviceCoords(e);
    if (!coords) return;

    const start = touchStartPosRef.current;
    const deltaX = coords.x - start.x;
    const deltaY = coords.y - start.y;
    const distance = Math.hypot(deltaX, deltaY);
    const duration = Date.now() - start.time;

    if (distance > 30) {
      // Swipe gesture
      sendInput('swipe', {
        startX: start.x,
        startY: start.y,
        endX: coords.x,
        endY: coords.y,
        durationMs: Math.min(duration, 400),
      });
    } else {
      // Tap gesture
      sendInput('tap', { x: coords.x, y: coords.y });
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
          {/* Active Canvas */}
          <canvas
            ref={canvasRef}
            width={device?.screen_width || 1080}
            height={device?.screen_height || 2400}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            className={`w-full h-full object-contain ${canControl ? 'cursor-pointer' : 'cursor-default'}`}
          />

          {/* Overlay when not connected */}
          {status !== 'connected' && (
            <div className="absolute inset-0 bg-gray-950/80 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center space-y-3">
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
