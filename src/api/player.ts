// player.ts — profile, quests, skills
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { SkillEngine } from '../game/SkillEngine.js';
import { QuestEngine } from '../game/QuestEngine.js';

interface Deps { db: PrismaClient; skillEngine: SkillEngine; questEngine: QuestEngine; }

export async function registerPlayerRoutes(fastify: FastifyInstance, deps: Deps) {
  const { db, skillEngine, questEngine } = deps;

  // Get full player profile
  fastify.get('/api/player/:playerId', async (req, reply) => {
    const { playerId } = req.params as { playerId: string };

    const [player, skills, quests, bonuses] = await Promise.all([
      db.player.findUnique({ where: { id: playerId } }),
      skillEngine.getSkills(playerId),
      questEngine.getQuestState(playerId),
      skillEngine.getSkillBonuses(playerId),
    ]);

    if (!player) return reply.status(404).send({ error: 'Player not found' });
    return { player, skills, quests, bonuses };
  });

  // Create / upsert player on first login (called after Privy auth)
  fastify.post('/api/player/login', async (req, reply) => {
    const body = z.object({
      privyId: z.string(),
      username: z.string().min(3).max(20),
      walletAddress: z.string().optional(),
    }).parse(req.body);

    const player = await db.player.upsert({
      where: { privyId: body.privyId },
      create: {
        privyId: body.privyId,
        username: body.username,
        walletAddress: body.walletAddress,
        // Create starter plots
        plots: {
          create: Array.from({ length: 7 }, (_, i) => ({
            col: i % 7,
            row: Math.floor(i / 7),
            isLocked: false,
          })),
        },
      },
      update: {
        lastSeenAt: new Date(),
        walletAddress: body.walletAddress ?? undefined,
      },
    });

    return { player };
  });

  // Claim quest reward
  fastify.post('/api/player/quest/claim', async (req, reply) => {
    const body = z.object({
      playerId: z.string(),
      questId: z.string(),
    }).parse(req.body);

    try {
      const reward = await questEngine.claimReward(body.playerId, body.questId);
      return { success: true, reward };
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // Get quest state
  fastify.get('/api/player/:playerId/quests', async (req) => {
    const { playerId } = req.params as { playerId: string };
    return questEngine.getQuestState(playerId);
  });

  // Get skills
  fastify.get('/api/player/:playerId/skills', async (req) => {
    const { playerId } = req.params as { playerId: string };
    const [skills, bonuses] = await Promise.all([
      skillEngine.getSkills(playerId),
      skillEngine.getSkillBonuses(playerId),
    ]);
    return { skills, bonuses };
  });
}

// ── NPC CHAT — proxies Anthropic server-side, key never hits the browser ──────
fastify.post('/api/npc/chat', async (req, reply) => {
  const body = z.object({
    npcName: z.string(),
    npcPersonality: z.string(),
    message: z.string().max(200),
    gameContext: z.string().max(600),
    history: z.array(z.object({
      role: z.enum(['user','assistant']),
      content: z.string(),
    })).max(12).optional(),
  }).parse(req.body);

  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 120,
      system: `You are ${body.npcName} in Lumora, a cozy pixel-art farming game with real onchain yield. ${body.npcPersonality} Keep replies to 1-2 sentences max. Casual game chat style. Current game state: ${body.gameContext}`,
      messages: [...(body.history ?? []), { role: 'user', content: body.message }],
    });

    const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
    return { reply: text };
  } catch (err: any) {
    return reply.status(500).send({ error: 'NPC unavailable' });
  }
});
