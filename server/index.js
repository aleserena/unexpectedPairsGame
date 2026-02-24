import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import crypto from 'crypto';
import express from 'express';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });
import cors from 'cors';
import { registerRoutes } from './routes.js';

const app = express();
app.use(cors());
app.use(express.json());

// Simple request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${duration}ms)`,
    );
  });
  next();
});

// In-memory anonymous session store for streaks
const sessions = new Map();

function createEmptySession() {
  return {
    streak: 0,
    bestStreak: 0,
    usedMovieIds: new Set(),
  };
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const [name, ...rest] = part.split('=');
    if (!name) continue;
    const key = name.trim();
    const value = rest.join('=').trim();
    if (!key) continue;
    cookies[key] = decodeURIComponent(value || '');
  }
  return cookies;
}

function sessionMiddleware(req, res, next) {
  const cookies = parseCookies(req.headers.cookie || '');
  let sessionId = cookies.hg_session;

  if (!sessionId || !sessions.has(sessionId)) {
    sessionId = crypto.randomUUID();
    const session = createEmptySession();
    sessions.set(sessionId, session);
    // Basic cookie; no Secure flag to keep it working on http://localhost
    res.setHeader('Set-Cookie', `hg_session=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Lax; Path=/`);
  }

  const session = sessions.get(sessionId) || createEmptySession();
  // Ensure session always has the expected shape
  if (!session.usedMovieIds || !(session.usedMovieIds instanceof Set)) {
    session.usedMovieIds = new Set();
  }
  if (typeof session.streak !== 'number') session.streak = 0;
  if (typeof session.bestStreak !== 'number') session.bestStreak = 0;

  sessions.set(sessionId, session);
  req.sessionId = sessionId;
  req.gameSession = session;
  next();
}

app.use(sessionMiddleware);

const PORT = process.env.PORT || 3001;

registerRoutes(app);

// Serve built frontend in production (or when client/dist exists)
const clientDistPath = join(__dirname, '..', 'client', 'dist');
if (existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));
  app.get('*', (req, res) => {
    if (req.path && req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.sendFile(join(clientDistPath, 'index.html'));
  });
}

// Global error handler (fallback)
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', {
    message: err?.message,
    stack: err?.stack,
  });
  if (res.headersSent) {
    return;
  }
  res
    .status(500)
    .json({ error: 'Internal server error', details: process.env.NODE_ENV === 'production' ? undefined : err.message });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
