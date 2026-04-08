// ─────────────────────────────────────────────────────────────────────────────
// GAME LOOP
// The server heartbeat. Runs scheduled events: fee pulses, season changes,
// daily quest resets, passive fertility. This is what makes the world feel
// alive even when players aren't logged in.
//
// Key design: this does NOT simulate crop growth. Crops are timestamps.
// This only handles events that need to BROADCAST to connected players.
// ─────────────────────────────────────────────────────────────────────────────

import { PrismaClient } from '@prisma/client';
import { Server as SocketServer } from 'socket.io';
import {
  SEASON_CONFIG,
  SEASON_EFFECTS,
  SEASONS,
  LUMI_CONFIG,
  type Season,
} from './constants.js';
import { QuestEngine } from './QuestEngine.js';

interface GameState {
  currentSeason: Season;
  seasonPulseCount: number;
  currentBlockMultiplier: number;
  totalVolume: number;
  pulsesTotal: number;
}

export class GameLoop {
  private state: GameState;
  private pulseTimer: ReturnType<typeof setInterval> | null = null;
  private dailyResetTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private db: PrismaClient,
    private io: SocketServer,
    private questEngine: QuestEngine,
  ) {
    this.state = {
      currentSeason: 'SUMMER',
      seasonPulseCount: 0,
      currentBlockMultiplier: 1.0,
      totalVolume: 0,
      pulsesTotal: 0,
    };
  }

  start(): void {
    console.log('[GameLoop] Starting...');

    // Fee pulse every 10 minutes
    this.pulseTimer = setInterval(
      () => this.runFeePulse(),
      SEASON_CONFIG.PULSE_INTERVAL_MS,
    );

    // Daily quest reset at midnight UTC
    this.scheduleDailyReset();

    // Emit initial state to any connected clients
    this.broadcastGameState();

    console.log('[GameLoop] Running. Pulse interval:', SEASON_CONFIG.PULSE_INTERVAL_MS / 1000 / 60, 'minutes');
  }

  stop(): void {
    if (this.pulseTimer) clearInterval(this.pulseTimer);
    if (this.dailyResetTimer) clearInterval(this.dailyResetTimer);
    console.log('[GameLoop] Stopped.');
  }

  // ── FEE PULSE ─────────────────────────────────────────────────────────────
  // Simulates a DEX fee pulse. In production this reads from Uniswap v4 events.
  private async runFeePulse(): Promise<void> {
    const volume = 800 + Math.random() * 5500;
    const blockMult = Math.min(4.5, parseFloat((1 + volume / 55).toFixed(2)));

    this.state.totalVolume += volume;
    this.state.currentBlockMultiplier = blockMult;
    this.state.pulsesTotal++;
    this.state.seasonPulseCount++;

    // Emit $LUMI to all players proportional to their farm activity
    const lumiMinted = volume * LUMI_CONFIG.feeVolumeToLumi;

    // In production: distribute proportionally to plot count / fertility
    // For now: emit equally to all active players
    await this.distributeFeeLumi(lumiMinted);

    // Log the pulse
    await this.db.feePulse.create({
      data: {
        volume,
        multiplier: blockMult,
        lumiMinted,
      },
    });

    // Price drift — update market prices
    await this.updateMarketPrices(blockMult);

    // Check season change
    if (this.state.seasonPulseCount >= SEASON_CONFIG.PULSES_PER_SEASON) {
      await this.advanceSeason();
    }

    // Broadcast to all connected clients
    this.broadcastFeePulse(volume, blockMult, lumiMinted);
  }

  // ── DISTRIBUTE $LUMI ──────────────────────────────────────────────────────
  private async distributeFeeLumi(lumiMinted: number): Promise<void> {
    // Get all players who have been active in the last 24 hours
    const activePlayers = await this.db.player.findMany({
      where: {
        lastSeenAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
      select: { id: true },
    });

    if (activePlayers.length === 0) return;

    const perPlayer = lumiMinted / activePlayers.length;

    await this.db.player.updateMany({
      where: {
        id: { in: activePlayers.map(p => p.id) },
      },
      data: {
        lumiBalance: { increment: perPlayer },
        lumiTotal:   { increment: perPlayer },
      },
    });
  }

  // ── ADVANCE SEASON ────────────────────────────────────────────────────────
  private async advanceSeason(): Promise<void> {
    const currentIdx = SEASONS.indexOf(this.state.currentSeason);
    const nextSeason = SEASONS[(currentIdx + 1) % SEASONS.length];

    this.state.currentSeason = nextSeason;
    this.state.seasonPulseCount = 0;

    const effects = SEASON_EFFECTS[nextSeason];
    console.log(`[GameLoop] Season changed to ${nextSeason} (${effects.icon})`);

    // Winter: freeze some growing crops
    if (nextSeason === 'WINTER') {
      await this.applyWinterFreeze();
    }

    // Broadcast to all players
    this.io.emit('season:changed', {
      season: nextSeason,
      icon: effects.icon,
      label: effects.label,
      yieldMultiplier: effects.yieldMultiplier,
    });

    // Track for quests
    const allPlayers = await this.db.player.findMany({ select: { id: true } });
    for (const player of allPlayers) {
      await this.questEngine.trackStat(player.id, 'seasonsLived', 1);
    }
  }

  // ── WINTER FREEZE ─────────────────────────────────────────────────────────
  private async applyWinterFreeze(): Promise<void> {
    const freezeChance = SEASON_EFFECTS.WINTER.freezeChance;

    // Get all growing/planted plots
    const growingPlots = await this.db.plot.findMany({
      where: { state: { in: ['PLANTED', 'GROWING'] } },
      select: { id: true, playerId: true },
    });

    const toFreeze = growingPlots.filter(() => Math.random() < freezeChance * 0.15);

    if (toFreeze.length === 0) return;

    await this.db.plot.updateMany({
      where: { id: { in: toFreeze.map(p => p.id) } },
      data: {
        state: 'FROZEN',
        cropType: null,
        plantedAt: null,
        readyAt: null,
      },
    });

    // Notify affected players
    const affectedPlayerIds = [...new Set(toFreeze.map(p => p.playerId))];
    for (const playerId of affectedPlayerIds) {
      this.io.to(`player:${playerId}`).emit('plots:frozen', {
        count: toFreeze.filter(p => p.playerId === playerId).length,
        message: '❄️ Winter frost froze some of your crops!',
      });
    }
  }

  // ── MARKET PRICE DRIFT ────────────────────────────────────────────────────
  private async updateMarketPrices(blockMult: number): Promise<void> {
    const basePrices: Record<string, number> = {
      wheat: 2, carrot: 5, corn: 8,
      bread: 18, stew: 28, wrap: 22, ale: 38,
    };

    const updates = Object.entries(basePrices).map(([item, base]) => {
      const drift = (Math.random() - 0.45) * 0.35;
      const price = Math.max(base * 0.7, parseFloat((base * (1 + drift)).toFixed(1)));
      return { item, price };
    });

    await Promise.all(
      updates.map(({ item, price }) =>
        this.db.marketPrice.upsert({
          where: { item },
          create: { item, price },
          update: { price },
        })
      )
    );

    this.io.emit('market:prices', {
      prices: Object.fromEntries(updates.map(u => [u.item, u.price])),
      blockMultiplier: blockMult,
    });
  }

  // ── DAILY RESET ───────────────────────────────────────────────────────────
  private scheduleDailyReset(): void {
    // Calculate ms until next midnight UTC
    const now = new Date();
    const midnight = new Date(now);
    midnight.setUTCHours(24, 0, 0, 0);
    const msUntilMidnight = midnight.getTime() - now.getTime();

    setTimeout(() => {
      this.runDailyReset();
      // Then repeat every 24 hours
      this.dailyResetTimer = setInterval(
        () => this.runDailyReset(),
        24 * 60 * 60 * 1000,
      );
    }, msUntilMidnight);

    console.log(`[GameLoop] Daily reset in ${Math.round(msUntilMidnight / 1000 / 60)} minutes`);
  }

  private async runDailyReset(): Promise<void> {
    console.log('[GameLoop] Running daily reset...');
    await this.questEngine.resetDailyQuests();
    this.io.emit('quests:daily_reset', {
      message: '🌅 Daily quests have reset! New challenges available.',
    });
  }

  // ── BROADCAST HELPERS ─────────────────────────────────────────────────────
  private broadcastFeePulse(volume: number, blockMult: number, lumiMinted: number): void {
    this.io.emit('game:fee_pulse', {
      volume: Math.round(volume),
      blockMultiplier: blockMult,
      lumiMinted,
      season: this.state.currentSeason,
      pulsesUntilSeasonChange:
        SEASON_CONFIG.PULSES_PER_SEASON - this.state.seasonPulseCount,
    });
  }

  private broadcastGameState(): void {
    this.io.emit('game:state', {
      season: this.state.currentSeason,
      blockMultiplier: this.state.currentBlockMultiplier,
      seasonProgress: this.state.seasonPulseCount / SEASON_CONFIG.PULSES_PER_SEASON,
    });
  }

  getState(): Readonly<GameState> {
    return { ...this.state };
  }
}
