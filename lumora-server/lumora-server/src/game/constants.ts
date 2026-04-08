// ─────────────────────────────────────────────────────────────────────────────
// LUMORA GAME CONSTANTS
// Single source of truth. Change timings here — nowhere else.
// ─────────────────────────────────────────────────────────────────────────────

// ── CROP TIMING ───────────────────────────────────────────────────────────────
// Real-world milliseconds. Design goal: plant before bed → harvest in morning.
export const CROP_CONFIG = {
  WHEAT: {
    growMs: 2 * 60 * 60 * 1000,      // 2 hours
    basePrice: 2,
    xpOnHarvest: 20,
  },
  CARROT: {
    growMs: 8 * 60 * 60 * 1000,      // 8 hours
    basePrice: 5,
    xpOnHarvest: 35,
  },
  CORN: {
    growMs: 24 * 60 * 60 * 1000,     // 24 hours — full real-world day
    basePrice: 8,
    xpOnHarvest: 50,
  },
  GOLDEN_WHEAT: {
    growMs: 30 * 60 * 1000,           // 30 minutes (rare reward, faster)
    basePrice: 0,
    xpOnHarvest: 200,
  },
} as const;

export type CropType = keyof typeof CROP_CONFIG;

// ── CRAFTING ──────────────────────────────────────────────────────────────────
export const RECIPE_CONFIG = {
  bread: {
    ingredients: { wheat: 3 } as Record<string, number>,
    craftMs: 1 * 60 * 60 * 1000,     // 1 hour
    baseValue: 18,
    lumiMultiplier: 2,
    xpOnCraft: 40,
  },
  stew: {
    ingredients: { wheat: 1, carrot: 2, corn: 1 } as Record<string, number>,
    craftMs: 4 * 60 * 60 * 1000,     // 4 hours
    baseValue: 28,
    lumiMultiplier: 2,
    xpOnCraft: 80,
  },
  wrap: {
    ingredients: { corn: 2, carrot: 1 } as Record<string, number>,
    craftMs: 2 * 60 * 60 * 1000,     // 2 hours
    baseValue: 22,
    lumiMultiplier: 2,
    xpOnCraft: 60,
  },
  ale: {
    ingredients: { wheat: 2, corn: 2 } as Record<string, number>,
    craftMs: 6 * 60 * 60 * 1000,     // 6 hours (barn required)
    baseValue: 38,
    lumiMultiplier: 3,
    xpOnCraft: 120,
  },
} as const;

export type RecipeId = keyof typeof RECIPE_CONFIG;

// ── SEASONS ───────────────────────────────────────────────────────────────────
export const SEASON_CONFIG = {
  PULSE_INTERVAL_MS: 10 * 60 * 1000, // Fee pulse every 10 minutes
  PULSES_PER_SEASON: 144,             // 144 × 10min = 24hrs per season
} as const;

export const SEASONS = ['SUMMER', 'AUTUMN', 'WINTER', 'SPRING'] as const;
export type Season = typeof SEASONS[number];

export const SEASON_EFFECTS: Record<Season, {
  yieldMultiplier: number;
  blightBonus: number;
  freezeChance: number;
  label: string;
  icon: string;
}> = {
  SUMMER: { yieldMultiplier: 1.2, blightBonus: 0,     freezeChance: 0,    label: 'Summer', icon: '☀️'  },
  AUTUMN: { yieldMultiplier: 1.0, blightBonus: 0.012,  freezeChance: 0,   label: 'Autumn', icon: '🍂'  },
  WINTER: { yieldMultiplier: 0.8, blightBonus: 0,     freezeChance: 0.07, label: 'Winter', icon: '❄️'  },
  SPRING: { yieldMultiplier: 1.1, blightBonus: 0,     freezeChance: 0,    label: 'Spring', icon: '🌸'  },
};

// ── UPGRADES ──────────────────────────────────────────────────────────────────
export const UPGRADE_CONFIG = {
  scarecrow:   { maxLevel: 3, costs: [15, 40, 100] as number[] },
  irrigation:  { maxLevel: 3, costs: [20, 55, 130] as number[] },
  barn:        { maxLevel: 1, costs: [45] as number[] },
  fertilizer:  { maxLevel: 2, costs: [25, 70] as number[] },
} as const;

export type UpgradeId = keyof typeof UPGRADE_CONFIG;

// ── PLOT UNLOCKS ──────────────────────────────────────────────────────────────
export const PLOT_TIERS = [
  { count: 7,  cost: 0   },  // Starter — free
  { count: 5,  cost: 30  },
  { count: 5,  cost: 80  },
  { count: 4,  cost: 180 },
] as const;

// ── BLIGHT & RARE DROPS ───────────────────────────────────────────────────────
export const BASE_BLIGHT_CHANCE  = 0.01;   // 1% per harvest
export const GOLDEN_SEED_CHANCE  = 0.005;  // 0.5% per harvest

// ── $LUMI ECONOMICS ───────────────────────────────────────────────────────────
export const LUMI_CONFIG = {
  feeVolumeToLumi:  0.00003,  // 0.003% of DEX volume per pulse → $LUMI pool
  rawSaleToLumi:    0.00005,  // per gold earned selling raw crops
  cookedSaleToLumi: 0.0002,   // per gold earned selling crafted goods
  bmSaleToLumi:     0.0004,   // per gold earned on black market
  convertRate:      0.001,    // 100 GOLD → 0.001 LUMI base rate
  minWithdrawal:    0.01,     // minimum LUMI to withdraw onchain
} as const;

// ── SKILL XP CURVE ────────────────────────────────────────────────────────────
export const MAX_SKILL_LEVEL = 50;

export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  return Math.floor(Math.pow(level - 1, 2.8) * 1.8);
}

export function totalXpForLevel(level: number): number {
  let total = 0;
  for (let i = 2; i <= level; i++) total += xpForLevel(i);
  return total;
}

// XP table: pre-computed for levels 1–50
export const XP_TABLE: number[] = Array.from(
  { length: MAX_SKILL_LEVEL + 1 },
  (_, i) => totalXpForLevel(i)
);

export function levelFromXP(xp: number): number {
  for (let i = MAX_SKILL_LEVEL - 1; i >= 1; i--) {
    if (xp >= XP_TABLE[i]) return i;
  }
  return 1;
}
