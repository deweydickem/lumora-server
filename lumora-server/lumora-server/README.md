# Lumora Server

Authoritative game backend for Lumora — the cozy farming game with real onchain yield.

## Stack

- **Runtime**: Node.js 20 + TypeScript
- **HTTP**: Fastify
- **WebSocket**: Socket.io
- **Database**: PostgreSQL via Prisma ORM
- **Cache**: Redis (Upstash in production)
- **Auth**: Privy (embedded wallets, no seed phrases)
- **AI NPCs**: Anthropic Claude API (server-side key)
- **Deploy**: Railway (server) + Supabase (Postgres) + Vercel (client)

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Set up environment
cp .env.example .env
# Fill in DATABASE_URL, REDIS_URL, ANTHROPIC_API_KEY

# 3. Push database schema
npm run db:push

# 4. Run in development
npm run dev

# 5. Run tests
npm test
```

## Architecture

### How crop persistence works

Crops don't "run" on the server between player sessions. They're timestamps:

```
plantedAt: 2024-01-15T22:00:00Z
readyAt:   2024-01-16T06:00:00Z  ← plantedAt + growMs
```

When a player loads their farm, the server calculates:
```
progress = (now - plantedAt) / (readyAt - plantedAt)
```

If `progress >= 1`, the crop is ready. Zero compute between sessions.

### Crop timing (real-world)

| Crop   | Grow time | Design intent                          |
|--------|-----------|----------------------------------------|
| Wheat  | 2 hours   | Plant before a short break, harvest on return |
| Carrot | 8 hours   | Plant before work, harvest after       |
| Corn   | 24 hours  | Plant today, harvest tomorrow          |

To change timings, edit `src/game/constants.ts` — one place, everything updates.

### The game loop

The `GameLoop` class runs scheduled server-side events:

- **Fee pulse** every 10 minutes — simulates DEX volume, emits $LUMI to players, drifts market prices
- **Season change** every 144 pulses (24 hours) — Summer → Autumn → Winter → Spring
- **Daily quest reset** at midnight UTC

These events broadcast via Socket.io to all connected clients in real time.

### Key files

```
src/game/constants.ts     ← All timings, prices, XP curves. Edit here.
src/game/PlotManager.ts   ← Crop state: till, plant, water, harvest
src/game/SkillEngine.ts   ← XP tracking, level-ups, skill bonuses
src/game/QuestEngine.ts   ← Quest progress, daily resets, rewards
src/game/GameLoop.ts      ← Scheduled events: pulses, seasons, resets
src/api/farm.ts           ← HTTP routes for farm actions
src/api/market.ts         ← Sell, convert, withdraw
src/ws/socketHandlers.ts  ← Real-time: chat, player positions, trades
```

## Deployment (Railway)

```bash
# Set environment variables in Railway dashboard, then:
railway up
```

Railway automatically:
- Runs `npm run build` → `npm start`
- Keeps the server alive 24/7
- Restarts on crash
- Scales on demand

Monthly cost at 500 players: ~$20-30.

## Database (Supabase)

1. Create project at supabase.com
2. Copy connection string to `DATABASE_URL` in `.env`
3. Run `npm run db:push` to create tables

## Adding a new crop

1. Add to `CROP_CONFIG` in `constants.ts`
2. Add to `CropType` enum in `prisma/schema.prisma`
3. Run `npm run db:push`
4. Done — all other systems pick it up automatically

## Adding a new quest

Add to `DAILY_QUESTS`, `STORY_QUESTS`, or `ACHIEVEMENTS` in `QuestEngine.ts`.
No database migration needed — quests are code-defined.
