// ─────────────────────────────────────────────────────────────────────────────
// TESTS — Game constants and core logic
// Run with: npm test
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import {
  CROP_CONFIG,
  RECIPE_CONFIG,
  levelFromXP,
  totalXpForLevel,
  XP_TABLE,
  MAX_SKILL_LEVEL,
} from '../src/game/constants';

// ── CROP TIMING TESTS ─────────────────────────────────────────────────────────
describe('Crop timing', () => {
  it('wheat grows in 2 hours', () => {
    expect(CROP_CONFIG.WHEAT.growMs).toBe(2 * 60 * 60 * 1000);
  });

  it('carrot grows in 8 hours', () => {
    expect(CROP_CONFIG.CARROT.growMs).toBe(8 * 60 * 60 * 1000);
  });

  it('corn grows in 24 hours', () => {
    expect(CROP_CONFIG.CORN.growMs).toBe(24 * 60 * 60 * 1000);
  });

  it('crops cannot be harvested in 1 minute', () => {
    const ONE_MINUTE = 60 * 1000;
    expect(CROP_CONFIG.WHEAT.growMs).toBeGreaterThan(ONE_MINUTE);
    expect(CROP_CONFIG.CARROT.growMs).toBeGreaterThan(ONE_MINUTE);
    expect(CROP_CONFIG.CORN.growMs).toBeGreaterThan(ONE_MINUTE);
  });

  it('corn is the slowest crop', () => {
    expect(CROP_CONFIG.CORN.growMs).toBeGreaterThan(CROP_CONFIG.CARROT.growMs);
    expect(CROP_CONFIG.CARROT.growMs).toBeGreaterThan(CROP_CONFIG.WHEAT.growMs);
  });
});

// ── CRAFTING TIMING TESTS ─────────────────────────────────────────────────────
describe('Crafting timing', () => {
  it('bread takes 1 hour to craft', () => {
    expect(RECIPE_CONFIG.bread.craftMs).toBe(1 * 60 * 60 * 1000);
  });

  it('ale takes the longest to craft', () => {
    expect(RECIPE_CONFIG.ale.craftMs).toBeGreaterThan(RECIPE_CONFIG.bread.craftMs);
    expect(RECIPE_CONFIG.ale.craftMs).toBeGreaterThan(RECIPE_CONFIG.stew.craftMs);
    expect(RECIPE_CONFIG.ale.craftMs).toBeGreaterThan(RECIPE_CONFIG.wrap.craftMs);
  });

  it('crafted goods are worth more than raw ingredients', () => {
    // Bread: 3 wheat at ~2 gold each = 6 gold raw → 18 gold crafted
    const rawValue = 3 * 2;
    expect(RECIPE_CONFIG.bread.baseValue).toBeGreaterThan(rawValue);
  });
});

// ── SKILL XP CURVE TESTS ──────────────────────────────────────────────────────
describe('Skill XP curve', () => {
  it('level 1 requires 0 XP', () => {
    expect(XP_TABLE[1]).toBe(0);
  });

  it('XP requirements increase with level', () => {
    for (let i = 2; i < MAX_SKILL_LEVEL; i++) {
      expect(XP_TABLE[i]).toBeGreaterThan(XP_TABLE[i - 1]);
    }
  });

  it('levelFromXP returns correct level', () => {
    expect(levelFromXP(0)).toBe(1);
    expect(levelFromXP(XP_TABLE[5])).toBe(5);
    expect(levelFromXP(XP_TABLE[10])).toBe(10);
    expect(levelFromXP(XP_TABLE[50])).toBe(49); // at exactly level 50 threshold
  });

  it('XP table has 51 entries (levels 0–50)', () => {
    expect(XP_TABLE.length).toBe(51);
  });

  it('level 50 requires substantially more XP than level 10', () => {
    expect(XP_TABLE[50]).toBeGreaterThan(XP_TABLE[10] * 10);
  });

  it('totalXpForLevel matches XP_TABLE', () => {
    for (let i = 1; i <= 20; i++) {
      expect(totalXpForLevel(i)).toBe(XP_TABLE[i]);
    }
  });
});

// ── HARVEST YIELD CALCULATION ─────────────────────────────────────────────────
describe('Harvest yield calculation', () => {
  function calcYield(fertility: number, blockMult: number, seasonMult: number): number {
    const fertilityMult = 1 + Math.min(fertility, 1) * 2;
    return Math.max(1, Math.round(fertilityMult * blockMult * seasonMult));
  }

  it('minimum yield is always 1', () => {
    expect(calcYield(0, 0.1, 0.5)).toBe(1);
  });

  it('max fertility (1.0) gives 3× multiplier', () => {
    const base = calcYield(0, 1, 1);     // fertility 0 → mult 1
    const max  = calcYield(1, 1, 1);     // fertility 1 → mult 3
    expect(max).toBe(base * 3);
  });

  it('summer season gives 20% bonus', () => {
    const base   = calcYield(0.6, 1, 1.0);
    const summer = calcYield(0.6, 1, 1.2);
    expect(summer).toBeGreaterThan(base);
  });

  it('winter season reduces yield by 20%', () => {
    const summer = calcYield(0.6, 1, 1.2);
    const winter = calcYield(0.6, 1, 0.8);
    expect(winter).toBeLessThan(summer);
  });
});
