// ─────────────────────────────────────────────────────────────────────────────
// NPC RELATIONSHIP ENGINE
// Hearts track relationship with each NPC. Gifts raise hearts.
// Perks unlock at 3, 6, 9 hearts. Hearts decay after 3 days of no gifting.
// ─────────────────────────────────────────────────────────────────────────────

import { PrismaClient } from '@prisma/client';

export type NPCName = 'Mira' | 'Finn' | 'Lyra';

export interface NPCConfig {
  name: NPCName;
  favouriteGifts: Record<string, number>; // crop → heart gain
  lovedGift: string;                       // gives 2× hearts
  personality: string;
  perks: Record<3 | 6 | 9, { label: string; description: string }>;
  giftResponses: Record<string, string[]>; // what they say when gifted
}

export const NPC_CONFIGS: Record<NPCName, NPCConfig> = {
  Mira: {
    name: 'Mira',
    lovedGift: 'WHEAT',
    favouriteGifts: {
      WHEAT:  2,   // loved
      CARROT: 1,
      bread:  1,
      stew:   2,   // she loves hearty food
    },
    personality: 'warm, nurturing farmer who loves sharing tips',
    perks: {
      3: { label: 'Green Thumb Tips',    description: 'Mira shares fertility tips in chat every morning' },
      6: { label: 'Daily Watering',      description: 'Mira waters your crops once per day automatically' },
      9: { label: 'Guild Access',        description: 'Unlocks the Sunflower Guild — shared farm events' },
    },
    giftResponses: {
      WHEAT:  ['Oh, fresh wheat! You remembered 🌾 Thank you so much!', 'Wheat! My favourite. The soil thanks you too 🌱'],
      CARROT: ['Ooh carrots! Great for winter stew 🥕', 'Lovely carrots, thank you!'],
      stew:   ['You made me stew?! I\'m genuinely touched 🥣', 'Hearty stew... you really do care 💙'],
      bread:  ['Fresh bread! You\'re too kind 🍞'],
      default:['Oh! A gift? Thank you, that\'s so sweet 💙', 'You didn\'t have to! But I\'m glad you did 🌸'],
    },
  },
  Finn: {
    name: 'Finn',
    lovedGift: 'ale',
    favouriteGifts: {
      ale:    2,   // loved — he brews ale
      CORN:   1,   // trades corn constantly
      wrap:   1,
      CARROT: 1,
    },
    personality: 'sharp market trader who thinks in margins and multipliers',
    perks: {
      3: { label: 'BM Early Alert',     description: 'Finn tips you off 5s before black market deals appear' },
      6: { label: 'Premium Prices',     description: 'Finn buys your crops at +15% above market rate' },
      9: { label: 'Trade Signals',      description: 'Finn shares his private price predictions in chat' },
    },
    giftResponses: {
      ale:    ['Now THAT\'s a gift. Harvest Ale? You know me too well 🍺', 'Ale. Perfect. You\'re good at this.'],
      CORN:   ['Corn. Solid choice. I can work with this 📈', 'Good margins on corn right now. Appreciate it.'],
      wrap:   ['A wrap? Not bad. Not bad at all.'],
      default:['...a gift. Unexpected. Appreciated.', 'You didn\'t have to. But smart move 💰'],
    },
  },
  Lyra: {
    name: 'Lyra',
    lovedGift: 'CORN',
    favouriteGifts: {
      CORN:         2,   // loved — "corn remembers the old seasons"
      GOLDEN_WHEAT: 3,   // extremely rare, she treasures it
      WHEAT:        1,
      bread:        1,
    },
    personality: 'mysterious and poetic, speaks in riddles, deeply connected to the seasons',
    perks: {
      3: { label: 'Season Whispers',    description: 'Lyra warns you 1 pulse before a season changes' },
      6: { label: 'Seed Blessing',      description: 'Lyra gifts you rare seeds every Sunday' },
      9: { label: 'Alchemy Secrets',    description: 'Unlocks two secret crafting recipes only Lyra knows' },
    },
    giftResponses: {
      CORN:         ['Corn... the grain that remembers. I will keep this close 🌽', 'The old crop. The patient one. Thank you. ✨'],
      GOLDEN_WHEAT: ['...golden wheat. You found one. The soil truly trusts you. 🌟', 'I have not seen one of these in many seasons. I am... moved.'],
      WHEAT:        ['Wheat. Simple. Honest. Like the soil itself. 🌾'],
      default:      ['A gift freely given. The land notices. 🌙', 'Thank you. I will not forget this. ✨'],
    },
  },
};

// Heart decay: lose 1 heart after 3 days without gifting
const DECAY_DAYS = 3;
const MAX_HEARTS = 10;

export class RelationshipEngine {
  constructor(private db: PrismaClient) {}

  // ── GIFT AN NPC ───────────────────────────────────────────────────────────
  async giftNPC(
    playerId: string,
    npcName: NPCName,
    item: string,
    quantity: number = 1,
  ): Promise<{
    heartsGained: number;
    newHearts: number;
    newTier: number;
    tierUp: boolean;
    response: string;
    perkUnlocked: string | null;
  }> {
    const config = NPC_CONFIGS[npcName];
    if (!config) throw new Error('NPC not found');

    // Check player has the item
    const player = await this.db.player.findUniqueOrThrow({
      where: { id: playerId },
      select: { inventory: true },
    });
    const inv = player.inventory as Record<string, number>;
    if ((inv[item] ?? 0) < quantity) throw new Error(`Not enough ${item}`);

    // Calculate heart gain
    const baseGain = config.favouriteGifts[item] ?? 0;
    if (baseGain === 0) throw new Error(`${npcName} doesn't want that`);
    const heartsGained = baseGain * quantity;

    // Get or create relationship record
    const rel = await this.db.nPCRelationship.upsert({
      where: { playerId_npcName: { playerId, npcName } },
      create: { playerId, npcName, hearts: 0, lastGiftAt: null, totalGifts: 0 },
      update: {},
    });

    const prevHearts = rel.hearts;
    const prevTier = this.getTier(prevHearts);
    const newHearts = Math.min(MAX_HEARTS, prevHearts + heartsGained);
    const newTier = this.getTier(newHearts);
    const tierUp = newTier > prevTier;

    // Remove item from inventory
    inv[item] = (inv[item] ?? 0) - quantity;

    // Update relationship + inventory
    await Promise.all([
      this.db.nPCRelationship.update({
        where: { playerId_npcName: { playerId, npcName } },
        data: {
          hearts: newHearts,
          lastGiftAt: new Date(),
          totalGifts: { increment: 1 },
        },
      }),
      this.db.player.update({
        where: { id: playerId },
        data: { inventory: inv },
      }),
    ]);

    // Pick response
    const responses = config.giftResponses[item] ?? config.giftResponses.default;
    const response = responses[Math.floor(Math.random() * responses.length)];

    // Perk unlocked?
    const perkUnlocked = tierUp ? config.perks[newTier as 3 | 6 | 9]?.label ?? null : null;

    return { heartsGained, newHearts, newTier, tierUp, response, perkUnlocked };
  }

  // ── GET RELATIONSHIPS ─────────────────────────────────────────────────────
  async getRelationships(playerId: string): Promise<RelationshipState[]> {
    const rels = await this.db.nPCRelationship.findMany({
      where: { playerId },
    });

    const names: NPCName[] = ['Mira', 'Finn', 'Lyra'];
    return names.map(name => {
      const rel = rels.find(r => r.npcName === name);
      const hearts = rel?.hearts ?? 0;
      return {
        npcName: name,
        hearts,
        tier: this.getTier(hearts),
        lastGiftAt: rel?.lastGiftAt ?? null,
        totalGifts: rel?.totalGifts ?? 0,
        perks: this.getUnlockedPerks(name, hearts),
        nextPerk: this.getNextPerk(name, hearts),
        favourites: Object.keys(NPC_CONFIGS[name].favouriteGifts),
        lovedGift: NPC_CONFIGS[name].lovedGift,
      };
    });
  }

  // ── APPLY HEART DECAY ─────────────────────────────────────────────────────
  // Called daily by GameLoop — decay hearts if player hasn't gifted in 3+ days
  async applyDecay(): Promise<void> {
    const cutoff = new Date(Date.now() - DECAY_DAYS * 24 * 60 * 60 * 1000);

    // Find relationships where last gift was more than DECAY_DAYS ago
    const stale = await this.db.nPCRelationship.findMany({
      where: {
        hearts: { gt: 0 },
        OR: [
          { lastGiftAt: { lt: cutoff } },
          { lastGiftAt: null },
        ],
      },
    });

    for (const rel of stale) {
      await this.db.nPCRelationship.update({
        where: { id: rel.id },
        data: { hearts: Math.max(0, rel.hearts - 1) },
      });
    }

    console.log(`[Relationships] Decay applied to ${stale.length} relationships`);
  }

  // ── GET PERKS FOR A PLAYER ────────────────────────────────────────────────
  async getPlayerPerks(playerId: string): Promise<{
    miraWatersDaily: boolean;
    finnPriceBonus: number;
    finnBMEarlyAlert: boolean;
    lyraSeasonWarning: boolean;
    lyraWeeklySeeds: boolean;
    secretRecipes: boolean;
  }> {
    const rels = await this.getRelationships(playerId);
    const mira = rels.find(r => r.npcName === 'Mira');
    const finn = rels.find(r => r.npcName === 'Finn');
    const lyra = rels.find(r => r.npcName === 'Lyra');

    return {
      miraWatersDaily:   (mira?.tier ?? 0) >= 2,
      finnPriceBonus:    (finn?.tier ?? 0) >= 2 ? 1.15 : 1.0,
      finnBMEarlyAlert:  (finn?.tier ?? 0) >= 1,
      lyraSeasonWarning: (lyra?.tier ?? 0) >= 1,
      lyraWeeklySeeds:   (lyra?.tier ?? 0) >= 2,
      secretRecipes:     (lyra?.tier ?? 0) >= 3,
    };
  }

  // ── HELPERS ───────────────────────────────────────────────────────────────
  getTier(hearts: number): number {
    if (hearts >= 9) return 3;
    if (hearts >= 6) return 2;
    if (hearts >= 3) return 1;
    return 0;
  }

  getUnlockedPerks(name: NPCName, hearts: number): string[] {
    const config = NPC_CONFIGS[name];
    const perks: string[] = [];
    ([3, 6, 9] as const).forEach(threshold => {
      if (hearts >= threshold) perks.push(config.perks[threshold].label);
    });
    return perks;
  }

  getNextPerk(name: NPCName, hearts: number): { heartsNeeded: number; label: string } | null {
    const config = NPC_CONFIGS[name];
    for (const threshold of [3, 6, 9] as const) {
      if (hearts < threshold) {
        return { heartsNeeded: threshold - hearts, label: config.perks[threshold].label };
      }
    }
    return null; // max tier
  }
}

export interface RelationshipState {
  npcName: NPCName;
  hearts: number;
  tier: number;
  lastGiftAt: Date | null;
  totalGifts: number;
  perks: string[];
  nextPerk: { heartsNeeded: number; label: string } | null;
  favourites: string[];
  lovedGift: string;
}
