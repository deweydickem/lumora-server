import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { PrismaClient } from '@prisma/client';
import { Server as SocketServer } from 'socket.io';

import { GameLoop } from './game/GameLoop.js';
import { PlotManager } from './game/PlotManager.js';
import { SkillEngine } from './game/SkillEngine.js';
import { QuestEngine } from './game/QuestEngine.js';
import { registerFarmRoutes } from './api/farm.js';
import { registerMarketRoutes } from './api/market.js';
import { registerPlayerRoutes } from './api/player.js';
import { registerSocketHandlers } from './ws/socketHandlers.js';
import { registerRelationshipRoutes } from './api/relationships.js';
import { RelationshipEngine } from './game/RelationshipEngine.js';

const PORT = parseInt(process.env.PORT ?? '3001');

async function main() {
  const db = new PrismaClient();
  await db.$connect();
  console.log('[DB] Connected to Postgres');

  const fastify = Fastify({ logger: false });
  await fastify.register(cors, { origin: true, credentials: true });

  // Attach Socket.io to Fastify's server BEFORE listen()
  const io = new SocketServer(fastify.server, {
    cors: { origin: '*', credentials: true },
  });

  const questEngine = new QuestEngine(db);
  const plotManager = new PlotManager(db);
  const skillEngine = new SkillEngine(db);
  const gameLoop    = new GameLoop(db, io, questEngine);
  const relationshipEngine = new RelationshipEngine(db);

  fastify.get('/health', async () => ({
    status: 'ok',
    season: gameLoop.getState().currentSeason,
    blockMultiplier: gameLoop.getState().currentBlockMultiplier,
  }));

  await registerFarmRoutes(fastify, { db, plotManager, skillEngine, questEngine });
  await registerMarketRoutes(fastify, { db, skillEngine, questEngine });
  await registerPlayerRoutes(fastify, { db, skillEngine, questEngine });

  await registerRelationshipRoutes(fastify, { db, relationshipEngine });
  registerSocketHandlers(io, { db, plotManager, gameLoop });

  await fastify.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`[Server] Running on port ${PORT}`);

  gameLoop.start();

  // Run relationship decay daily
  setInterval(() => relationshipEngine.applyDecay(), 24 * 60 * 60 * 1000);

  const shutdown = async () => {
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
