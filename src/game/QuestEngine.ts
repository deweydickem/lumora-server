// ─────────────────────────────────────────────────────────────────────────────
// QUEST ENGINE
// All quest state persisted in Postgres. Daily quests reset automatically.
// ─────────────────────────────────────────────────────────────────────────────

import { PrismaClient, QuestType } from '@prisma/client';

export interface QuestDefinition {
  id: string;
  title: string;
  description: string;
  type: QuestType;
  stat: string;         // What stat to track
  goal: number;
  reward: {
    gold?: number;
    seeds?: number;
    lumi?: number;
  };
}

export const DAILY_QUESTS: QuestDefinition[] = [
  { id: 'd1', title: 'Morning Harvest',    description: 'Harvest 5 crops',              type: 'DAILY', stat: 'harvested',      goal: 5,   reward: { gold: 15, seeds: 2 } },
  { id: 'd2', title: 'Wet the Soil',       description: 'Water 8 plots',               type: 'DAILY', stat: 'watered',        goal: 8,   reward: { gold: 10 } },
  { id: 'd3', title: 'Market Run',         description: 'Earn 30+ gold selling crops',  type: 'DAILY', stat: 'goldEarned',     goal: 30,  reward: { gold: 20, lumi: 0.001 } },
  { id: 'd4', title: 'Busy Hands',         description: 'Plant 6 seeds',               type: 'DAILY', stat: 'planted',        goal: 6,   reward: { gold: 12, seeds: 3 } },
  { id: 'd5', title: 'Black Market Move',  description: 'Complete 1 black market deal', type: 'DAILY', stat: 'bmSales',        goal: 1,   reward: { gold: 25, lumi: 0.002 } },
  { id: 'd6', title: 'The Artisan',        description: 'Craft 2 goods',               type: 'DAILY', stat: 'crafted',        goal: 2,   reward: { gold: 18, lumi: 0.001 } },
];

export const STORY_QUESTS: QuestDefinition[] = [
  { id: 's1',  title: 'First Furrow',       description: 'Till your first plot',         type: 'STORY', stat: 'tilled',         goal: 1,    reward: { gold: 5, seeds: 2 } },
  { id: 's2',  title: 'Green Thumb',        description: 'Harvest your first crop',      type: 'STORY', stat: 'harvested',      goal: 1,    reward: { gold: 10, seeds: 3 } },
  { id: 's3',  title: 'Storm Survivor',     description: 'Survive a VRF blight',        type: 'STORY', stat: 'blighted',       goal: 1,    reward: { gold: 30, lumi: 0.005 } },
  { id: 's4',  title: 'The Craftsman',      description: 'Craft your first good',       type: 'STORY', stat: 'crafted',        goal: 1,    reward: { gold: 20, lumi: 0.002 } },
  { id: 's5',  title: 'Land Baron',         description: 'Unlock more plots',           type: 'STORY', stat: 'plotsUnlocked',  goal: 1,    reward: { gold: 15, seeds: 5 } },
  { id: 's6',  title: 'Harvest Moon',       description: 'Harvest 50 crops total',      type: 'STORY', stat: 'totalHarvested', goal: 50,   reward: { gold: 60, lumi: 0.01 } },
  { id: 's7',  title: 'Master Merchant',    description: 'Earn 200 gold total',          type: 'STORY', stat: 'totalGold',      goal: 200,  reward: { gold: 40, lumi: 0.008 } },
  { id: 's8',  title: 'Seasons Change',     description: 'Live through a full season',  type: 'STORY', stat: 'seasonsLived',   goal: 1,    reward: { gold: 35, lumi: 0.005 } },
  { id: 's9',  title: 'Yield Pioneer',      description: 'Accumulate 0.01 $LUMI',       type: 'STORY', stat: 'lumiTotal',      goal: 0.01, reward: { gold: 50, lumi: 0.01 } },
  { id: 's10', title: 'The Alchemist',      description: 'Craft 10 goods total',        type: 'STORY', stat: 'totalCrafted',   goal: 10,   reward: { gold: 80, lumi: 0.015 } },
  { id: 's11', title: 'Upgraded Farmstead', description: 'Buy any 2 upgrades',          type: 'STORY', stat: 'upgradesBought', goal: 2,    reward: { gold: 45, lumi: 0.008 } },
  { id: 's12', title: 'The Long Game',      description: 'Earn 0.05 $LUMI lifetime',    type: 'STORY', stat: 'lumiTotal',      goal: 0.05, reward: { gold: 100, lumi: 0.025 } },
];

export const ACHIEVEMENTS: QuestDefinition[] = [
  { id: 'a1', title: 'Lucky Escape',   description: 'Survive 3 blights',          type: 'ACHIEVEMENT', stat: 'blighted',       goal: 3,   reward: { lumi: 0.01 } },
  { id: 'a2', title: 'Market Shark',   description: 'Make 5 black market sales',   type: 'ACHIEVEMENT', stat: 'bmSales',        goal: 5,   reward: { lumi: 0.015 } },
  { id: 'a3', title: 'Centurion',      description: 'Harvest 100 crops total',     type: 'ACHIEVEMENT', stat: 'totalHarvested', goal: 100, reward: { lumi: 0.02 } },
  { id: 'a4', title: 'Gold Rush',      description: 'Earn 500 gold total',          type: 'ACHIEVEMENT', stat: 'totalGold',      goal: 500, reward: { lumi: 0.03 } },
  { id: 'a5', title: 'Season Veteran', description: 'Survive all 4 seasons',       type: 'ACHIEVEMENT', stat: 'seasonsLived',   goal: 4,   reward: { lumi: 0.04 } },
  { id: 'a6', title: 'Lumi Whale',     description: 'Earn 0.1 $LUMI lifetime',     type: 'ACHIEVEMENT', stat: 'lumiTotal',      goal: 0.1, reward: { lumi: 0.05 } },
];

const ALL_QUESTS = [...DAILY_QUESTS, ...STORY_QUESTS, ...ACHIEVEMENTS];

export class QuestEngine {
  constructor(private db: PrismaClient) {}

  // ── INCREMENT A STAT ──────────────────────────────────────────────────────
  // Call this whenever an action happens. Returns quests that just completed.
  async trackStat(
    playerId: string,
    stat: string,
    amount: number = 1,
  ): Promise<QuestDefinition[]> {
    // Find all quests that track this stat and aren't yet claimed
    const relevantQuests = ALL_QUESTS.filter(q => q.stat === stat);
    if (relevantQuests.length === 0) return [];

    const now = new Date();
    const completedQuests: QuestDefinition[] = [];

    for (const quest of relevantQuests) {
      // Get or create progress record
      const progress = await this.db.questProgress.upsert({
        where: { playerId_questId: { playerId, questId: quest.id } },
        create: {
          playerId,
          questId: quest.id,
          questType: quest.type,
          progress: 0,
          claimed: false,
        },
        update: {},
      });

      if (progress.claimed) continue;

      // Skip daily quests that have already been reset today
      if (quest.type === 'DAILY' && progress.resetAt) {
        const resetDate = progress.resetAt.toDateString();
        const todayDate = now.toDateString();
        if (resetDate !== todayDate) {
          // This daily was reset — progress is stale, reset it
          await this.db.questProgress.update({
            where: { playerId_questId: { playerId, questId: quest.id } },
            data: { progress: 0, claimed: false, resetAt: now },
          });
          continue;
        }
      }

      const newProgress = Math.min(progress.progress + amount, quest.goal);

      await this.db.questProgress.update({
        where: { playerId_questId: { playerId, questId: quest.id } },
        data: { progress: newProgress },
      });

      // Check if just completed
      if (progress.progress < quest.goal && newProgress >= quest.goal) {
        completedQuests.push(quest);
      }
    }

    return completedQuests;
  }

  // ── CLAIM REWARD ──────────────────────────────────────────────────────────
  async claimReward(
    playerId: string,
    questId: string,
  ): Promise<QuestDefinition['reward']> {
    const quest = ALL_QUESTS.find(q => q.id === questId);
    if (!quest) throw new Error('Quest not found');

    const progress = await this.db.questProgress.findUnique({
      where: { playerId_questId: { playerId, questId } },
    });

    if (!progress) throw new Error('No progress for this quest');
    if (progress.claimed) throw new Error('Already claimed');
    if (progress.progress < quest.goal) throw new Error('Quest not complete');

    await this.db.questProgress.update({
      where: { playerId_questId: { playerId, questId } },
      data: { claimed: true, claimedAt: new Date() },
    });

    // Apply reward to player
    await this.db.player.update({
      where: { id: playerId },
      data: {
        gold:        { increment: quest.reward.gold ?? 0 },
        seeds:       { increment: quest.reward.seeds ?? 0 },
        lumiBalance: { increment: quest.reward.lumi ?? 0 },
        lumiTotal:   { increment: quest.reward.lumi ?? 0 },
      },
    });

    return quest.reward;
  }

  // ── GET QUEST STATE FOR PLAYER ────────────────────────────────────────────
  async getQuestState(playerId: string) {
    const progressRecords = await this.db.questProgress.findMany({
      where: { playerId },
    });

    const progressMap = new Map(progressRecords.map(p => [p.questId, p]));

    const format = (quest: QuestDefinition) => {
      const p = progressMap.get(quest.id);
      return {
        ...quest,
        progress: p?.progress ?? 0,
        claimed: p?.claimed ?? false,
      };
    };

    return {
      daily:        DAILY_QUESTS.map(format),
      story:        STORY_QUESTS.map(format),
      achievements: ACHIEVEMENTS.map(format),
    };
  }

  // ── RESET DAILY QUESTS ────────────────────────────────────────────────────
  // Called by the game loop once per day at midnight UTC
  async resetDailyQuests(): Promise<void> {
    const now = new Date();
    await this.db.questProgress.updateMany({
      where: { questType: 'DAILY' },
      data: {
        progress: 0,
        claimed: false,
        resetAt: now,
      },
    });
  }
}
