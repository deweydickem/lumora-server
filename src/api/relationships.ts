// ─────────────────────────────────────────────────────────────────────────────
// NPC RELATIONSHIP API ROUTES
// ─────────────────────────────────────────────────────────────────────────────

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { RelationshipEngine, NPCName } from '../game/RelationshipEngine.js';

interface Deps { db: PrismaClient; relationshipEngine: RelationshipEngine; }

export async function registerRelationshipRoutes(fastify: FastifyInstance, deps: Deps) {
  const { db, relationshipEngine } = deps;

  // ── GET ALL RELATIONSHIPS ─────────────────────────────────────────────────
  fastify.get('/api/relationships/:playerId', async (req) => {
    const { playerId } = req.params as { playerId: string };
    return relationshipEngine.getRelationships(playerId);
  });

  // ── GIFT AN NPC ───────────────────────────────────────────────────────────
  fastify.post('/api/relationships/gift', async (req, reply) => {
    const body = z.object({
      playerId: z.string(),
      npcName:  z.enum(['Mira', 'Finn', 'Lyra']),
      item:     z.string(),
      quantity: z.number().int().positive().max(10).optional().default(1),
    }).parse(req.body);

    try {
      const result = await relationshipEngine.giftNPC(
        body.playerId,
        body.npcName as NPCName,
        body.item,
        body.quantity,
      );
      return result;
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // ── GET PERKS ─────────────────────────────────────────────────────────────
  fastify.get('/api/relationships/:playerId/perks', async (req) => {
    const { playerId } = req.params as { playerId: string };
    return relationshipEngine.getPlayerPerks(playerId);
  });
}
