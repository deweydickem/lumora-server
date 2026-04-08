// ─────────────────────────────────────────────────────────────────────────────
// PLOT MANAGER
// Authoritative server-side crop logic.
// Key insight: crops don't "run" on the server — they're just timestamps.
// State is always CALCULATED from (plantedAt + growMs), never polled.
// ─────────────────────────────────────────────────────────────────────────────

import { PrismaClient, Plot, PlotState, CropType } from '@prisma/client';
import {
  CROP_CONFIG,
  BASE_BLIGHT_CHANCE,
  GOLDEN_SEED_CHANCE,
  SEASON_EFFECTS,
  type Season,
  type CropType as CropTypeKey,
} from './constants.js';

export interface PlotStateView {
  id: string;
  col: number;
  row: number;
  state: PlotState;
  cropType: CropType | null;
  fertility: number;
  isWatered: boolean;
  isLocked: boolean;
  // If growing: 0–1 progress fraction (calculated from timestamps)
  growProgress: number | null;
  // Seconds until ready (null if not growing)
  secondsUntilReady: number | null;
}

export interface HarvestResult {
  success: boolean;
  blighted: boolean;
  goldenSeed: boolean;
  yield: number;
  cropType: CropType;
  xpAwarded: number;
  lumiBonus: number;
}

export class PlotManager {
  constructor(private db: PrismaClient) {}

  // ── GET FARM STATE ─────────────────────────────────────────────────────────
  // Call this whenever a player loads their farm or another player visits.
  // Computes crop progress from timestamps — no server polling needed.
  async getFarmState(playerId: string): Promise<PlotStateView[]> {
    const plots = await this.db.plot.findMany({
      where: { playerId },
      orderBy: [{ row: 'asc' }, { col: 'asc' }],
    });

    const now = Date.now();

    return plots.map(plot => {
      const view: PlotStateView = {
        id: plot.id,
        col: plot.col,
        row: plot.row,
        state: plot.state,
        cropType: plot.cropType,
        fertility: plot.fertility,
        isWatered: plot.isWatered,
        isLocked: plot.isLocked,
        growProgress: null,
        secondsUntilReady: null,
      };

      // If planted/growing, calculate progress from timestamps
      if (plot.plantedAt && plot.readyAt && plot.cropType) {
        const totalMs = plot.readyAt.getTime() - plot.plantedAt.getTime();
        const elapsedMs = now - plot.plantedAt.getTime();
        const progress = Math.min(1, elapsedMs / totalMs);

        view.growProgress = progress;

        if (progress >= 1) {
          // Crop is done — update state if DB is stale
          if (plot.state !== 'READY') {
            // Fire-and-forget state update
            this.db.plot.update({
              where: { id: plot.id },
              data: { state: 'READY' },
            }).catch(console.error);
          }
          view.state = 'READY';
          view.secondsUntilReady = 0;
        } else {
          view.state = progress > 0.5 ? 'GROWING' : 'PLANTED';
          view.secondsUntilReady = Math.ceil(
            (plot.readyAt.getTime() - now) / 1000
          );
        }
      }

      return view;
    });
  }

  // ── TILL ──────────────────────────────────────────────────────────────────
  async tillPlot(plotId: string, playerId: string): Promise<Plot> {
    const plot = await this.getPlotOrThrow(plotId, playerId);

    if (plot.isLocked) throw new Error('Plot is locked');
    if (plot.state !== 'EMPTY') throw new Error(`Cannot till a ${plot.state} plot`);

    return this.db.plot.update({
      where: { id: plotId },
      data: { state: 'TILLED' },
    });
  }

  // ── PLANT ─────────────────────────────────────────────────────────────────
  async plantSeed(
    plotId: string,
    playerId: string,
    cropType: CropTypeKey,
    irrigationLevel: number = 0,
  ): Promise<Plot> {
    const plot = await this.getPlotOrThrow(plotId, playerId);

    if (plot.state !== 'TILLED') throw new Error('Plot must be tilled first');

    const config = CROP_CONFIG[cropType];
    const speedMultiplier = 1 - irrigationLevel * 0.15;
    const growMs = config.growMs * speedMultiplier;

    const now = new Date();
    const readyAt = new Date(now.getTime() + growMs);

    return this.db.plot.update({
      where: { id: plotId },
      data: {
        state: 'PLANTED',
        cropType: cropType as CropType,
        plantedAt: now,
        readyAt,
      },
    });
  }

  // ── WATER ─────────────────────────────────────────────────────────────────
  async waterPlot(
    plotId: string,
    playerId: string,
    farmingLevel: number = 1,
  ): Promise<Plot> {
    const plot = await this.getPlotOrThrow(plotId, playerId);

    const validStates: PlotState[] = ['TILLED', 'PLANTED', 'GROWING'];
    if (!validStates.includes(plot.state)) {
      throw new Error('Nothing to water here');
    }

    // Farming level 10+ gives bonus fertility from watering
    const fertilityGain = farmingLevel >= 10 ? 0.08 : 0.05;
    const newFertility = Math.min(1, plot.fertility + fertilityGain);

    return this.db.plot.update({
      where: { id: plotId },
      data: {
        isWatered: true,
        fertility: newFertility,
      },
    });
  }

  // ── HARVEST ───────────────────────────────────────────────────────────────
  // This is the most important function — it validates on the server.
  // The client can REQUEST a harvest, but the server decides the outcome.
  async harvestPlot(
    plotId: string,
    playerId: string,
    opts: {
      season: Season;
      blockMultiplier: number;
      scarecrowLevel: number;
      farmingLevel: number;
    }
  ): Promise<HarvestResult> {
    const plot = await this.getPlotOrThrow(plotId, playerId);

    if (plot.state !== 'READY' && !this.isReady(plot)) {
      throw new Error('Crop is not ready yet');
    }

    const cropType = plot.cropType as CropTypeKey;

    // ── VRF Blight check ──────────────────────────────────────────────────
    // In production replace Math.random() with a Chainlink VRF call
    const blightChance = Math.max(
      0,
      BASE_BLIGHT_CHANCE
        - opts.scarecrowLevel * 0.003
        + SEASON_EFFECTS[opts.season].blightBonus
    );

    if (Math.random() < blightChance) {
      // Blight strikes — crop is lost
      await this.db.plot.update({
        where: { id: plotId },
        data: {
          state: 'SCORCHED',
          cropType: null,
          plantedAt: null,
          readyAt: null,
          fertility: 0,
          isWatered: false,
        },
      });

      return {
        success: false,
        blighted: true,
        goldenSeed: false,
        yield: 0,
        cropType: plot.cropType!,
        xpAwarded: 0,
        lumiBonus: 0,
      };
    }

    // ── Golden wheat special harvest ──────────────────────────────────────
    if (cropType === 'GOLDEN_WHEAT') {
      const fertilityMult = 1 + Math.min(plot.fertility, 1) * 2;
      const yld = Math.max(10, Math.round(fertilityMult * opts.blockMultiplier * 10));
      const lumiBonus = parseFloat((0.01 * opts.blockMultiplier).toFixed(4));

      await this.db.plot.update({
        where: { id: plotId },
        data: {
          state: 'EMPTY',
          cropType: null,
          plantedAt: null,
          readyAt: null,
          fertility: Math.min(1, plot.fertility + 0.1), // golden crops enrich soil
          isWatered: false,
        },
      });

      return {
        success: true,
        blighted: false,
        goldenSeed: false,
        yield: yld,
        cropType: plot.cropType!,
        xpAwarded: 200,
        lumiBonus,
      };
    }

    // ── Normal harvest ────────────────────────────────────────────────────
    const config = CROP_CONFIG[cropType];
    const seasonMult = SEASON_EFFECTS[opts.season].yieldMultiplier;
    const fertilityMult = 1 + Math.min(plot.fertility, 1) * 2;
    const skillBonus = opts.farmingLevel >= 20 ? 1 : 0;

    const yld = Math.max(
      1,
      Math.round(fertilityMult * opts.blockMultiplier * seasonMult) + skillBonus
    );

    // Fertility degrades slightly each harvest
    const newFertility = Math.max(0, plot.fertility - 0.04);

    // Golden seed rare drop
    const goldenSeedDropped =
      Math.random() < GOLDEN_SEED_CHANCE * (opts.farmingLevel >= 40 ? 2 : 1);

    await this.db.plot.update({
      where: { id: plotId },
      data: {
        state: 'EMPTY',
        cropType: null,
        plantedAt: null,
        readyAt: null,
        fertility: newFertility,
        isWatered: false,
      },
    });

    return {
      success: true,
      blighted: false,
      goldenSeed: goldenSeedDropped,
      yield: yld,
      cropType: plot.cropType!,
      xpAwarded: config.xpOnHarvest,
      lumiBonus: 0,
    };
  }

  // ── TILL CROPS BACK IN (fertility boost) ──────────────────────────────────
  async tillCropsIn(plotId: string, playerId: string): Promise<Plot> {
    const plot = await this.getPlotOrThrow(plotId, playerId);

    if (!this.isReady(plot)) {
      throw new Error('Crop not ready to till back');
    }

    const fertilityBoost = 0.28;
    const newFertility = Math.min(1, plot.fertility + fertilityBoost);

    return this.db.plot.update({
      where: { id: plotId },
      data: {
        state: 'EMPTY',
        cropType: null,
        plantedAt: null,
        readyAt: null,
        fertility: newFertility,
        isWatered: false,
      },
    });
  }

  // ── RESTORE SCORCHED PLOT ─────────────────────────────────────────────────
  async restorePlot(
    plotId: string,
    playerId: string,
    cheapRestore: boolean = false
  ): Promise<{ plot: Plot; goldCost: number }> {
    const plot = await this.getPlotOrThrow(plotId, playerId);

    if (plot.state !== 'SCORCHED' && plot.state !== 'FROZEN') {
      throw new Error('Plot does not need restoring');
    }

    const goldCost = cheapRestore ? 3 : 5;

    const updated = await this.db.plot.update({
      where: { id: plotId },
      data: {
        state: 'EMPTY',
        fertility: 0.05,
        cropType: null,
        plantedAt: null,
        readyAt: null,
        isWatered: false,
      },
    });

    return { plot: updated, goldCost };
  }

  // ── PASSIVE FERTILITY (fertilizer upgrade) ────────────────────────────────
  // Called by the game loop every minute for each player with fertilizer upgrade
  async applyPassiveFertility(playerId: string, fertilizerLevel: number): Promise<void> {
    if (fertilizerLevel === 0) return;

    const gainPerTick = fertilizerLevel * 0.002; // per minute

    await this.db.plot.updateMany({
      where: {
        playerId,
        isLocked: false,
        state: { not: 'SCORCHED' },
        fertility: { lt: 1 },
      },
      data: {
        // Prisma doesn't support increment with max — handle in app layer
        // In production use a raw SQL query: UPDATE ... SET fertility = LEAST(1, fertility + $gain)
      },
    });

    // Raw SQL approach for the LEAST() constraint:
    await this.db.$executeRawUnsafe(
      `UPDATE plots SET fertility = LEAST(1.0, fertility + $1)
       WHERE "playerId" = $2 AND "isLocked" = false AND state != 'SCORCHED'`,
      gainPerTick,
      playerId
    );
  }

  // ── HELPERS ───────────────────────────────────────────────────────────────
  private async getPlotOrThrow(plotId: string, playerId: string): Promise<Plot> {
    const plot = await this.db.plot.findFirst({
      where: { id: plotId, playerId },
    });
    if (!plot) throw new Error('Plot not found');
    return plot;
  }

  private isReady(plot: Plot): boolean {
    if (plot.state === 'READY') return true;
    if (!plot.readyAt) return false;
    return plot.readyAt.getTime() <= Date.now();
  }
}
