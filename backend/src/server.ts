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

const app = express();

// Security Middleware
app.use(helmet({
  contentSecurityPolicy: false, // Allow WebRTC / embedded streaming
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

app.use(cors({
  origin: '*',
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health Check Endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'vertex-saas-backend',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/enrollment', enrollmentRoutes);
app.use('/api/agents', agentRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/sharing', sharingRoutes);
app.use('/api/assignments', assignmentRoutes);
app.use('/api/cloudflare', cloudflareRoutes);
app.use('/api/admin', adminRoutes);

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
