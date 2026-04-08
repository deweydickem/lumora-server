// ─────────────────────────────────────────────────────────────────────────────
// SOCKET HANDLERS
// Real-time events: player joining, chat, visiting farms, trade notifications.
// HTTP handles writes (actions). Sockets handle broadcasts (seeing others).
// ─────────────────────────────────────────────────────────────────────────────

import { Server as SocketServer, Socket } from 'socket.io';
import { PrismaClient } from '@prisma/client';
import { PlotManager } from '../game/PlotManager.js';
import { SkillEngine } from '../game/SkillEngine.js';
import { QuestEngine } from '../game/QuestEngine.js';
import { GameLoop } from '../game/GameLoop.js';

interface Deps {
  db: PrismaClient;
  plotManager: PlotManager;
  skillEngine: SkillEngine;
  questEngine: QuestEngine;
  gameLoop: GameLoop;
}

// Connected players: socketId → playerId
const connected = new Map<string, string>();

export function registerSocketHandlers(io: SocketServer, deps: Deps) {
  const { db, plotManager, questEngine, gameLoop } = deps;

  io.on('connection', (socket: Socket) => {
    console.log(`[Socket] Client connected: ${socket.id}`);

    // ── AUTH ────────────────────────────────────────────────────────────────
    // Client sends their playerId (validated via JWT in production)
    socket.on('player:join', async (data: { playerId: string; username: string }) => {
      connected.set(socket.id, data.playerId);

      // Join personal room for targeted messages
      await socket.join(`player:${data.playerId}`);

      // Join global world room
      await socket.join('world');

      // Update last seen
      await db.player.update({
        where: { id: data.playerId },
        data: { lastSeenAt: new Date() },
      }).catch(() => {}); // Don't crash if player not found

      // Send current game state to this player
      const state = gameLoop.getState();
      socket.emit('game:state', {
        season: state.currentSeason,
        blockMultiplier: state.currentBlockMultiplier,
      });

      // Announce to world
      io.to('world').emit('world:player_joined', {
        playerId: data.playerId,
        username: data.username,
      });

      console.log(`[Socket] Player joined: ${data.username} (${data.playerId})`);
    });

    // ── CHAT ────────────────────────────────────────────────────────────────
    socket.on('chat:message', async (data: { content: string; region?: string }) => {
      const playerId = connected.get(socket.id);
      if (!playerId) return;

      // Validate
      if (!data.content || data.content.length > 200) return;

      const player = await db.player.findUnique({
        where: { id: playerId },
        select: { username: true },
      });
      if (!player) return;

      // Persist message
      await db.chatMessage.create({
        data: {
          playerId,
          region: data.region ?? 'global',
          content: data.content,
        },
      });

      // Broadcast to the appropriate room
      const room = data.region ? `region:${data.region}` : 'world';
      io.to(room).emit('chat:message', {
        playerId,
        username: player.username,
        content: data.content,
        timestamp: Date.now(),
      });
    });

    // ── EMOTE ────────────────────────────────────────────────────────────────
    socket.on('player:emote', (data: { emote: string; x: number; y: number }) => {
      const playerId = connected.get(socket.id);
      if (!playerId) return;

      // Broadcast position + emote to world
      io.to('world').emit('player:emote', {
        playerId,
        emote: data.emote,
        x: data.x,
        y: data.y,
      });
    });

    // ── PLAYER MOVEMENT ──────────────────────────────────────────────────────
    // Broadcast position updates to nearby players
    socket.on('player:move', (data: { x: number; y: number; dir: number }) => {
      const playerId = connected.get(socket.id);
      if (!playerId) return;

      // Broadcast to world (in production: only to nearby players in same region)
      socket.to('world').emit('player:moved', {
        playerId,
        x: data.x,
        y: data.y,
        dir: data.dir,
      });
    });

    // ── VISIT FARM ───────────────────────────────────────────────────────────
    // When a player walks to another player's farm
    socket.on('farm:visit', async (data: { targetPlayerId: string }) => {
      const playerId = connected.get(socket.id);
      if (!playerId) return;

      try {
        const farmState = await plotManager.getFarmState(data.targetPlayerId);
        socket.emit('farm:state', {
          playerId: data.targetPlayerId,
          plots: farmState,
        });
      } catch (err) {
        socket.emit('error', { message: 'Could not load farm' });
      }
    });

    // ── TRADE NOTIFICATIONS ──────────────────────────────────────────────────
    socket.on('trade:post', async (data: {
      crop: string;
      quantity: number;
      priceEach: number;
    }) => {
      const playerId = connected.get(socket.id);
      if (!playerId) return;

      try {
        const player = await db.player.findUniqueOrThrow({
          where: { id: playerId },
          select: { username: true, inventory: true },
        });

        const inv = player.inventory as Record<string, number>;
        if ((inv[data.crop] ?? 0) < data.quantity) {
          socket.emit('error', { message: `Not enough ${data.crop}` });
          return;
        }

        // Deduct from inventory
        inv[data.crop] -= data.quantity;
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

        const trade = await db.trade.create({
          data: {
            sellerId: playerId,
            crop: data.crop,
            quantity: data.quantity,
            priceEach: data.priceEach,
            expiresAt,
          },
        });

        await db.player.update({
          where: { id: playerId },
          data: { inventory: inv },
        });

        // Broadcast to world trade board
        io.to('world').emit('trade:new', {
          tradeId: trade.id,
          seller: player.username,
          crop: data.crop,
          quantity: data.quantity,
          priceEach: data.priceEach,
          expiresAt,
        });
      } catch (err: any) {
        socket.emit('error', { message: err.message });
      }
    });

    // ── QUEST CLAIM ──────────────────────────────────────────────────────────
    socket.on('quest:claim', async (data: { questId: string }) => {
      const playerId = connected.get(socket.id);
      if (!playerId) return;

      try {
        const reward = await questEngine.claimReward(playerId, data.questId);
        socket.emit('quest:claimed', { questId: data.questId, reward });
      } catch (err: any) {
        socket.emit('error', { message: err.message });
      }
    });

    // ── DISCONNECT ────────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      const playerId = connected.get(socket.id);
      if (playerId) {
        connected.delete(socket.id);
        io.to('world').emit('world:player_left', { playerId });
        console.log(`[Socket] Player disconnected: ${playerId}`);
      }
    });
  });
}
