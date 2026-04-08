// ─────────────────────────────────────────────────────────────────────────────
// SOCKET HANDLERS
// Two room types:
//   "world"        — Havenfield town square, everyone starts here
//   "farm:{id}"    — private farm instance, invite-only
// ─────────────────────────────────────────────────────────────────────────────

import { Server as SocketServer, Socket } from 'socket.io';
import { PrismaClient } from '@prisma/client';
import { PlotManager } from '../game/PlotManager.js';
import { GameLoop } from '../game/GameLoop.js';

interface Deps {
  db: PrismaClient;
  plotManager: PlotManager;
  gameLoop: GameLoop;
}

// socketId → playerId
const connected = new Map<string, string>();

const MAX_PLAYERS = 20;

// playerId → { username, x, y, dir, socketId, room }
const onlinePlayers = new Map<string, {
  username: string; x: number; y: number;
  dir: number; socketId: string; room: string;
}>();

// Pending farm invites: inviteePlayerId → { farmOwnerId, ownerUsername, farmRoomId }
const pendingInvites = new Map<string, {
  farmOwnerId: string; ownerUsername: string; farmRoomId: string;
}>();

function farmRoom(playerId: string) { return `farm:${playerId}`; }

export function registerSocketHandlers(io: SocketServer, deps: Deps) {
  const { db, plotManager, gameLoop } = deps;

  io.on('connection', (socket: Socket) => {
    console.log(`[Socket] Client connected: ${socket.id}`);

    // ── JOIN WORLD (Havenfield) ───────────────────────────────────────────────
    socket.on('player:join', async (data: {
      playerId: string; username: string; x?: number; y?: number;
    }) => {
      // Enforce player cap
      if (onlinePlayers.size >= MAX_PLAYERS && !onlinePlayers.has(data.playerId)) {
        socket.emit('server:full', {
          message: `Havenfield is full (${MAX_PLAYERS} players max). Try again soon!`,
          online: onlinePlayers.size,
          max: MAX_PLAYERS,
        });
        socket.disconnect();
        return;
      }

      connected.set(socket.id, data.playerId);
      await socket.join('world');
      await socket.join(`player:${data.playerId}`);

      onlinePlayers.set(data.playerId, {
        username: data.username,
        x: data.x ?? 8, y: data.y ?? 14, dir: 2,
        socketId: socket.id, room: 'world',
      });

      // Update last seen
      await db.player.update({
        where: { id: data.playerId },
        data: { lastSeenAt: new Date() },
      }).catch(() => {});

      // Send current game state
      const state = gameLoop.getState();
      socket.emit('game:state', {
        season: state.currentSeason,
        blockMultiplier: state.currentBlockMultiplier,
      });

      // Send full snapshot of who's already in Havenfield
      const others = [...onlinePlayers.entries()]
        .filter(([pid, p]) => pid !== data.playerId && p.room === 'world')
        .map(([pid, p]) => ({ playerId: pid, username: p.username, x: p.x, y: p.y, dir: p.dir }));
      socket.emit('world:online_players', others);

      // Check for pending invites
      const invite = pendingInvites.get(data.playerId);
      if (invite) {
        socket.emit('farm:invite_received', invite);
      }

      // Announce to Havenfield
      socket.to('world').emit('world:player_joined', {
        playerId: data.playerId, username: data.username,
        x: data.x ?? 8, y: data.y ?? 14, dir: 2,
      });

      console.log(`[Socket] ${data.username} joined Havenfield. Online: ${onlinePlayers.size}`);
    });

    // ── ENTER FARM ────────────────────────────────────────────────────────────
    // Player walks through their gate → leaves world, enters private farm room
    socket.on('farm:enter', async (data: { farmOwnerId: string }) => {
      const playerId = connected.get(socket.id);
      if (!playerId) return;

      const player = onlinePlayers.get(playerId);
      if (!player) return;

      const room = farmRoom(data.farmOwnerId);
      const isOwner = playerId === data.farmOwnerId;

      // Non-owners need an accepted invite
      if (!isOwner) {
        const invite = pendingInvites.get(playerId);
        if (!invite || invite.farmOwnerId !== data.farmOwnerId) {
          socket.emit('error', { message: 'No invite to this farm' });
          return;
        }
        pendingInvites.delete(playerId);
      }

      // Leave world, join farm room
      await socket.leave('world');
      await socket.join(room);
      player.room = room;

      // Tell world this player left
      io.to('world').emit('world:player_left', { playerId });

      // Send farm state to the entering player
      const plots = await plotManager.getFarmState(data.farmOwnerId);
      socket.emit('farm:state', {
        farmOwnerId: data.farmOwnerId,
        isOwner,
        plots,
      });

      // Tell others in this farm room someone arrived
      const ownerPlayer = onlinePlayers.get(data.farmOwnerId);
      socket.to(room).emit('farm:player_joined', {
        playerId,
        username: player.username,
        isOwner,
      });

      if (!isOwner && ownerPlayer) {
        // Notify the owner their guest arrived
        io.to(`player:${data.farmOwnerId}`).emit('farm:guest_arrived', {
          guestId: playerId,
          guestUsername: player.username,
        });
      }

      console.log(`[Socket] ${player.username} entered farm:${data.farmOwnerId}`);
    });

    // ── LEAVE FARM → BACK TO HAVENFIELD ──────────────────────────────────────
    socket.on('farm:leave', async () => {
      const playerId = connected.get(socket.id);
      if (!playerId) return;

      const player = onlinePlayers.get(playerId);
      if (!player || player.room === 'world') return;

      // Tell farm room this player left
      socket.to(player.room).emit('farm:player_left', { playerId });

      // Leave farm, rejoin world
      await socket.leave(player.room);
      await socket.join('world');
      player.room = 'world';
      player.x = 8; player.y = 14; // spawn back at gate

      // Announce return to Havenfield
      socket.to('world').emit('world:player_joined', {
        playerId, username: player.username,
        x: player.x, y: player.y, dir: 2,
      });

      // Send current Havenfield players to returning player
      const others = [...onlinePlayers.entries()]
        .filter(([pid, p]) => pid !== playerId && p.room === 'world')
        .map(([pid, p]) => ({ playerId: pid, username: p.username, x: p.x, y: p.y, dir: p.dir }));
      socket.emit('world:online_players', others);

      console.log(`[Socket] ${player.username} returned to Havenfield`);
    });

    // ── INVITE PLAYER TO FARM ─────────────────────────────────────────────────
    socket.on('farm:invite', async (data: { inviteeUsername: string }) => {
      const playerId = connected.get(socket.id);
      if (!playerId) return;

      const owner = onlinePlayers.get(playerId);
      if (!owner) return;

      // Find the invitee by username
      const invitee = [...onlinePlayers.entries()]
        .find(([, p]) => p.username.toLowerCase() === data.inviteeUsername.toLowerCase());

      if (!invitee) {
        socket.emit('error', { message: `${data.inviteeUsername} is not online` });
        return;
      }

      const [inviteeId, inviteePlayer] = invitee;

      // Store pending invite
      const invite = {
        farmOwnerId: playerId,
        ownerUsername: owner.username,
        farmRoomId: farmRoom(playerId),
      };
      pendingInvites.set(inviteeId, invite);

      // Send invite to invitee
      io.to(`player:${inviteeId}`).emit('farm:invite_received', invite);

      socket.emit('farm:invite_sent', { to: inviteePlayer.username });
      console.log(`[Socket] ${owner.username} invited ${inviteePlayer.username} to their farm`);
    });

    // ── DECLINE INVITE ────────────────────────────────────────────────────────
    socket.on('farm:invite_decline', () => {
      const playerId = connected.get(socket.id);
      if (!playerId) return;
      const invite = pendingInvites.get(playerId);
      if (!invite) return;
      pendingInvites.delete(playerId);
      // Notify owner
      io.to(`player:${invite.farmOwnerId}`).emit('farm:invite_declined', {
        by: onlinePlayers.get(playerId)?.username ?? 'Someone',
      });
    });

    // ── PLAYER MOVEMENT ───────────────────────────────────────────────────────
    socket.on('player:move', (data: { x: number; y: number; dir: number }) => {
      const playerId = connected.get(socket.id);
      if (!playerId) return;

      const player = onlinePlayers.get(playerId);
      if (player) {
        player.x = data.x; player.y = data.y; player.dir = data.dir;
      }

      // Broadcast to the room this player is currently in
      const room = player?.room ?? 'world';
      socket.to(room).emit('player:moved', {
        playerId, username: player?.username ?? 'Player',
        x: data.x, y: data.y, dir: data.dir,
      });
    });

    // ── CHAT ─────────────────────────────────────────────────────────────────
    socket.on('chat:message', async (data: { content: string }) => {
      const playerId = connected.get(socket.id);
      if (!playerId || !data.content || data.content.length > 200) return;

      const player = onlinePlayers.get(playerId);
      if (!player) return;

      // Persist
      await db.chatMessage.create({
        data: { playerId, region: player.room, content: data.content },
      }).catch(() => {});

      // Broadcast to same room only
      socket.to(player.room).emit('chat:message', {
        playerId, username: player.username, content: data.content,
      });
    });

    // ── EMOTE ─────────────────────────────────────────────────────────────────
    socket.on('player:emote', (data: { emote: string }) => {
      const playerId = connected.get(socket.id);
      if (!playerId) return;
      const player = onlinePlayers.get(playerId);
      const room = player?.room ?? 'world';
      socket.to(room).emit('player:emote', { playerId, emote: data.emote });
    });

    // ── TRADE BOARD ───────────────────────────────────────────────────────────
    socket.on('trade:post', async (data: {
      crop: string; quantity: number; priceEach: number;
    }) => {
      const playerId = connected.get(socket.id);
      if (!playerId) return;

      try {
        const player = await db.player.findUniqueOrThrow({
          where: { id: playerId }, select: { username: true, inventory: true },
        });
        const inv = player.inventory as Record<string, number>;
        if ((inv[data.crop] ?? 0) < data.quantity) {
          socket.emit('error', { message: `Not enough ${data.crop}` }); return;
        }
        inv[data.crop] -= data.quantity;
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        const trade = await db.trade.create({
          data: { sellerId: playerId, crop: data.crop, quantity: data.quantity, priceEach: data.priceEach, expiresAt },
        });
        await db.player.update({ where: { id: playerId }, data: { inventory: inv } });

        // Broadcast to Havenfield (trade board is global)
        io.to('world').emit('trade:new', {
          tradeId: trade.id, seller: player.username,
          crop: data.crop, quantity: data.quantity, priceEach: data.priceEach, expiresAt,
        });
      } catch (err: any) {
        socket.emit('error', { message: err.message });
      }
    });

    // ── DISCONNECT ────────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      const playerId = connected.get(socket.id);
      if (playerId) {
        const player = onlinePlayers.get(playerId);
        const room = player?.room ?? 'world';
        connected.delete(socket.id);
        onlinePlayers.delete(playerId);
        pendingInvites.delete(playerId);
        io.to(room).emit('world:player_left', { playerId });
        io.to(room).emit('farm:player_left', { playerId });
        console.log(`[Socket] ${player?.username} disconnected. Online: ${onlinePlayers.size}`);
      }
    });
  });
}
