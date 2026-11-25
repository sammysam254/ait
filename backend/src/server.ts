import http from 'http';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config';
import { SignalingServer } from './websocket/signalingServer';

// Routes
import authRoutes from './routes/authRoutes';
import enrollmentRoutes from './routes/enrollmentRoutes';
import agentRoutes from './routes/agentRoutes';
import deviceRoutes from './routes/deviceRoutes';
import sharingRoutes from './routes/sharingRoutes';
import assignmentRoutes from './routes/assignmentRoutes';
import cloudflareRoutes from './routes/cloudflareRoutes';
import adminRoutes from './routes/adminRoutes';
import subscriptionRoutes from './routes/subscriptionRoutes';
import domainRoutes from './routes/domainRoutes';

const app = express();

// ─── RATE LIMITING ───────────────────────────────────────────────────────────
// Simple in-memory rate limiter (no extra package required)
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

function rateLimit(maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = (req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
    const key = `${ip}:${req.path}`;
    const now = Date.now();
    const entry = rateLimitStore.get(key);
    if (!entry || now > entry.resetAt) {
      rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    entry.count++;
    if (entry.count > maxRequests) {
      res.setHeader('Retry-After', Math.ceil((entry.resetAt - now) / 1000).toString());
      return res.status(429).json({ error: 'Too many requests. Please slow down and try again shortly.' });
    }
    next();
  };
}

// Clean up old entries every 10 minutes to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of rateLimitStore.entries()) {
    if (now > val.resetAt) rateLimitStore.delete(key);
  }
}, 10 * 60 * 1000);

// ─── SECURITY MIDDLEWARE ──────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,                          // Allow WebRTC / embedded streaming
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow cross-origin resource loading
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true }, // Force HTTPS 1 year
  noSniff: true,           // Prevent MIME sniffing
  xssFilter: true,         // XSS protection header
  hidePoweredBy: true,     // Remove X-Powered-By: Express header
  frameguard: { action: 'deny' }, // Block clickjacking
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

// Hide server fingerprint
app.disable('x-powered-by');
app.disable('etag');

// Restrict CORS to known origins in production
const allowedOrigins = [
  'https://vertext.online',
  'https://www.vertext.online',
  'https://vertextstreams.netlify.app',
  /^https:\/\/[a-z0-9-]+\.vertext\.online$/,  // All customer subdomains
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // Allow server-to-server (agents)
    const allowed = allowedOrigins.some(o =>
      typeof o === 'string' ? o === origin : o.test(origin)
    );
    if (allowed) return callback(null, true);
    callback(new Error(`CORS: Origin ${origin} not permitted.`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'x-vertex-domain', 'x-forwarded-host'],
}));

// Body size limits to prevent payload attacks
app.use(express.json({ limit: '2mb' }));      // Reduced from 10mb – no endpoint needs 10mb JSON
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// ─── SECURITY HEADERS ON ALL RESPONSES ───────────────────────────────────────
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() }); // No version/service info exposed
});

// ─── API ROUTES WITH RATE LIMITING ───────────────────────────────────────────
// Tight limit on auth endpoints to block brute-force
app.use('/api/auth/login',    rateLimit(10, 60_000));   // 10 login attempts / min / IP
app.use('/api/auth/register', rateLimit(5,  60_000));   // 5 registrations / min / IP

// General API: 300 req/min per IP (generous for dashboard polling)
app.use('/api', rateLimit(300, 60_000));

app.use('/api/auth', authRoutes);
app.use('/api/enrollment', enrollmentRoutes);
app.use('/api/agents', agentRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/sharing', sharingRoutes);
app.use('/api/assignments', assignmentRoutes);
app.use('/api/cloudflare', cloudflareRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/domains', domainRoutes);

// ─── BLOCK UNKNOWN ROUTES ─────────────────────────────────────────────────────
app.use('/api/*', (_req: Request, res: Response) => {
  res.status(404).json({ error: 'API endpoint not found.' });
});

// Global Error Handler
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('[ServerError]', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
  });
});

// Create HTTP server
const server = http.createServer(app);

// Keep-alive timeouts configured to prevent Cloudflare/Nginx from abruptly dropping idle or keep-alive sockets
server.keepAliveTimeout = 120000;
server.headersTimeout = 125000;

// Attach WebSocket Signaling Server for WebRTC / Streaming Bridge
const signalingServer = new SignalingServer(server);

// Start listening
server.listen(config.port, () => {
  console.log(`=======================================================`);
  console.log(`🚀 Vertex SaaS Backend running on http://localhost:${config.port}`);
  console.log(`📡 WebSocket Signaling gateway active on ws://localhost:${config.port}/ws`);
  console.log(`🔒 Multi-tenant isolation active`);
  console.log(`=======================================================`);
});

export { app, server, signalingServer };
