// market.ts — sell crops, black market, price queries
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { SkillEngine } from '../game/SkillEngine.js';
import { QuestEngine } from '../game/QuestEngine.js';
import { LUMI_CONFIG } from '../game/constants.js';

interface Deps { db: PrismaClient; skillEngine: SkillEngine; questEngine: QuestEngine; }

export async function registerMarketRoutes(fastify: FastifyInstance, deps: Deps) {
  const { db, skillEngine, questEngine } = deps;

  // Get current prices
  fastify.get('/api/market/prices', async () => {
    const prices = await db.marketPrice.findMany();
    return Object.fromEntries(prices.map(p => [p.item, p.price]));
  });

  // Sell crops
  fastify.post('/api/market/sell', async (req, reply) => {
    const body = z.object({
      playerId: z.string(),
      items: z.record(z.string(), z.number().int().positive()),
      craftedOnly: z.boolean().optional(),
    }).parse(req.body);

    try {
      const [player, prices, bonuses] = await Promise.all([
        db.player.findUniqueOrThrow({ where: { id: body.playerId } }),
        db.marketPrice.findMany(),
        skillEngine.getSkillBonuses(body.playerId),
      ]);

      const priceMap = Object.fromEntries(prices.map(p => [p.item, p.price]));
      const inv = player.inventory as Record<string, number>;
      const cooked = new Set(['bread', 'stew', 'wrap', 'ale']);

      let goldEarned = 0;
      let lumiEarned = 0;

      for (const [item, qty] of Object.entries(body.items)) {
        if ((inv[item] ?? 0) < qty) throw new Error(`Not enough ${item}`);
        const price = priceMap[item] ?? 0;
        const sellBonus = cooked.has(item) ? bonuses.craftSellBonus : 1.0;
        const marketBonus = bonuses.marketSellBonus;
        const earned = qty * price * sellBonus * marketBonus;

        goldEarned += earned;
        const lumiRate = cooked.has(item) ? LUMI_CONFIG.cookedSaleToLumi : LUMI_CONFIG.rawSaleToLumi;
        lumiEarned += earned * lumiRate * bonuses.tradeLumiMultiplier;
        inv[item] = (inv[item] ?? 0) - qty;
      }

      goldEarned = Math.round(goldEarned);

      await db.player.update({
        where: { id: body.playerId },
        data: {
          inventory: inv,
          gold: { increment: goldEarned },
          lumiBalance: { increment: lumiEarned },
          lumiTotal: { increment: lumiEarned },
        },
      });

      const levelUps = await skillEngine.awardXP(body.playerId, 'TRADING', Math.round(goldEarned * 0.4));
      await questEngine.trackStat(body.playerId, 'goldEarned', goldEarned);
      await questEngine.trackStat(body.playerId, 'totalGold', goldEarned);

      return { goldEarned, lumiEarned, levelUps };
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // Convert $GOLD → $LUMI
  fastify.post('/api/market/convert', async (req, reply) => {
    const body = z.object({ playerId: z.string() }).parse(req.body);

    try {
      const [player, bonuses] = await Promise.all([
        db.player.findUniqueOrThrow({ where: { id: body.playerId } }),
        skillEngine.getSkillBonuses(body.playerId),
      ]);

      const COST = 100;
      if (player.gold < COST) throw new Error('Need 100 $GOLD to convert');

      const lumiGain = parseFloat((LUMI_CONFIG.convertRate * bonuses.convertBonus).toFixed(4));

      await db.player.update({
        where: { id: body.playerId },
        data: {
          gold: { decrement: COST },
          lumiBalance: { increment: lumiGain },
          lumiTotal: { increment: lumiGain },
        },
      });

      const levelUps = await skillEngine.awardXP(body.playerId, 'ALCHEMY', 35);
      return { goldSpent: COST, lumiGain, levelUps };
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // Withdraw $LUMI onchain
  fastify.post('/api/market/withdraw', async (req, reply) => {
    const body = z.object({ playerId: z.string() }).parse(req.body);

    try {
      const [player, bonuses] = await Promise.all([
        db.player.findUniqueOrThrow({ where: { id: body.playerId } }),
        skillEngine.getSkillBonuses(body.playerId),
      ]);

      const minWithdrawal = bonuses.lowerWithdrawal ? 0.005 : LUMI_CONFIG.minWithdrawal;
      if (player.lumiBalance < minWithdrawal) {
        throw new Error(`Need at least ${minWithdrawal} $LUMI to withdraw`);
      }

      const amount = player.lumiBalance;

      // Zero out balance (in production: trigger onchain tx via Privy/Viem)
      await db.player.update({
        where: { id: body.playerId },
        data: { lumiBalance: 0 },
      });

      const levelUps = await skillEngine.awardXP(body.playerId, 'ALCHEMY', 80);

      // TODO: trigger actual onchain withdrawal
      // await triggerOnchainWithdrawal(player.walletAddress, amount);

      return { withdrawn: amount, levelUps, txHash: 'simulated' };
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });
}
