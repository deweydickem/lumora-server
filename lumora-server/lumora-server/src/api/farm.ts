// ─────────────────────────────────────────────────────────────────────────────
// FARM API ROUTES
// All farm actions go through here. Server validates, DB persists,
// response goes back to client. Client never writes state directly.
// ─────────────────────────────────────────────────────────────────────────────

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { PlotManager } from '../game/PlotManager.js';
import { SkillEngine } from '../game/SkillEngine.js';
import { QuestEngine } from '../game/QuestEngine.js';
import { RECIPE_CONFIG, type RecipeId } from '../game/constants.js';

interface Deps {
  db: PrismaClient;
  plotManager: PlotManager;
  skillEngine: SkillEngine;
  questEngine: QuestEngine;
}

export async function registerFarmRoutes(fastify: FastifyInstance, deps: Deps) {
  const { db, plotManager, skillEngine, questEngine } = deps;

  // ── GET FARM STATE ────────────────────────────────────────────────────────
  // Called when player loads their farm or visits another farm
  fastify.get('/api/farm/:playerId', async (req, reply) => {
    const { playerId } = req.params as { playerId: string };

    try {
      const [plots, skills, player] = await Promise.all([
        plotManager.getFarmState(playerId),
        skillEngine.getSkills(playerId),
        db.player.findUnique({
          where: { id: playerId },
          select: {
            gold: true, seeds: true, lumiBalance: true, lumiTotal: true,
            inventory: true, username: true,
          },
        }),
      ]);

      if (!player) return reply.status(404).send({ error: 'Player not found' });

      const bonuses = await skillEngine.getSkillBonuses(playerId);

      return { plots, skills, player, bonuses };
    } catch (err) {
      return reply.status(500).send({ error: 'Failed to load farm' });
    }
  });

  // ── TILL ──────────────────────────────────────────────────────────────────
  fastify.post('/api/farm/till', async (req, reply) => {
    const body = z.object({
      playerId: z.string(),
      plotId: z.string(),
    }).parse(req.body);

    try {
      const plot = await plotManager.tillPlot(body.plotId, body.playerId);

      // Award farming XP
      const levelUps = await skillEngine.awardXP(body.playerId, 'FARMING', 8);

      // Track quest
      await questEngine.trackStat(body.playerId, 'tilled');

      return { plot, levelUps };
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // ── PLANT ─────────────────────────────────────────────────────────────────
  fastify.post('/api/farm/plant', async (req, reply) => {
    const body = z.object({
      playerId: z.string(),
      plotId: z.string(),
      cropType: z.enum(['WHEAT', 'CARROT', 'CORN', 'GOLDEN_WHEAT']),
    }).parse(req.body);

    try {
      // Check player has seeds
      const player = await db.player.findUniqueOrThrow({ where: { id: body.playerId } });
      if (player.seeds <= 0) throw new Error('No seeds left');

      // Get irrigation level for speed bonus
      const bonuses = await skillEngine.getSkillBonuses(body.playerId);
      // irrigation level stored in player data — for now derive from skill
      const irrigationLevel = 0; // TODO: read from player upgrades table

      const [plot] = await Promise.all([
        plotManager.plantSeed(body.plotId, body.playerId, body.cropType, irrigationLevel),
        db.player.update({
          where: { id: body.playerId },
          data: { seeds: { decrement: 1 } },
        }),
      ]);

      const levelUps = await skillEngine.awardXP(body.playerId, 'FARMING', 12);
      await questEngine.trackStat(body.playerId, 'planted');

      return { plot, levelUps };
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // ── WATER ─────────────────────────────────────────────────────────────────
  fastify.post('/api/farm/water', async (req, reply) => {
    const body = z.object({
      playerId: z.string(),
      plotId: z.string(),
    }).parse(req.body);

    try {
      const skills = await skillEngine.getSkills(body.playerId);
      const farmingLevel = skills.find(s => s.skill === 'FARMING')?.level ?? 1;

      const plot = await plotManager.waterPlot(body.plotId, body.playerId, farmingLevel);
      const levelUps = await skillEngine.awardXP(body.playerId, 'FARMING', 6);
      await questEngine.trackStat(body.playerId, 'watered');

      return { plot, levelUps };
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // ── HARVEST ───────────────────────────────────────────────────────────────
  fastify.post('/api/farm/harvest', async (req, reply) => {
    const body = z.object({
      playerId: z.string(),
      plotId: z.string(),
      season: z.enum(['SUMMER', 'AUTUMN', 'WINTER', 'SPRING']),
      blockMultiplier: z.number().min(0.1).max(10),
    }).parse(req.body);

    try {
      const skills = await skillEngine.getSkills(body.playerId);
      const bonuses = await skillEngine.getSkillBonuses(body.playerId);
      const farmingLevel = skills.find(s => s.skill === 'FARMING')?.level ?? 1;
      const scarecrowLevel = 0; // TODO: read from upgrades

      const result = await plotManager.harvestPlot(body.plotId, body.playerId, {
        season: body.season,
        blockMultiplier: body.blockMultiplier,
        scarecrowLevel,
        farmingLevel,
      });

      if (!result.success) {
        // Blighted — track for quests/achievements
        await questEngine.trackStat(body.playerId, 'blighted');
        return { result, levelUps: [] };
      }

      // Add crop to inventory + give back a seed
      const cropKey = result.cropType.toLowerCase() as string;
      const inventory = (await db.player.findUniqueOrThrow({
        where: { id: body.playerId },
        select: { inventory: true },
      })).inventory as Record<string, number>;

      inventory[cropKey] = (inventory[cropKey] ?? 0) + result.yield;

      await db.player.update({
        where: { id: body.playerId },
        data: {
          inventory,
          seeds: { increment: 1 },
          lumiBalance: { increment: result.lumiBonus },
          lumiTotal: { increment: result.lumiBonus },
        },
      });

      // XP + quest tracking
      const levelUps = await skillEngine.awardXP(body.playerId, 'FARMING', result.xpAwarded);
      await questEngine.trackStat(body.playerId, 'harvested');
      await questEngine.trackStat(body.playerId, 'totalHarvested');

      // Handle golden seed drop — plant it automatically on an empty plot
      if (result.goldenSeed) {
        const emptyPlot = await db.plot.findFirst({
          where: { playerId: body.playerId, state: 'EMPTY', isLocked: false },
        });
        if (emptyPlot) {
          await plotManager.plantSeed(emptyPlot.id, body.playerId, 'GOLDEN_WHEAT');
        }
      }

      return { result, levelUps };
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // ── CRAFT ─────────────────────────────────────────────────────────────────
  fastify.post('/api/farm/craft', async (req, reply) => {
    const body = z.object({
      playerId: z.string(),
      recipe: z.enum(['bread', 'stew', 'wrap', 'ale']),
    }).parse(req.body);

    try {
      const config = RECIPE_CONFIG[body.recipe as RecipeId];
      const bonuses = await skillEngine.getSkillBonuses(body.playerId);

      // Check ingredients
      const player = await db.player.findUniqueOrThrow({ where: { id: body.playerId } });
      const inv = player.inventory as Record<string, number>;

      for (const [item, qty] of Object.entries(config.ingredients)) {
        if ((inv[item] ?? 0) < qty) {
          throw new Error(`Not enough ${item}`);
        }
      }

      // Deduct ingredients
      for (const [item, qty] of Object.entries(config.ingredients)) {
        inv[item] = (inv[item] ?? 0) - qty;
      }
      await db.player.update({ where: { id: body.playerId }, data: { inventory: inv } });

      // Apply craft speed bonus
      const craftMs = config.craftMs * bonuses.craftSpeedMultiplier;

      // Create craft job
      const completesAt = new Date(Date.now() + craftMs);
      const job = await db.craftJob.create({
        data: {
          playerId: body.playerId,
          recipe: body.recipe,
          completesAt,
        },
      });

      return { job, completesInSeconds: Math.round(craftMs / 1000) };
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // ── COLLECT CRAFT ─────────────────────────────────────────────────────────
  fastify.post('/api/farm/craft/collect', async (req, reply) => {
    const body = z.object({
      playerId: z.string(),
      jobId: z.string(),
      blockMultiplier: z.number(),
    }).parse(req.body);

    try {
      const job = await db.craftJob.findFirst({
        where: { id: body.jobId, playerId: body.playerId, collected: false },
      });
      if (!job) throw new Error('Craft job not found');
      if (job.completesAt > new Date()) throw new Error('Craft not complete yet');

      const config = RECIPE_CONFIG[job.recipe as RecipeId];
      const bonuses = await skillEngine.getSkillBonuses(body.playerId);

      // Apply sell bonus to value (used when player sells from inventory)
      const lumiEarned = 0.0001 * config.lumiMultiplier * body.blockMultiplier * bonuses.craftLumiMultiplier;

      // Add to inventory
      const player = await db.player.findUniqueOrThrow({ where: { id: body.playerId } });
      const inv = player.inventory as Record<string, number>;
      inv[job.recipe] = (inv[job.recipe] ?? 0) + 1;

      await Promise.all([
        db.player.update({
          where: { id: body.playerId },
          data: {
            inventory: inv,
            lumiBalance: { increment: lumiEarned },
            lumiTotal: { increment: lumiEarned },
          },
        }),
        db.craftJob.update({ where: { id: body.jobId }, data: { collected: true } }),
      ]);

      const levelUps = await skillEngine.awardXP(body.playerId, 'CRAFTING', config.xpOnCraft, bonuses.craftXPBonus);
      await questEngine.trackStat(body.playerId, 'crafted');
      await questEngine.trackStat(body.playerId, 'totalCrafted');

      return { recipe: job.recipe, lumiEarned, levelUps };
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });
}
