// ─────────────────────────────────────────────────────────────────────────────
// LUMORA SERVER — Entry point
// Fastify HTTP + Socket.io WebSocket + Prisma DB + Game Loop
// ─────────────────────────────────────────────────────────────────────────────

import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { PrismaClient } from '@prisma/client';
import { Server as SocketServer } from 'socket.io';
import { createServer } from 'http';

import { GameLoop } from './game/GameLoop.js';
import { PlotManager } from './game/PlotManager.js';
import { SkillEngine } from './game/SkillEngine.js';
import { QuestEngine } from './game/QuestEngine.js';
import { registerFarmRoutes } from './api/farm.js';
import { registerMarketRoutes } from './api/market.js';
import { registerPlayerRoutes } from './api/player.js';
import { registerSocketHandlers } from './ws/socketHandlers.js';

const PORT = parseInt(process.env.PORT ?? '3001');

async function main() {
  // ── DATABASE ──────────────────────────────────────────────────────────────
  const db = new PrismaClient();
  await db.$connect();
  console.log('[DB] Connected to Postgres');

  // ── FASTIFY HTTP SERVER ───────────────────────────────────────────────────
  const fastify = Fastify({ logger: process.env.NODE_ENV === 'development' });

  await fastify.register(cors, {
    origin: process.env.NODE_ENV === 'production'
      ? ['https://lumora.gg', 'https://lumora-coral-ten.vercel.app']
      : true,
    credentials: true,
  });

  // ── SOCKET.IO ─────────────────────────────────────────────────────────────
  // Attach to Node's raw http server so Fastify + Socket.io share the port
  const httpServer = createServer(fastify.server);
  const io = new SocketServer(httpServer, {
    cors: {
      origin: process.env.NODE_ENV === 'production'
        ? ['https://lumora.gg', 'https://lumora-coral-ten.vercel.app']
        : '*',
      credentials: true,
    },
  });

  // ── GAME SYSTEMS ──────────────────────────────────────────────────────────
  const questEngine = new QuestEngine(db);
  const plotManager = new PlotManager(db);
  const skillEngine = new SkillEngine(db);
  const gameLoop   = new GameLoop(db, io, questEngine);

  // ── HTTP ROUTES ───────────────────────────────────────────────────────────
  // Health check
  fastify.get('/health', async () => ({
    status: 'ok',
    season: gameLoop.getState().currentSeason,
    blockMultiplier: gameLoop.getState().currentBlockMultiplier,
  }));

  // Game API routes
  await registerFarmRoutes(fastify, { db, plotManager, skillEngine, questEngine });
  await registerMarketRoutes(fastify, { db, skillEngine, questEngine });
  await registerPlayerRoutes(fastify, { db, skillEngine, questEngine });

  // ── WEBSOCKET HANDLERS ────────────────────────────────────────────────────
  registerSocketHandlers(io, { db, plotManager, skillEngine, questEngine, gameLoop });

  // ── START ─────────────────────────────────────────────────────────────────
  await fastify.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`[Server] Lumora server running on port ${PORT}`);
  console.log(`[Server] Environment: ${process.env.NODE_ENV ?? 'development'}`);

  gameLoop.start();

  // ── GRACEFUL SHUTDOWN ─────────────────────────────────────────────────────
  const shutdown = async () => {
    console.log('[Server] Shutting down...');
    gameLoop.stop();
    await db.$disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch(err => {
  console.error('[Server] Fatal error:', err);
  process.exit(1);
});
