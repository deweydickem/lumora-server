// ─────────────────────────────────────────────────────────────────────────────
// SKILL ENGINE
// Tracks XP, levels, and unlocks for all four player skills.
// ─────────────────────────────────────────────────────────────────────────────

import { PrismaClient, SkillType } from '@prisma/client';
import { levelFromXP, MAX_SKILL_LEVEL } from './constants.js';

export interface SkillState {
  skill: SkillType;
  xp: number;
  level: number;
}

export interface LevelUpEvent {
  skill: SkillType;
  newLevel: number;
  unlock: string | null;
}

// What each skill unlocks at each level
const SKILL_UNLOCKS: Record<SkillType, Record<number, string>> = {
  FARMING: {
    5:  'Carrot seeds available',
    10: 'Watering gives +8% fertility',
    15: 'Corn seeds available',
    20: 'Harvest yields +1 bonus crop',
    25: 'Plot restore costs 3◈ instead of 5◈',
    30: 'Blight chance –0.3% extra',
    40: 'Golden seed drop chance ×2',
    50: '★ Master Farmer title',
  },
  CRAFTING: {
    5:  'Craft speed +10%',
    10: 'Craft XP bonus +25%',
    25: 'Crafted goods sell for +10%',
    35: '$LUMI emission on craft ×1.5',
    50: '★ Grand Artisan title',
  },
  TRADING: {
    5:  'Black market early alert (+3s warning)',
    10: 'Market sell prices +5%',
    20: 'Black market deals last 20% longer',
    30: 'Market sell prices +12%',
    40: '$LUMI on all sales ×1.3',
    50: '★ Market Baron title',
  },
  ALCHEMY: {
    5:  '$GOLD → $LUMI conversion +20%',
    10: 'Fee pulses emit +10% $LUMI',
    20: '$GOLD → $LUMI conversion +50%',
    30: 'Fee pulses emit +25% $LUMI',
    40: 'Minimum withdrawal reduced to 0.005 $LUMI',
    50: '★ Yield Alchemist title',
  },
};

export class SkillEngine {
  constructor(private db: PrismaClient) {}

  // ── AWARD XP ──────────────────────────────────────────────────────────────
  // Returns any level-up events that occurred (can be empty)
  async awardXP(
    playerId: string,
    skill: SkillType,
    amount: number,
    craftingXPBonus: number = 1.0,
  ): Promise<LevelUpEvent[]> {
    const bonus = skill === 'CRAFTING' ? craftingXPBonus : 1.0;
    const finalAmount = Math.round(amount * bonus);

    // Upsert the skill record
    const current = await this.db.playerSkill.upsert({
      where: { playerId_skill: { playerId, skill } },
      create: { playerId, skill, xp: 0, level: 1 },
      update: {},
    });

    const prevLevel = current.level;
    const newXP = current.xp + finalAmount;
    const newLevel = Math.min(levelFromXP(newXP), MAX_SKILL_LEVEL);

    await this.db.playerSkill.update({
      where: { playerId_skill: { playerId, skill } },
      data: { xp: newXP, level: newLevel },
    });

    // Collect level-up events
    const events: LevelUpEvent[] = [];
    for (let lvl = prevLevel + 1; lvl <= newLevel; lvl++) {
      events.push({
        skill,
        newLevel: lvl,
        unlock: SKILL_UNLOCKS[skill][lvl] ?? null,
      });
    }

    return events;
  }

  // ── GET ALL SKILLS ────────────────────────────────────────────────────────
  async getSkills(playerId: string): Promise<SkillState[]> {
    const skills = await this.db.playerSkill.findMany({
      where: { playerId },
    });

    // Ensure all 4 skills exist
    const allTypes: SkillType[] = ['FARMING', 'CRAFTING', 'TRADING', 'ALCHEMY'];
    return allTypes.map(type => {
      const found = skills.find(s => s.skill === type);
      return found
        ? { skill: type, xp: found.xp, level: found.level }
        : { skill: type, xp: 0, level: 1 };
    });
  }

  // ── GET SKILL BONUSES ─────────────────────────────────────────────────────
  // Returns the computed bonuses based on current skill levels
  async getSkillBonuses(playerId: string): Promise<SkillBonuses> {
    const skills = await this.getSkills(playerId);
    const farming  = skills.find(s => s.skill === 'FARMING')?.level ?? 1;
    const crafting = skills.find(s => s.skill === 'CRAFTING')?.level ?? 1;
    const trading  = skills.find(s => s.skill === 'TRADING')?.level ?? 1;
    const alchemy  = skills.find(s => s.skill === 'ALCHEMY')?.level ?? 1;

    return {
      waterFertilityGain:  farming >= 10 ? 0.08 : 0.05,
      harvestYieldBonus:   farming >= 20 ? 1 : 0,
      cheapRestore:        farming >= 25,
      extraBlightReduction: farming >= 30 ? 0.003 : 0,
      goldenSeedMultiplier: farming >= 40 ? 2 : 1,

      craftSpeedMultiplier: crafting >= 5 ? 0.9 : 1.0,
      craftXPBonus:         crafting >= 10 ? 1.25 : 1.0,
      craftSellBonus:       crafting >= 25 ? 1.10 : 1.0,
      craftLumiMultiplier:  crafting >= 35 ? 1.5 : 1.0,

      bmEarlyAlert:         trading >= 5,
      marketSellBonus:      trading >= 30 ? 1.12 : trading >= 10 ? 1.05 : 1.0,
      bmDurationMultiplier: trading >= 20 ? 1.20 : 1.0,
      tradeLumiMultiplier:  trading >= 40 ? 1.3 : 1.0,

      convertBonus:         alchemy >= 20 ? 1.5 : alchemy >= 5 ? 1.2 : 1.0,
      pulseBonus:           alchemy >= 30 ? 1.25 : alchemy >= 10 ? 1.10 : 1.0,
      lowerWithdrawal:      alchemy >= 40,
    };
  }
}

export interface SkillBonuses {
  // Farming
  waterFertilityGain: number;
  harvestYieldBonus: number;
  cheapRestore: boolean;
  extraBlightReduction: number;
  goldenSeedMultiplier: number;
  // Crafting
  craftSpeedMultiplier: number;
  craftXPBonus: number;
  craftSellBonus: number;
  craftLumiMultiplier: number;
  // Trading
  bmEarlyAlert: boolean;
  marketSellBonus: number;
  bmDurationMultiplier: number;
  tradeLumiMultiplier: number;
  // Alchemy
  convertBonus: number;
  pulseBonus: number;
  lowerWithdrawal: boolean;
}
