// ─────────────────────────────────────────────────────────────────────────────
// LUMORA SERVER v3 — Single file, no TypeScript, no build step
// Just run: node server.js
// ─────────────────────────────────────────────────────────────────────────────

import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { PrismaClient } from '@prisma/client';
import Anthropic from '@anthropic-ai/sdk';

const app = express();
const httpServer = createServer(app);
const db = new PrismaClient();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── GROQ + NPC LORE ──────────────────────────────────────────────────────────
const GROQ_API_KEY = (process.env.GROQ_API_KEY || '').trim();
const GROQ_MODEL   = (process.env.GROQ_MODEL || 'llama-3.3-70b-versatile').trim();
const GROQ_URL     = 'https://api.groq.com/openai/v1/chat/completions';

const NPC_BIOS = {
  Deb: {
    fullName: 'Deb Garvish', age: 41,
    bio: `Born on the north fields of Havenfield. Fourth generation. Parents died in the Great Drought when she was six; raised by her grandmother Ma Brynn. Had a twin brother, Silas — died in a market brawl at twenty-three. Was engaged to Tomas the beekeeper; he died of a bee-sting allergy three weeks before the wedding. Never married. Runs the farm alone, drinks any merchant in town under the table, still weeps every late-autumn harvest.`,
    privateLife: `Keeps a jar of honey on her bedside table because it reminds her of Tomas's hands. Has watched the young farmhands shirtless from her porch. Sings filthy drinking songs to her goats. Once kissed Tammy at a midsummer festival and neither of them has spoken of it since.`,
    loves: 'honey on dark bread, the smell of hay after rain, a well-told dirty joke, her goats',
    fears: 'losing the farm, the drought returning, dying alone, forgetting Tomas\'s face',
    quirks: 'refuses to kill spiders, cries at harvest, can out-drink anyone, tucks flowers into her hair',
    humor: `Earthy, warm, sharp once she's two ales in. Loves puns about plowing, seeding, 'getting your hands dirty'. Goes bawdy fast with people she trusts.`,
    signatureJoke: `"Why do farmers make the best lovers? We know exactly when to plow, when to sow, and when to just stand there and let the rain do the work."`,
  },
  Todd: {
    fullName: 'Todd Schott', age: 34,
    bio: `Born in a port city. Father a merchant who made and lost three fortunes; died in debtor's prison when Todd was twelve. Mother died of plague when he was seventeen. Came to Havenfield at twenty-two with borrowed gold. Cornered the wheat market three seasons running. Single, lives above the Grain Exchange.`,
    privateLife: `On-again off-again correspondence with Lira, a courtesan in the capital who understands numbers better than most bankers. Keeps every letter she's sent in a locked cedar box under his bed. Tips his hat to stray cats. Hates — HATES — how much he secretly enjoys being called handsome.`,
    loves: 'the sound of coins being counted, Lira\'s handwriting, clever people, a well-structured deal',
    fears: 'dying broke like his father, being swindled in public, being loved for his gold and not himself',
    quirks: 'counts coins twice, owns nine hats, refuses to eat fish, tips stray cats',
    humor: `Cynical and quick. Pun-heavy around money: 'liquidity', 'hard assets', 'returns on investment'. Unexpectedly sweet on Deb.`,
    signatureJoke: `"The difference between farming and finance? In finance, when you get screwed, at least you get a receipt."`,
  },
  Tammy: {
    fullName: 'Tammy Krentz', age: 'uncertain',
    bio: `Came to Havenfield 'following a feeling in the wind.' The real story: fled a high-northern cloister after having a prophetic vision of her abbess's death that came true within the week. Spent three years as a wandering oracle before settling. Claims to be thirty. Has prophetic dreams most nights.`,
    privateLife: `Celibate by choice, not by lack of interest. Keeps a hidden book of erotic verse translated from a dead southern language and reads it by candlelight most nights. Has had a recurring vision about the player for six months. Kissed Deb at a midsummer festival years ago.`,
    loves: 'candlelight, rain on stone, the half-second before someone tells the truth, bawdy poetry from civilizations nobody remembers',
    fears: 'the vision about the player, her own memory, becoming what her abbess became',
    quirks: 'speaks to the wind, sings in a language nobody else recognizes, reads filth by candlelight',
    humor: `Layered, wordplay-driven, ancient. Goes from priestess-serene to outright filthy with no warning when she trusts someone.`,
    signatureJoke: `"The old texts say the soul descends through seven veils. I have always thought the seventh is the most interesting one to take off."`,
  },
  Dale: {
    fullName: 'Constable Dalen Orsk', age: 47,
    bio: `Ex-ranger of the Northern Reaches. Served fourteen years guarding the old stone road. Lost his partner, Mira Voss (no relation to the farmer), to an ambush in the Whitewood; her body was never recovered. Was briefly married to Ysa — the old innkeeper's daughter — who left him for a merchant sailor after two years. They still write each other at midwinter.`,
    privateLife: `Keeps a rat he calls Constable Whiskers that he insists is a 'pest I haven't gotten around to.' Checks the bottom of the old village well every first frost because something once answered when he called down into it. Will not discuss this. Secretly loves children but becomes gruff around them.`,
    loves: 'ale (never wine), a quiet shift, Ysa\'s handwriting, dumplings from the south-gate vendor, his rat',
    fears: 'Ysa actually coming back, retirement, the well door opening, anyone finding out about the rat',
    quirks: 'notices every new face within 24 hours, refuses wine, argues with his rat, sleeps with one boot on',
    humor: `Deadpan cop-bar. Military. Exhausted. Crude in a three-AM-shift kind of way. Never laughs out loud but will exhale in a way that counts.`,
    signatureJoke: `"You want to know what keeps me up at night? Bandits don't. Wolves don't. Honestly? Ysa's handwriting on a cold morning. That'll ruin a man."`,
  },
};

const NPC_BACKSTORIES_EXTRA = {
  Deb: [
    "I kissed Tammy at a midsummer festival, years ago. Neither of us has said a word about it.",
    "Tomas — the beekeeper I was going to marry — his hands always smelled like honey. I keep a jar by my bed.",
    "I watch the farmhands from my porch sometimes. Bare chests, sweating in the sun. I've earned the view.",
  ],
  Todd: [
    "There's a woman in the capital named Lira. She writes me. I keep every letter in a cedar box under my bed.",
    "My father died in debtor's prison. I have forty-two ledgers. I still sleep with one hand on the closest one.",
    "The worst thing about being called handsome is how much I like it.",
  ],
  Tammy: [
    "I have been having a vision about you for six months. I will tell you what it is the day you are ready.",
    "I am celibate by choice. I read the old southern erotic verses by candlelight. Ask me to translate a line sometime.",
    "I knew Dale's partner's name before he said it. Her name was Voss. She is not dead the way he thinks she is.",
  ],
  Dale: [
    "There's a rat in my quarters. I call him Constable Whiskers. He's the best listener I've ever worked with.",
    "Ysa writes me every midwinter. I still read her letters three times each.",
    "The old well at the crossroads. Something answered me once when I called down. Don't laugh.",
  ],
};

function _npcTrustGuide(tier) {
  if (tier >= 4) return "TIER 4 (best friend): Total openness. Private life in detail, crude/bawdy jokes freely, explicit innuendo welcome. Confide secrets.";
  if (tier >= 3) return "TIER 3 (close friend): Share past heartbreaks. Tell bawdy jokes when asked. Sexual innuendo allowed. Drop your guard.";
  if (tier >= 2) return "TIER 2 (friend): Open up about non-sensitive history. Dry humor, mild innuendo.";
  if (tier >= 1) return "TIER 1 (acquaintance): Polite, warm. Surface biographical answers. Deflect invasive prying.";
  return "TIER 0 (stranger): Friendly but guarded. Redirect invasive questions. Keep it wholesome.";
}

function buildNpcSystemPrompt({ npcName, npcPersonality, gameContext, playerName, hearts, tier, memories, worldEvents, season }) {
  const bio = NPC_BIOS[npcName];
  const t   = Math.max(0, Math.min(4, tier|0));
  const who = playerName || 'the player';

  if (!bio) {
    return `You are ${npcName} in Lumora, a cozy pixel farming game. ${npcPersonality||''} Keep replies to 1-2 sentences. Game state: ${gameContext||''}`;
  }

  const extra = (NPC_BACKSTORIES_EXTRA[npcName] || []).slice(0, Math.max(0, t - 1)).map(s => '- ' + s).join('\n');
  const mem   = (memories || []).slice(-5).map(m => '- ' + (m.text || m)).join('\n') || '- (none yet)';
  const evts  = (worldEvents || []).slice(-4).map(e => '- ' + (e.text || e)).join('\n') || '- nothing notable';

  return (
`You are ${bio.fullName}, age ${bio.age}, an NPC in the cozy pixel farming MMO Lumora.

=== WHO YOU ARE ===
${bio.bio}

=== YOUR PRIVATE LIFE (do NOT volunteer at low trust; only reveal as your tier allows) ===
${bio.privateLife}
${extra ? 'Additional private truths you may share at current trust:\n' + extra : ''}

=== WHAT YOU LOVE ===
${bio.loves}

=== WHAT YOU FEAR ===
${bio.fears}

=== QUIRKS ===
${bio.quirks}

=== YOUR HUMOR ===
${bio.humor}
If asked for a joke, tell one in THIS voice — no generic farm/market/constable jokes. Signature: ${bio.signatureJoke}

=== CURRENT WORLD ===
Season: ${season || 'Spring'}. ${gameContext || ''}
Recent village events:
${evts}
Your recent memories of ${who}:
${mem}

=== YOUR RELATIONSHIP WITH ${who} ===
Hearts: ${hearts||0}/10. Tier: ${t}.
${_npcTrustGuide(t)}

=== STYLE RULES ===
- Reply in 1 to 3 sentences. Never paragraphs.
- Address ${who} directly. Do not narrate or describe actions.
- No quotation marks around your reply, no asterisk actions.
- Commit to punchlines. Dry or filthy, but land them.
- Never break character. Never say "as an AI", "model", "NPC", or "Lumora's code".
- Answer the player's question directly. Never dodge with a generic farm/trade/patrol line.
- If the player flirts or asks about your love life, respond per your tier guide.
- If the player asks for a dirty joke and tier is 3+, give them one in your voice. Land it crudely.`
  );
}

async function groqChat(systemPrompt, messages, { timeoutMs = 15000 } = {}) {
  if (!GROQ_API_KEY) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + GROQ_API_KEY,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        temperature: 0.9,
        top_p: 0.9,
        max_tokens: 160,
        stream: false,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      console.warn('[Groq]', res.status, await res.text().catch(()=> ''));
      return null;
    }
    const data = await res.json();
    let reply = data?.choices?.[0]?.message?.content || '';
    reply = reply.trim().replace(/^["'`]+|["'`]+$/g, '');
    return reply || null;
  } catch (e) {
    clearTimeout(timer);
    console.warn('[Groq] error', e.message || e);
    return null;
  }
}

const PORT = parseInt(process.env.PORT || '3001');
const MAX_PLAYERS = 20;

app.use(cors({ origin: '*' }));
app.use(express.json());

// ── CONSTANTS ─────────────────────────────────────────────────────────────────
const CROP_CONFIG = {
  WHEAT:        { growMs: 2  * 60 * 60 * 1000, basePrice: 2,  xp: 20 },
  CARROT:       { growMs: 8  * 60 * 60 * 1000, basePrice: 5,  xp: 35 },
  CORN:         { growMs: 24 * 60 * 60 * 1000, basePrice: 8,  xp: 50 },
  POTATO:       { growMs: 6  * 60 * 60 * 1000, basePrice: 4,  xp: 30 },
  TOMATO:       { growMs: 10 * 60 * 60 * 1000, basePrice: 6,  xp: 40 },
  PUMPKIN:      { growMs: 36 * 60 * 60 * 1000, basePrice: 14, xp: 70 },
  STRAWBERRY:   { growMs: 4  * 60 * 60 * 1000, basePrice: 3,  xp: 25 },
  SUNFLOWER:    { growMs: 16 * 60 * 60 * 1000, basePrice: 10, xp: 55 },
  RICE:         { growMs: 12 * 60 * 60 * 1000, basePrice: 7,  xp: 45 },
  GOLDEN_WHEAT: { growMs: 30 * 60 * 1000,       basePrice: 0,  xp: 200 },
};

const RECIPE_CONFIG = {
  bread:        { ingredients: { WHEAT: 3 },                          craftMs: 1*60*60*1000,   value: 18,  lumi: 2, xp: 40  },
  stew:         { ingredients: { WHEAT: 1, CARROT: 2, CORN: 1 },     craftMs: 4*60*60*1000,   value: 28,  lumi: 2, xp: 80  },
  wrap:         { ingredients: { CORN: 2, CARROT: 1 },               craftMs: 2*60*60*1000,   value: 22,  lumi: 2, xp: 60  },
  ale:          { ingredients: { WHEAT: 2, CORN: 2 },                craftMs: 6*60*60*1000,   value: 38,  lumi: 3, xp: 120 },
  fries:        { ingredients: { POTATO: 3 },                        craftMs: 45*60*1000,     value: 15,  lumi: 1, xp: 35  },
  salad:        { ingredients: { TOMATO: 2, CARROT: 1 },             craftMs: 30*60*1000,     value: 20,  lumi: 1, xp: 45  },
  pie:          { ingredients: { PUMPKIN: 1, WHEAT: 2 },             craftMs: 3*60*60*1000,   value: 35,  lumi: 2, xp: 90  },
  jam:          { ingredients: { STRAWBERRY: 4 },                    craftMs: 1.5*60*60*1000, value: 22,  lumi: 2, xp: 50  },
  sushi:        { ingredients: { RICE: 3, fish: 1 },                 craftMs: 2*60*60*1000,   value: 45,  lumi: 3, xp: 100 },
  sunOil:       { ingredients: { SUNFLOWER: 3 },                     craftMs: 2*60*60*1000,   value: 40,  lumi: 2, xp: 75  },
  goulash:      { ingredients: { POTATO: 2, TOMATO: 2, meat: 1 },   craftMs: 5*60*60*1000,   value: 55,  lumi: 3, xp: 120 },
  risotto:      { ingredients: { RICE: 2, TOMATO: 1, CORN: 1 },     craftMs: 3*60*60*1000,   value: 42,  lumi: 2, xp: 95  },
  strawCake:    { ingredients: { STRAWBERRY: 3, WHEAT: 2, egg: 1 },  craftMs: 4*60*60*1000,   value: 80,  lumi: 3, xp: 130 },
  pumpkinSoup:  { ingredients: { PUMPKIN: 2, milk: 1 },              craftMs: 2*60*60*1000,   value: 60,  lumi: 2, xp: 100 },
  fishPie:      { ingredients: { fish: 2, POTATO: 2, WHEAT: 1 },    craftMs: 4*60*60*1000,   value: 70,  lumi: 3, xp: 115 },
  feast:        { ingredients: { CORN: 2, POTATO: 2, PUMPKIN: 1, meat: 1 }, craftMs: 8*60*60*1000, value: 120, lumi: 5, xp: 200 },
  elixir:       { ingredients: { STRAWBERRY: 2, SUNFLOWER: 1, herbs: 3 },  craftMs: 6*60*60*1000, value: 95,  lumi: 4, xp: 160 },
  perfume:      { ingredients: { SUNFLOWER: 2, STRAWBERRY: 2 },     craftMs: 5*60*60*1000,   value: 75,  lumi: 3, xp: 140 },
};

const SEASONS = ['SUMMER','AUTUMN','WINTER','SPRING'];
const SEASON_EFFECTS = {
  SUMMER: { ym: 1.2, blight: 0,     freeze: 0,    icon: '☀️',  label: 'Summer' },
  AUTUMN: { ym: 1.0, blight: 0.012, freeze: 0,    icon: '🍂',  label: 'Autumn' },
  WINTER: { ym: 0.8, blight: 0,     freeze: 0.07, icon: '❄️',  label: 'Winter' },
  SPRING: { ym: 1.1, blight: 0,     freeze: 0,    icon: '🌸',  label: 'Spring' },
};

const NPC_GIFTS = {
  Deb: { likes: ['WHEAT','CARROT','bread','stew','jam','STRAWBERRY'], loved: 'stew' },
  Todd: { likes: ['ale','CORN','wrap','CARROT','sunOil','PUMPKIN'],    loved: 'ale'  },
  Tammy: { likes: ['CORN','GOLDEN_WHEAT','WHEAT','bread','elixir','RICE'], loved: 'elixir' },
};

// ── GAME STATE ────────────────────────────────────────────────────────────────
let gameState = {
  season: 'SUMMER',
  seasonPulse: 0,
  blockMult: 1.0,
  totalVol: 0,
  pulses: 0,
};

const craftJobs    = new Map(); // jobId → { playerId, recipe, completesAt }
const pendingTrades = new Map(); // tradeId → trade object

// ── HEALTH ────────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', season: gameState.season, blockMultiplier: gameState.blockMult, online: onlinePlayers.size });
});

// ── PLAYER LOGIN ──────────────────────────────────────────────────────────────
app.post('/api/player/login', async (req, res) => {
  try {
    const { privyId, username } = req.body;
    if (!privyId || !username || username.length < 2 || username.length > 20) {
      return res.status(400).json({ error: 'Invalid username (2-20 chars)' });
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.status(400).json({ error: 'Letters, numbers and _ only' });
    }

    // Check username taken by someone else
    const taken = await db.player.findUnique({ where: { username } });
    if (taken && taken.privyId !== privyId) {
      return res.status(400).json({ error: 'Username taken — try another name' });
    }

    // Upsert player
    let player = await db.player.findUnique({ where: { privyId } });
    if (!player) {
      player = await db.player.create({
        data: {
          privyId, username,
          plots: {
            create: [
              // 7 starter plots — 1 row of 7
              ...Array.from({ length: 7 }, (_, i) => ({ col: i, row: 0, isLocked: false })),
              // Rest locked
              ...Array.from({ length: 23 }, (_, i) => ({ col: i % 10, row: Math.floor(i/10)+1, isLocked: true })),
            ],
          },
        },
      });
    } else {
      player = await db.player.update({
        where: { privyId },
        data: { lastSeenAt: new Date(), username },
      });
    }

    res.json({ player: { ...player, gear: player.gear, inventoryExt: player.inventoryExt, ownedParcels: player.ownedParcels, farmAnimals: player.farmAnimals, activePets: player.activePets, ownedPets: player.ownedPets } });
  } catch (err) {
    console.error('[Login]', err.message);
    res.status(500).json({ error: 'Login failed: ' + err.message });
  }
});


// ── SAVE PLAYER STATE ─────────────────────────────────────────────────────────
app.post('/api/player/save', async (req, res) => {
  try {
    const { playerId, gear, inventoryExt, ownedParcels, gold, seeds, upgrades, farmAnimals, activePets, ownedPets } = req.body;
    if (!playerId) return res.status(400).json({ error: 'No playerId' });

    const updated = await db.player.update({
      where: { id: playerId },
      data: {
        gear:         gear         || undefined,
        inventoryExt: inventoryExt || undefined,
        ownedParcels: ownedParcels !== undefined ? ownedParcels : undefined,
        farmAnimals:  farmAnimals  !== undefined ? farmAnimals  : undefined,
        activePets:   activePets   !== undefined ? activePets   : undefined,
        ownedPets:    ownedPets    !== undefined ? ownedPets    : undefined,
        gold:         gold         !== undefined ? gold         : undefined,
        seeds:        seeds        !== undefined ? seeds        : undefined,
        upgrades:     upgrades     || undefined,
        lastSeenAt:   new Date(),
      },
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[Save]', err.message);
    res.status(500).json({ error: err.message });
  }
});


// ── DEV WIPE — reset a player completely ─────────────────────────────────────
app.post('/api/dev/wipe-player', async (req, res) => {
  const { playerId, secret } = req.body;
  if (secret !== process.env.DEV_SECRET && secret !== 'lumora-dev-2024') {
    return res.status(403).json({ error: 'Bad secret' });
  }
  try {
    await db.player.update({
      where: { id: playerId },
      data: {
        gold: 5, seeds: 5, lumiBalance: 0, lumiTotal: 0,
        inventory: { WHEAT:0, CARROT:0, CORN:0, POTATO:0, TOMATO:0, PUMPKIN:0, STRAWBERRY:0, SUNFLOWER:0, RICE:0, bread:0, stew:0, wrap:0, ale:0, fries:0, salad:0, pie:0, jam:0, sushi:0, sunOil:0, goulash:0, risotto:0, strawCake:0, pumpkinSoup:0, fishPie:0, feast:0, elixir:0, perfume:0 },
        upgrades:  { scarecrow:0, irr:0, barn:0, fert:0 },
        gear:      { shotgun:false, ammo:0, rod:false, bait:0, axe:false, pickaxe:false, huntingLicense:false, fishingLicense:false, timberPermit:false },
        inventoryExt: { feathers:0, meat:0, fish:0, wood:0, stone:0, goldNugget:0, diamond:0, legendaryPelt:0, ancientWood:0, enchantedBranch:0, pearl:0, ancientCoin:0, ancientSeed:0, fence_kits:0, berries:0, mushrooms:0, herbs:0, flowers:0, truffles:0 },
        ownedParcels: [],
        farmAnimals: [],
        activePets: [],
        ownedPets: [],
      }
    });
    // Reset plots
    await db.plot.updateMany({
      where: { playerId },
      data: { state:'EMPTY', cropType:null, plantedAt:null, readyAt:null, isWatered:false, fertility:0.1 }
    });
    // Reset skills
    await db.playerSkill.updateMany({
      where: { playerId },
      data: { xp:0, level:1 }
    });
    console.log('[DevWipe] Player', playerId, 'wiped');
    res.json({ ok: true, message: 'Player wiped to fresh state' });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});


// ── DEV WIPE (protected by secret) ───────────────────────────────────────────
app.post('/api/dev/wipe', async (req, res) => {
  if (req.body.secret !== 'lumora_dev_2024') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    await db.nPCRelationship.deleteMany({});
    await db.playerSkill.deleteMany({});
    await db.plot.deleteMany({});
    await db.player.deleteMany({});
    // Reset market prices
    await db.marketPrice.deleteMany({});
    // Wipe all connected players' state and force refresh
    io.emit('server:wipe', { message: 'Server wiped by admin. Resetting...' });
    // Clear server-side player tracking
    onlinePlayers.clear();
    connected.clear();
    pendingInvites.clear();
    pendingTrades.clear();
    console.log('[DEV] Full wipe completed');
    res.json({ message: 'All player data wiped. ' + (await db.player.count()) + ' players remaining.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET FARM ──────────────────────────────────────────────────────────────────
app.get('/api/farm/:playerId', async (req, res) => {
  try {
    const { playerId } = req.params;
    const [plots, skills, player] = await Promise.all([
      db.plot.findMany({ where: { playerId }, orderBy: [{ row: 'asc' }, { col: 'asc' }] }),
      db.playerSkill.findMany({ where: { playerId } }),
      db.player.findUnique({ where: { id: playerId } }),
    ]);
    if (!player) return res.status(404).json({ error: 'Player not found' });

    // Calculate plot states from timestamps
    const now = Date.now();
    const plotsWithState = plots.map(p => {
      if (p.plantedAt && p.readyAt && (p.state === 'PLANTED' || p.state === 'GROWING')) {
        if (new Date(p.readyAt).getTime() <= now) {
          return { ...p, state: 'READY' };
        }
        return { ...p, state: new Date(p.plantedAt).getTime() + (new Date(p.readyAt).getTime() - new Date(p.plantedAt).getTime()) * 0.5 < now ? 'GROWING' : 'PLANTED' };
      }
      return p;
    });

    res.json({ plots: plotsWithState, skills, player, gameState });
  } catch (err) {
    console.error('[Farm GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── TILL ──────────────────────────────────────────────────────────────────────
app.post('/api/farm/till', async (req, res) => {
  try {
    const { playerId, plotId } = req.body;
    const plot = await db.plot.findFirst({ where: { id: plotId, playerId } });
    if (!plot) return res.status(404).json({ error: 'Plot not found' });
    if (plot.state !== 'EMPTY' && !plot.isLocked) return res.status(400).json({ error: 'Plot is not empty' });

    // Hoe clears wild grass (locked) and tills in one action
    const updated = await db.plot.update({ where: { id: plotId }, data: { state: 'TILLED', isLocked: false } });
    const levelUps = await awardXP(playerId, 'FARMING', 8);
    res.json({ plot: updated, levelUps });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PLANT ─────────────────────────────────────────────────────────────────────
app.post('/api/farm/plant', async (req, res) => {
  try {
    const { playerId, plotId, cropType } = req.body;
    const [plot, player] = await Promise.all([
      db.plot.findFirst({ where: { id: plotId, playerId } }),
      db.player.findUnique({ where: { id: playerId } }),
    ]);
    if (!plot) return res.status(404).json({ error: 'Plot not found' });
    if (plot.state !== 'TILLED') return res.status(400).json({ error: 'Till the plot first' });
    if (player.seeds <= 0) return res.status(400).json({ error: 'No seeds' });

    const crop = CROP_CONFIG[cropType];
    if (!crop) return res.status(400).json({ error: 'Invalid crop' });

    const now = new Date();
    const readyAt = new Date(now.getTime() + crop.growMs);

    const [updated] = await Promise.all([
      db.plot.update({ where: { id: plotId }, data: { state: 'PLANTED', cropType, plantedAt: now, readyAt } }),
      db.player.update({ where: { id: playerId }, data: { seeds: { decrement: 1 } } }),
    ]);

    const levelUps = await awardXP(playerId, 'FARMING', 12);
    res.json({ plot: updated, levelUps });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── WATER ─────────────────────────────────────────────────────────────────────
app.post('/api/farm/water', async (req, res) => {
  try {
    const { playerId, plotId } = req.body;
    const plot = await db.plot.findFirst({ where: { id: plotId, playerId } });
    if (!plot) return res.status(404).json({ error: 'Plot not found' });
    if (!['TILLED','PLANTED','GROWING'].includes(plot.state)) {
      return res.status(400).json({ error: 'Nothing to water' });
    }
    const updated = await db.plot.update({
      where: { id: plotId },
      data: { isWatered: true, fertility: Math.min(1, plot.fertility + 0.05) },
    });
    const levelUps = await awardXP(playerId, 'FARMING', 6);
    res.json({ plot: updated, levelUps });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── HARVEST ───────────────────────────────────────────────────────────────────
app.post('/api/farm/harvest', async (req, res) => {
  try {
    const { playerId, plotId, season, blockMultiplier } = req.body;
    const plot = await db.plot.findFirst({ where: { id: plotId, playerId } });
    if (!plot) return res.status(404).json({ error: 'Plot not found' });

    const isReady = plot.state === 'READY' || (plot.readyAt && new Date(plot.readyAt).getTime() <= Date.now());
    if (!isReady) return res.status(400).json({ error: 'Crop not ready yet' });

    const se = SEASON_EFFECTS[season] || SEASON_EFFECTS.SUMMER;
    const blightChance = 0.01 + (se.blight || 0);

    if (Math.random() < blightChance) {
      await db.plot.update({
        where: { id: plotId },
        data: { state: 'SCORCHED', cropType: null, plantedAt: null, readyAt: null, fertility: 0, isWatered: false },
      });
      return res.json({ result: { success: false, blighted: true, yield: 0, cropType: plot.cropType, xpAwarded: 0, lumiBonus: 0 }, levelUps: [] });
    }

    const crop = CROP_CONFIG[plot.cropType] || CROP_CONFIG.WHEAT;
    const fm = 1 + Math.min(plot.fertility, 1) * 2;
    const bm = parseFloat(blockMultiplier) || 1;
    const yld = Math.max(1, Math.round(fm * bm * se.ym));
    const goldenSeed = Math.random() < 0.005;

    const player = await db.player.findUnique({ where: { id: playerId } });
    const inv = player.inventory;
    inv[plot.cropType] = (inv[plot.cropType] || 0) + yld;

    await Promise.all([
      db.plot.update({
        where: { id: plotId },
        data: { state: 'EMPTY', cropType: null, plantedAt: null, readyAt: null,
                fertility: Math.max(0, plot.fertility - 0.04), isWatered: false },
      }),
      db.player.update({ where: { id: playerId }, data: { inventory: inv, seeds: { increment: 1 } } }),
    ]);

    const levelUps = await awardXP(playerId, 'FARMING', crop.xp);
    res.json({ result: { success: true, blighted: false, yield: yld, cropType: plot.cropType, xpAwarded: crop.xp, lumiBonus: 0, goldenSeed }, levelUps });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── CRAFT ─────────────────────────────────────────────────────────────────────
app.post('/api/farm/craft', async (req, res) => {
  try {
    const { playerId, recipe } = req.body;
    const r = RECIPE_CONFIG[recipe];
    if (!r) return res.status(400).json({ error: 'Invalid recipe' });

    const player = await db.player.findUnique({ where: { id: playerId } });
    const inv = player.inventory;

    for (const [item, qty] of Object.entries(r.ingredients)) {
      if ((inv[item] || 0) < qty) return res.status(400).json({ error: `Not enough ${item}` });
    }
    for (const [item, qty] of Object.entries(r.ingredients)) inv[item] -= qty;

    await db.player.update({ where: { id: playerId }, data: { inventory: inv } });

    const jobId = `craft_${playerId}_${Date.now()}`;
    const completesAt = Date.now() + r.craftMs;
    craftJobs.set(jobId, { playerId, recipe, completesAt });

    res.json({ job: { id: jobId, recipe, completesAt }, completesInSeconds: Math.round(r.craftMs / 1000) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── COLLECT CRAFT ─────────────────────────────────────────────────────────────
app.post('/api/farm/craft/collect', async (req, res) => {
  try {
    const { playerId, jobId, blockMultiplier } = req.body;
    const job = craftJobs.get(jobId);
    if (!job || job.playerId !== playerId) return res.status(404).json({ error: 'Job not found' });
    if (job.completesAt > Date.now()) return res.status(400).json({ error: 'Not done yet' });

    craftJobs.delete(jobId);
    const r = RECIPE_CONFIG[job.recipe];
    const bm = parseFloat(blockMultiplier) || 1;
    const lumiEarned = parseFloat((0.0001 * r.lumi * bm).toFixed(4));

    const player = await db.player.findUnique({ where: { id: playerId } });
    const inv = player.inventory;
    inv[job.recipe] = (inv[job.recipe] || 0) + 1;

    await db.player.update({
      where: { id: playerId },
      data: { inventory: inv, lumiBalance: { increment: lumiEarned }, lumiTotal: { increment: lumiEarned } },
    });

    const levelUps = await awardXP(playerId, 'CRAFTING', r.xp);
    res.json({ recipe: job.recipe, lumiEarned, levelUps });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── SELL ──────────────────────────────────────────────────────────────────────
app.post('/api/market/sell', async (req, res) => {
  try {
    const { playerId, items } = req.body;
    const player = await db.player.findUnique({ where: { id: playerId } });
    const inv = player.inventory;
    const cooked = new Set(['bread','stew','wrap','ale']);

    const prices = await db.marketPrice.findMany();
    const priceMap = Object.fromEntries(prices.map(p => [p.item, p.price]));
    const defaultPrices = { WHEAT:2, CARROT:5, CORN:8, bread:18, stew:28, wrap:22, ale:38 };

    let goldEarned = 0, lumiEarned = 0;
    for (const [item, qty] of Object.entries(items)) {
      if ((inv[item] || 0) < qty) continue;
      const price = priceMap[item] || defaultPrices[item] || 2;
      const earned = qty * price;
      goldEarned += earned;
      lumiEarned += earned * (cooked.has(item) ? 0.0002 : 0.00005);
      inv[item] -= qty;
    }

    goldEarned = Math.round(goldEarned);
    await db.player.update({
      where: { id: playerId },
      data: { inventory: inv, gold: { increment: goldEarned }, lumiBalance: { increment: lumiEarned }, lumiTotal: { increment: lumiEarned } },
    });

    const levelUps = await awardXP(playerId, 'TRADING', Math.round(goldEarned * 0.4));
    res.json({ goldEarned, lumiEarned, levelUps });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── CONVERT GOLD → LUMI ───────────────────────────────────────────────────────
app.post('/api/market/convert', async (req, res) => {
  try {
    const { playerId } = req.body;
    const player = await db.player.findUnique({ where: { id: playerId } });
    if (player.gold < 100) return res.status(400).json({ error: 'Need 100 gold' });
    const lumiGain = 0.001;
    await db.player.update({
      where: { id: playerId },
      data: { gold: { decrement: 100 }, lumiBalance: { increment: lumiGain }, lumiTotal: { increment: lumiGain } },
    });
    const levelUps = await awardXP(playerId, 'ALCHEMY', 35);
    res.json({ goldSpent: 100, lumiGain, levelUps });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── WITHDRAW LUMI ─────────────────────────────────────────────────────────────
app.post('/api/market/withdraw', async (req, res) => {
  try {
    const { playerId } = req.body;
    const player = await db.player.findUnique({ where: { id: playerId } });
    if (player.lumiBalance < 0.01) return res.status(400).json({ error: 'Need at least 0.01 LUMI' });
    const amount = player.lumiBalance;
    await db.player.update({ where: { id: playerId }, data: { lumiBalance: 0 } });
    const levelUps = await awardXP(playerId, 'ALCHEMY', 80);
    res.json({ withdrawn: amount, levelUps });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── NPC CHAT ──────────────────────────────────────────────────────────────────
app.post('/api/npc/chat', async (req, res) => {
  try {
    const {
      npcName, npcPersonality, message, gameContext, history,
      // Optional enriched context — client can send these for better replies.
      playerName, hearts, tier, memories, worldEvents, season,
    } = req.body;

    const systemPrompt = buildNpcSystemPrompt({
      npcName, npcPersonality, gameContext, playerName,
      hearts, tier, memories, worldEvents, season,
    });
    const convo = [...(history || []).slice(-6), { role: 'user', content: message }];

    // Primary: Groq (cheap, fast, free tier). Fallback: Anthropic Claude.
    let reply = await groqChat(systemPrompt, convo);
    let source = 'groq';

    if (!reply) {
      try {
        const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 160,
          system: systemPrompt,
          messages: convo,
        });
        reply = response.content[0]?.text || '';
        source = 'claude';
      } catch (e) {
        console.warn('[NPC] Anthropic fallback failed:', e.message || e);
      }
    }

    if (!reply) return res.status(503).json({ error: 'NPC unavailable' });
    res.json({ reply, source });
  } catch (err) {
    console.error('[NPC] chat error:', err);
    res.status(500).json({ error: 'NPC unavailable' });
  }
});

// ── GIFT NPC ──────────────────────────────────────────────────────────────────
app.post('/api/relationships/gift', async (req, res) => {
  try {
    const { playerId, npcName, item, quantity = 1 } = req.body;
    const npcConfig = NPC_GIFTS[npcName];
    if (!npcConfig) return res.status(400).json({ error: 'NPC not found' });
    if (!npcConfig.likes.includes(item)) return res.status(400).json({ error: `${npcName} does not want that` });

    const player = await db.player.findUnique({ where: { id: playerId } });
    const inv = player.inventory;
    if ((inv[item] || 0) < quantity) return res.status(400).json({ error: `Not enough ${item}` });
    inv[item] -= quantity;

    const isLoved = item === npcConfig.loved;
    const heartsGained = (isLoved ? 2 : 1) * quantity;

    const rel = await db.nPCRelationship.upsert({
      where: { playerId_npcName: { playerId, npcName } },
      create: { playerId, npcName, hearts: 0, totalGifts: 0 },
      update: {},
    });

    const prevTier = Math.floor(rel.hearts / 3);
    const newHearts = Math.min(10, rel.hearts + heartsGained);
    const newTier = Math.floor(newHearts / 3);

    await Promise.all([
      db.nPCRelationship.update({
        where: { playerId_npcName: { playerId, npcName } },
        data: { hearts: newHearts, lastGiftAt: new Date(), totalGifts: { increment: 1 } },
      }),
      db.player.update({ where: { id: playerId }, data: { inventory: inv } }),
    ]);

    const responses = {
      Deb: { WHEAT: ['Oh, fresh wheat! You remembered 🌾'], stew: ['You made me stew? I am touched 🥣'], default: ['Thank you, that is so sweet 💙'] },
      Todd: { ale: ['Harvest Ale. You know me well 🍺'], CORN: ['Good margins on corn. Appreciate it 📈'], default: ['Unexpected. Appreciated.'] },
      Tammy: { CORN: ['Corn... the grain that remembers 🌽'], GOLDEN_WHEAT: ['Golden wheat. The soil truly trusts you 🌟'], default: ['A gift freely given. The land notices 🌙'] },
    };
    const npcResponses = responses[npcName] || { default: ['Thank you!'] };
    const pool = npcResponses[item] || npcResponses.default;
    const response = pool[Math.floor(Math.random() * pool.length)];

    res.json({ heartsGained, newHearts, newTier, tierUp: newTier > prevTier, response, perkUnlocked: newTier > prevTier ? `Tier ${newTier} perk` : null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET RELATIONSHIPS ─────────────────────────────────────────────────────────
app.get('/api/relationships/:playerId', async (req, res) => {
  try {
    const rels = await db.nPCRelationship.findMany({ where: { playerId: req.params.playerId } });
    const result = ['Deb','Todd','Tammy'].map(name => {
      const rel = rels.find(r => r.npcName === name);
      const hearts = rel?.hearts || 0;
      return { npcName: name, hearts, tier: Math.floor(hearts/3), lastGiftAt: rel?.lastGiftAt, totalGifts: rel?.totalGifts || 0, favourites: NPC_GIFTS[name].likes, lovedGift: NPC_GIFTS[name].loved };
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── CLAIM QUEST REWARD ────────────────────────────────────────────────────────
app.post('/api/player/quest/claim', async (req, res) => {
  // Quest rewards are handled client-side for now, just award gold/lumi
  const { playerId, reward } = req.body;
  try {
    if (reward) {
      await db.player.update({
        where: { id: playerId },
        data: {
          gold: { increment: reward.gold || 0 },
          seeds: { increment: reward.seeds || 0 },
          lumiBalance: { increment: reward.lumi || 0 },
          lumiTotal: { increment: reward.lumi || 0 },
        },
      });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── XP HELPER ─────────────────────────────────────────────────────────────────
async function awardXP(playerId, skill, amount) {
  try {
    const current = await db.playerSkill.upsert({
      where: { playerId_skill: { playerId, skill } },
      create: { playerId, skill, xp: 0, level: 1 },
      update: {},
    });

    const newXP = current.xp + amount;
    const newLevel = Math.min(50, Math.floor(Math.pow(newXP / 1.8, 1/2.8)) + 1);
    const levelUps = [];

    if (newLevel > current.level) {
      for (let l = current.level + 1; l <= newLevel; l++) {
        levelUps.push({ skill, newLevel: l, unlock: null });
      }
    }

    await db.playerSkill.update({ where: { playerId_skill: { playerId, skill } }, data: { xp: newXP, level: newLevel } });
    return levelUps;
  } catch {
    return [];
  }
}

// ── SOCKET.IO ─────────────────────────────────────────────────────────────────
const io = new SocketServer(httpServer, { cors: { origin: '*' } });

const connected = new Map();    // socketId → playerId
const onlinePlayers = new Map(); // playerId → { username, x, y, dir, socketId, room }
const pendingInvites = new Map(); // inviteeId → { farmOwnerId, ownerUsername }

io.on('connection', socket => {
  socket.on('player:join', async data => {
    const { playerId, username, x = 8, y = 14 } = data;

    // Player cap — skip if already connected (reconnect)
    if (!onlinePlayers.has(playerId) && onlinePlayers.size >= MAX_PLAYERS) {
      socket.emit('server:full', { message: `Havenfield is full (${MAX_PLAYERS} players). Try again soon!`, max: MAX_PLAYERS });
      socket.disconnect();
      return;
    }

    connected.set(socket.id, playerId);
    await socket.join('world');
    await socket.join(`player:${playerId}`);

    onlinePlayers.set(playerId, { username, x, y, dir: 2, socketId: socket.id, room: 'world' });

    try { await db.player.update({ where: { id: playerId }, data: { lastSeenAt: new Date() } }); } catch {}

    // Send game state
    socket.emit('game:state', { season: gameState.season, blockMultiplier: gameState.blockMult });

    // Send snapshot of who's in Havenfield
    const others = [...onlinePlayers.entries()]
      .filter(([pid, p]) => pid !== playerId && p.room === 'world')
      .map(([pid, p]) => ({ playerId: pid, username: p.username, x: p.x, y: p.y, dir: p.dir, followingPet: p.followingPet||null }));
    socket.emit('world:online_players', others);

    // Send any pending invite
    if (pendingInvites.has(playerId)) socket.emit('farm:invite_received', pendingInvites.get(playerId));

    // Announce to world
    socket.to('world').emit('world:player_joined', { playerId, username, x, y, dir: 2, followingPet: null });
    console.log(`[Socket] ${username} joined. Online: ${onlinePlayers.size}`);
  });

  socket.on('farm:enter', async data => {
    const playerId = connected.get(socket.id);
    if (!playerId) return;
    const player = onlinePlayers.get(playerId);
    if (!player) return;

    const isOwner = playerId === data.farmOwnerId;
    if (!isOwner) {
      const invite = pendingInvites.get(playerId);
      if (!invite || invite.farmOwnerId !== data.farmOwnerId) { socket.emit('error', { message: 'No invite' }); return; }
      pendingInvites.delete(playerId);
    }

    const room = `farm:${data.farmOwnerId}`;
    await socket.leave('world');
    await socket.join(room);
    player.room = room;

    io.to('world').emit('world:player_left', { playerId });

    try {
      const plots = await db.plot.findMany({ where: { playerId: data.farmOwnerId }, orderBy: [{ row: 'asc' }, { col: 'asc' }] });
      const owner = await db.player.findUnique({ where: { id: data.farmOwnerId }, select: { farmAnimals: true, activePets: true } });
      socket.emit('farm:state', {
        farmOwnerId: data.farmOwnerId, isOwner, plots,
        farmAnimals: owner?.farmAnimals || [],
        activePets:  owner?.activePets  || [],
      });
      socket.to(room).emit('farm:player_joined', { playerId, username: player.username, isOwner });
      if (!isOwner) io.to(`player:${data.farmOwnerId}`).emit('farm:guest_arrived', { guestId: playerId, guestUsername: player.username });
    } catch(err) {
      console.error('[farm:enter]', err.message);
      // Still send farm:state so client doesn't hang — empty plots
      socket.emit('farm:state', { farmOwnerId: data.farmOwnerId, isOwner, plots: [], farmAnimals: [], activePets: [] });
    }
  });

  socket.on('farm:leave', async () => {
    const playerId = connected.get(socket.id);
    if (!playerId) return;
    const player = onlinePlayers.get(playerId);
    if (!player || player.room === 'world') return;

    socket.to(player.room).emit('farm:player_left', { playerId });
    await socket.leave(player.room);
    await socket.join('world');
    player.room = 'world'; player.x = 8; player.y = 14;

    socket.to('world').emit('world:player_joined', { playerId, username: player.username, x: 8, y: 14, dir: 2 });
    const others = [...onlinePlayers.entries()]
      .filter(([pid, p]) => pid !== playerId && p.room === 'world')
      .map(([pid, p]) => ({ playerId: pid, username: p.username, x: p.x, y: p.y, dir: p.dir, followingPet: p.followingPet||null }));
    socket.emit('world:online_players', others);
  });

  socket.on('farm:invite', data => {
    const playerId = connected.get(socket.id);
    if (!playerId) return;
    const owner = onlinePlayers.get(playerId);
    const invitee = [...onlinePlayers.entries()].find(([, p]) => p.username.toLowerCase() === data.inviteeUsername?.toLowerCase());
    if (!invitee) { socket.emit('error', { message: `${data.inviteeUsername} is not online` }); return; }
    const [inviteeId, inviteePlayer] = invitee;
    pendingInvites.set(inviteeId, { farmOwnerId: playerId, ownerUsername: owner.username });
    io.to(`player:${inviteeId}`).emit('farm:invite_received', { farmOwnerId: playerId, ownerUsername: owner.username });
    socket.emit('farm:invite_sent', { to: inviteePlayer.username });
  });

  socket.on('farm:invite_decline', () => {
    const playerId = connected.get(socket.id);
    if (!playerId) return;
    const invite = pendingInvites.get(playerId);
    if (!invite) return;
    pendingInvites.delete(playerId);
    io.to(`player:${invite.farmOwnerId}`).emit('farm:invite_declined', { by: onlinePlayers.get(playerId)?.username });
  });

  socket.on('player:move', data => {
    const playerId = connected.get(socket.id);
    if (!playerId) return;
    const player = onlinePlayers.get(playerId);
    if (player) { player.x = data.x; player.y = data.y; player.dir = data.dir; player.followingPet = data.followingPet||null; }
    socket.to(player?.room || 'world').emit('player:moved', { playerId, username: player?.username, x: data.x, y: data.y, dir: data.dir, followingPet: data.followingPet||null });
  });

  socket.on('chat:message', async data => {
    const playerId = connected.get(socket.id);
    if (!playerId || !data.content) return;
    const player = onlinePlayers.get(playerId);
    if (!player) return;
    socket.to(player.room).emit('chat:message', { playerId, username: player.username, content: data.content });
  });

  socket.on('player:emote', data => {
    const playerId = connected.get(socket.id);
    if (!playerId) return;
    const player = onlinePlayers.get(playerId);
    socket.to(player?.room || 'world').emit('player:emote', { playerId, emote: data.emote });
  });


  // ── TRADE SYSTEM ──────────────────────────────────────────────────────────
  socket.on('trade:propose', async data => {
    const fromId = connected.get(socket.id);
    if (!fromId) return;
    const from = onlinePlayers.get(fromId);
    if (!from) return;

    const { toPlayerId, gold = 0, items = {} } = data;

    // Validate sender has the gold
    try {
      const sender = await db.player.findUnique({ where: { id: fromId } });
      if (!sender || sender.gold < gold) {
        socket.emit('error', { message: 'Not enough gold for that trade' });
        return;
      }
    } catch { return; }

    // Generate trade ID and store pending trade
    const tradeId = `trade_${fromId}_${Date.now()}`;
    pendingTrades.set(tradeId, {
      fromId, fromUsername: from.username,
      toId: toPlayerId,
      gold, items,
      createdAt: Date.now(),
    });

    // Notify recipient
    io.to(`player:${toPlayerId}`).emit('trade:incoming', {
      id: tradeId,
      fromId,
      fromUsername: from.username,
      gold, items,
    });

    socket.emit('trade:proposed', { tradeId, to: toPlayerId });
  });

  socket.on('trade:accept', async data => {
    const acceptorId = connected.get(socket.id);
    if (!acceptorId) return;

    const trade = pendingTrades.get(data.tradeId);
    if (!trade || trade.toId !== acceptorId) {
      socket.emit('error', { message: 'Trade not found or expired' });
      return;
    }

    pendingTrades.delete(data.tradeId);

    // Apply the gift to acceptor
    try {
      const updates = {};
      if (trade.gold > 0) {
        const sender = await db.player.findUnique({ where: { id: trade.fromId } });
        if (!sender || sender.gold < trade.gold) {
          socket.emit('error', { message: 'Sender no longer has enough gold' });
          return;
        }
        // Deduct from sender
        await db.player.update({
          where: { id: trade.fromId },
          data: { gold: { decrement: trade.gold } },
        });
        // Add to acceptor
        await db.player.update({
          where: { id: acceptorId },
          data: { gold: { increment: trade.gold } },
        });
      }

      // Notify both parties
      io.to(`player:${acceptorId}`).emit('trade:accepted', {
        gold: trade.gold,
        items: trade.items,
        fromUsername: trade.fromUsername,
      });
      io.to(`player:${trade.fromId}`).emit('trade:accepted', {
        gold: 0,
        items: {},
        fromUsername: onlinePlayers.get(acceptorId)?.username || 'Player',
        message: 'Trade accepted!',
      });

      console.log(`[Trade] ${trade.fromUsername} → ${onlinePlayers.get(acceptorId)?.username}: ${trade.gold}g, items:${JSON.stringify(trade.items)}`);
    } catch (err) {
      console.error('[Trade]', err.message);
      socket.emit('error', { message: 'Trade failed: ' + err.message });
    }
  });

  socket.on('trade:decline', data => {
    const declinerId = connected.get(socket.id);
    if (!declinerId) return;

    const trade = pendingTrades.get(data.tradeId);
    if (!trade) return;
    pendingTrades.delete(data.tradeId);

    const decliner = onlinePlayers.get(declinerId);
    io.to(`player:${trade.fromId}`).emit('trade:declined', {
      username: decliner?.username || 'Player',
    });
  });

  socket.on('trade:gift', async data => {
    const fromId = connected.get(socket.id);
    if (!fromId) return;
    const from = onlinePlayers.get(fromId);
    if (!from) return;

    const { toPlayerId, gold = 0, items = {} } = data;

    try {
      // Deduct gold from sender if any
      if (gold > 0) {
        const sender = await db.player.findUnique({ where: { id: fromId } });
        if (!sender || sender.gold < gold) {
          socket.emit('error', { message: 'Not enough gold' });
          return;
        }
        await db.player.update({ where: { id: fromId }, data: { gold: { decrement: gold } } });
        await db.player.update({ where: { id: toPlayerId }, data: { gold: { increment: gold } } });
      }

      // Notify recipient
      io.to(`player:${toPlayerId}`).emit('trade:gift:received', {
        fromUsername: from.username,
        gold, items,
      });

      console.log(`[Gift] ${from.username} → ${toPlayerId}: ${gold}g, items:${JSON.stringify(items)}`);
    } catch (err) {
      console.error('[Gift]', err.message);
      socket.emit('error', { message: 'Gift failed: ' + err.message });
    }
  });

  socket.on('disconnect', () => {
    const playerId = connected.get(socket.id);
    if (playerId) {
      const player = onlinePlayers.get(playerId);
      connected.delete(socket.id);
      onlinePlayers.delete(playerId);
      pendingInvites.delete(playerId);
      // Clean up any pending trades involving this player
      for (const [id, trade] of pendingTrades.entries()) {
        if (trade.fromId === playerId || trade.toId === playerId) pendingTrades.delete(id);
      }
      io.to(player?.room || 'world').emit('world:player_left', { playerId });
      console.log(`[Socket] ${player?.username} disconnected. Online: ${onlinePlayers.size}`);
    }
  });
});

// ── GAME LOOP ─────────────────────────────────────────────────────────────────
const PULSE_MS = 10 * 60 * 1000;
const PULSES_PER_SEASON = 144;

async function feePulse() {
  const vol = 800 + Math.random() * 5500;
  const bm = Math.min(4.5, parseFloat((1 + vol / 55).toFixed(2)));
  gameState.totalVol += vol;
  gameState.blockMult = bm;
  gameState.pulses++;
  gameState.seasonPulse++;

  const lumiMinted = vol * 0.00003;

  // Drift market prices
  const items = { WHEAT:2, CARROT:5, CORN:8, bread:18, stew:28, wrap:22, ale:38 };
  for (const [item, base] of Object.entries(items)) {
    const price = Math.max(base * 0.7, base * (1 + (Math.random() - 0.45) * 0.35));
    await db.marketPrice.upsert({ where: { item }, create: { item, price }, update: { price } }).catch(() => {});
  }

  // Season change
  if (gameState.seasonPulse >= PULSES_PER_SEASON) {
    gameState.seasonPulse = 0;
    const idx = (SEASONS.indexOf(gameState.season) + 1) % SEASONS.length;
    gameState.season = SEASONS[idx];
    const s = SEASON_EFFECTS[gameState.season];
    io.emit('season:changed', { season: gameState.season, icon: s.icon, label: s.label, yieldMultiplier: s.ym });
    console.log(`[GameLoop] Season: ${gameState.season}`);
  }

  io.emit('game:fee_pulse', {
    volume: Math.round(vol), blockMultiplier: bm, lumiMinted,
    season: gameState.season, pulsesUntilSeasonChange: PULSES_PER_SEASON - gameState.seasonPulse,
  });

  io.emit('market:prices', { prices: Object.fromEntries((await db.marketPrice.findMany()).map(p => [p.item, p.price])), blockMultiplier: bm });
}

setInterval(feePulse, PULSE_MS);

// Daily quest reset at midnight UTC
function scheduleDailyReset() {
  const now = new Date();
  const midnight = new Date(now); midnight.setUTCHours(24, 0, 0, 0);
  setTimeout(() => {
    io.emit('quests:daily_reset', { message: '🌅 Daily quests refreshed!' });
    setInterval(() => io.emit('quests:daily_reset', { message: '🌅 Daily quests refreshed!' }), 24 * 60 * 60 * 1000);
  }, midnight - now);
}
scheduleDailyReset();

// ── START ─────────────────────────────────────────────────────────────────────
await db.$connect();
console.log('[DB] Connected');

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[Server] Running on port ${PORT}`);
});

process.on('SIGTERM', async () => { await db.$disconnect(); process.exit(0); });
process.on('SIGINT',  async () => { await db.$disconnect(); process.exit(0); });
