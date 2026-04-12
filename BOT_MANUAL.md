# BOT_MANUAL.md

A walkthrough of how the Polymarket bot works: what it hunts for, how it executes, where the edge comes from, and the edge cases it has to navigate.

---

## 1. The Thesis (Why This Bot Exists)

The bot is a **whale-follower** for pre-game sports markets on Polymarket. The core bet is that when sophisticated bettors place large **conviction trades** before a game starts, those bets carry real information (injuries, lineups, models, sharp insight) that the public market hasn't fully priced in yet. By detecting consensus among whales and executing a small order right as the game kicks off, the bot aims to ride the informational edge before odds converge.

It is **not** an arbitrage bot. It is **not** latency-driven in the HFT sense. It is a **signal bot** that surfaces and rides smart money.

---

## 2. High-Level Architecture

Two Python processes run independently and communicate through a shared PostgreSQL database. A Next.js dashboard reads the same DB for visualization.

```
┌──────────────────┐      ┌──────────────────┐      ┌──────────────────┐
│   Gamma API      │────▶│   Watcher        │────▶│                  │
│  (events meta)   │      │  (WebSocket)     │      │                  │
└──────────────────┘      └──────────────────┘      │   PostgreSQL     │
                                    │                │  events          │
                                    ▼                │  whale_activity  │
                          ┌──────────────────┐      │  trades          │
                          │   Notifier       │      │                  │
                          │  (Telegram)      │      └──────────────────┘
                          └──────────────────┘               ▲   ▲
                                                             │   │
                          ┌──────────────────┐              │   │
                          │   Trader         │──────────────┘   │
                          │  (5-min loop)    │                  │
                          │  CLOB orders     │                  │
                          └──────────────────┘                  │
                                                                │
                          ┌──────────────────┐                 │
                          │   Dashboard      │─────────────────┘
                          │  (Next.js UI)    │
                          └──────────────────┘
```

**Two separate processes:**

- **Watcher** ([bot/main.py](bot/main.py) → [bot/watcher.py](bot/watcher.py)): Long-lived WebSocket consumer. Fetches qualifying events from Gamma API, subscribes to CLOB market trades, filters incoming trades, writes whale activity to DB, sends Telegram alerts.
- **Trader** ([bot/trader.py](bot/trader.py)): Polling loop that runs every 5 minutes. Queries the DB for events with whale consensus, checks balance, places market orders through `py-clob-client`, records results.

The separation is intentional: the watcher can run hot on real-time data without being blocked by slow CLOB REST calls, and the trader can be restarted independently without losing the signal stream.

---

## 3. What the Bot Is Looking For

### 3.1 Event Qualification (performed by the Watcher at startup and on refresh)

Not every Polymarket sports event is tracked. An event must pass **all** of:

| Filter | Value | Location |
|---|---|---|
| Total market volume ≥ | `MIN_EVENT_VOLUME` (default **$100k**) | [bot/config.py:10](bot/config.py#L10) |
| Sport not in exclusion list | excludes esports, cricket/IPL, UFC/MMA, boxing, NASCAR, PGA | [bot/gamma_api.py](bot/gamma_api.py) |
| Market type | moneyline only — no spreads, totals, over/unders, `.5` handicaps | [bot/gamma_api.py](bot/gamma_api.py) |
| Timing | game start time in the future | [bot/gamma_api.py](bot/gamma_api.py) |

Qualifying events are expanded into a **token lookup table** (`token_id → event, market, outcome, sport, start_time`) so incoming WebSocket trades can be enriched in O(1).

### 3.2 Whale Trade Detection (Watcher, live)

For each trade message arriving over `wss://ws-subscriptions-clob.polymarket.com/ws/market`:

1. **Must be BUY side** — sells are discarded ([bot/watcher.py:87](bot/watcher.py#L87)).
2. **Value ≥ `MIN_TRADE_VALUE`** (default **$5,000**, computed as `price × size`).
3. **Pre-match only** — trades at or after `game_start_time` are ignored ([bot/watcher.py:114-117](bot/watcher.py#L114-L117)). Post-kickoff activity is noise for this thesis.
4. **Token must be in the lookup table** — otherwise it's for an event we don't track.

Qualifying trades are written to `whale_activity`. Trades ≥ `MIN_NOTIFY_VALUE` (default **$25k**) fire a Telegram alert, with emoji severity (🐳 $250k+, 🦈 $100k+, 🦀 below).

### 3.3 Consensus Formation (Trader, every 5 min)

This is the core signal. For each unsettled active event, the trader:

1. Groups all `whale_activity` rows by outcome.
2. Picks the outcome with the **highest total whale BUY volume** as the consensus.
3. Requires that outcome to have **at least one single trade ≥ `CONVICTION_THRESHOLD`** (hardcoded **$50k** at [bot/trader.py:42](bot/trader.py#L42)).
4. Orders candidates by total whale volume descending — biggest conviction plays first.

Only events passing all three tests become trade candidates. This means:
- Split whale money (no clear consensus) → no trade.
- Lots of small $5–10k flurries on one side but no single $50k bet → no trade. The $50k floor is the "someone actually believes this" filter.
- One huge $200k bet on one side and the rest of the whales on the other → the side with higher *total* wins, even if it lacks the single biggest bet. Volume beats magnitude.

---

## 4. Trade Execution Flow

End to end, from a whale's click to the bot's filled order:

```
Whale places $60k BUY on "Lakers ML"
       │
       ▼
CLOB WebSocket emits last_trade_price
       │
       ▼
Watcher validates (BUY ✓, $60k ≥ $5k ✓, pre-match ✓)
       │
       ▼
whale_activity row written
Telegram alert fired ($60k ≥ $25k)
       │
       ▼  (up to 5 min later)
Trader wakes up, queries consensus candidates
       │
       ▼
SELECT events where: active, unsettled, has ≥1 whale trade ≥ $50k,
                     sport NOT IN blocked_sports
ORDER BY total whale volume on consensus outcome DESC
       │
       ▼
For each candidate, run pre-trade guards:
  - Already traded this event? ──────────▶ skip
  - Event resolved/closed/finished? ─────▶ skip
  - Game hasn't started yet? ────────────▶ skip (wait for tip-off)
  - Outcome token exists & has price? ───▶ skip if not
  - USDC balance ≥ TRADE_AMOUNT? ────────▶ skip if not
       │
       ▼
Build & sign market BUY order via py-clob-client
  amount = TRADE_AMOUNT ($10 default)
  order_type = FOK (Fill-or-Kill)
       │
       ▼
POST to CLOB
       │
       ▼
Validate response status ∈ {matched, filled, delayed, mev}
       │
       ▼
Write trades row + send Telegram trade alert
```

**Important timing detail:** The trader deliberately **waits until the game has started** before placing the order ([bot/trader.py:155-157](bot/trader.py#L155-L157)). The thesis is that whale positioning is complete pre-game, but the best entry is right at tip-off when the market starts moving based on early-game action and the odds haven't fully repriced the pre-game smart money yet.

**Order sizing is fixed at `TRADE_AMOUNT` (default $10).** This is deliberately small — the bot is testing the signal, not scaling into positions. FOK means the order either fills fully at the current best ask or is rejected, so partial fills can't sneak the bot into unwanted exposure.

**One trade per event max.** `has_trade_for_event` guard at [bot/trader.py:354](bot/trader.py#L354) prevents the 5-minute loop from re-firing on the same candidate.

---

## 5. Filters and Exclusions

### 5.1 Sport-level exclusions

**Excluded from subscription entirely** (never even watched) — [bot/gamma_api.py](bot/gamma_api.py):
- esports: Counter-Strike 2, League of Legends, Dota 2
- cricket / IPL
- UFC, MMA, boxing
- NASCAR, PGA

**Watched but blocked from trading** — `BLOCKED_SPORTS` env var (default: `Soccer`):
- Soccer whale activity is still recorded (useful for signal analysis in the dashboard) but the trader skips any soccer event. This is the result of the commit history showing soccer markets being error-prone — see §7.

### 5.2 Market-type exclusions

Only **moneyline** markets pass. The bot explicitly filters out:
- Spreads, totals, handicaps, over/unders
- Anything with `.5` in the market name (shorthand for decimal lines)
- Keywords: `spread`, `total`, `handicap`, `over`, `under`, `more than`, `less than`

Rationale: moneyline is binary and cleanly reflects "who wins." Spreads and totals introduce a second dimension (margin, points) where whale consensus is harder to interpret and often split across closely-priced variants.

### 5.3 Timing exclusions

| Where | Check | Effect |
|---|---|---|
| Watcher | trade timestamp ≥ game start → discard | Only pre-game whale activity is recorded |
| Trader | event in `resolved/closed/finished` → skip | Don't trade settled markets |
| Trader | game hasn't started (`starts_in > 0`) → skip | Wait for tip-off before entering |

### 5.4 Volume floor

`MIN_EVENT_VOLUME = $100k` at event qualification and `MIN_TRADE_VALUE = $5k` at trade filtering. Everything below is considered too thin to produce reliable signal or reliable fills.

---

## 6. The Edge (Where the Money Comes From)

The bot is making four compounding bets, each of which has to be roughly correct for the strategy to be profitable:

1. **Pre-game whale bets are informed.** Someone putting $50k+ on a moneyline before kickoff is not doing it for fun. They likely have a model, an angle, or private information. This is the foundational assumption.
2. **Consensus is more predictive than any single bet.** By requiring the winning outcome to be the *highest total volume* side (not just the side with the biggest single bet), the bot filters out one-off whale mistakes and captures coordinated smart money.
3. **The market doesn't fully reprice pre-game whale flow.** If the CLOB fully and instantly absorbed every whale bet into the mid price, following whales would have zero edge. The bot assumes there's residual mispricing at kickoff.
4. **Executing at tip-off captures the repricing.** Entry timing matters. Too early and you pay the same price the whale did; too late and the game's early minutes have already moved the line past your edge. The bot targets that specific window: game has started, but the market is still digesting.

**What the edge is NOT:**
- Not arbitrage (no two-legged risk-free trade).
- Not HFT latency (5-minute polling loop is not competing with co-located market makers).
- Not sentiment analysis (no news/social parsing).
- Not modeling the game itself (no ELO, no team stats). The bot outsources the game-level analysis to whoever placed the whale bet.

This means the edge lives or dies by **whale selection accuracy**. If Polymarket whales are net losing over time, this bot loses with them. The bot's value-add is identification and execution discipline, not prediction.

---

## 7. Edge Cases and Known Issues

These are the traps that have actually bitten the project (visible in git history) and the current defenses against them:

### 7.1 Soccer outcome ambiguity (fixed)

**Problem:** Soccer events frequently split into multiple separate Yes/No markets (e.g., "Will Team A win?" / "Will Team B win?" / "Draw?") with identical outcome labels like "Yes" across markets. Looking up a trade by outcome label alone routed the bot to the wrong token.

**Fix:** Store `token_id` directly on `whale_activity` rows and prefer it as the override in `get_token_id_for_outcome` at [bot/trader.py:363](bot/trader.py#L363). Soccer is also in the default `BLOCKED_SPORTS` list as a belt-and-suspenders precaution.

### 7.2 Ghost events in the WebSocket stream (fixed, still being verified)

**Problem:** When an event closed or settled on Polymarket, the CLOB WebSocket would sometimes keep streaming stale trades for it. The bot's subscription was not refreshed, so closed events acted like zombies — trades arrived but had no place in the current lookup table.

**Fix:** On each event-set refresh, if the set of qualifying events changed, force a full WebSocket reconnect (close the socket and let the reconnect loop re-subscribe with the fresh list). See [bot/watcher.py:248-250](bot/watcher.py#L248-L250) and the "MAJOR FIX: KILL GHOST EVENTS" commit (14a384a).

**Status:** There's still an open investigation into whether a subtler variant of this bug exists (see memory: `project_ghost_subscription_bug.md`). Logging is in place; a more aggressive force-reconnect is prepared but not yet deployed.

### 7.3 Duplicate event IDs after restart (fixed)

**Problem:** Polymarket's API sometimes returned different IDs for the same underlying event after a bot restart, leading to duplicate `events` rows for the same game.

**Fix:** Upsert by title — check for existing events by title first and reuse the existing ID if found ([bot/database.py:99-104](bot/database.py#L99-L104)).

### 7.4 Over/under markets leaking through (fixed)

**Problem:** Some totals/over-under markets slipped past the market-type filter because they didn't use obvious keywords.

**Fix:** Added `.5` decimal detection to the filter in [bot/gamma_api.py](bot/gamma_api.py).

### 7.5 Night-time API thrashing (fixed)

**Problem:** Refreshing the event list every 600s overnight (when almost no new events are created) wasted Gamma API calls and risked rate limits.

**Fix:** Split into day/night intervals — `REFRESH_INTERVAL=600s` daytime, `REFRESH_INTERVAL_NIGHT=3600s` between 00:00–09:00 Bucharest time ([bot/watcher.py:206-211](bot/watcher.py#L206-L211)).

### 7.6 Non-fixed, inherent edge cases

These aren't bugs — they're limits of the strategy:

- **Late whale bets.** A $100k bet placed 30 seconds before kickoff may not reach the trader in time (since the trader polls every 5 minutes). The signal is logged but the execution window has already closed. **Mitigation:** none currently; accepted tradeoff for the simpler polling architecture.
- **Balance exhaustion.** If USDC balance drops below `TRADE_AMOUNT`, all trades silently skip ([bot/trader.py:267-274](bot/trader.py#L267-L274)). A Telegram alert fires on insufficient balance but there's no auto-top-up.
- **FOK rejection.** If the best ask moves or the book thins out between the time the trader reads the price and posts the order, the FOK fails and the trade is skipped. No fallback to limit order — the bot would rather miss than leave a resting order.
- **Split consensus.** If the top two outcomes have nearly equal whale volume but the top one has no $50k+ bet, the event is skipped. In split cases the bot prefers no action.
- **Regional restrictions.** Polymarket blocks IPs from certain regions. The project has a pending VPS deployment plan (memory: `project_vps_deployment.md`) to move the bot to an EU host to avoid this.
- **Stale database connections / network hiccups.** Errors are logged (`[DB ERROR]`, `[CLOB]`) but there's no automatic recovery beyond the WebSocket reconnect loop. A hard DB failure requires manual restart.

---

## 8. Configuration

All configuration lives in `bot/.env` and is loaded by [bot/config.py](bot/config.py).

### Required

```bash
# Postgres (Railway)
DATABASE_URL=postgresql://...

# Polymarket / CLOB credentials
POLY_PRIVATE_KEY=0x...
POLY_API_KEY=...
POLY_API_SECRET=...
POLY_API_PASSPHRASE=...
POLY_CHAIN_ID=137
POLY_FUNDER=0x...

# Telegram alerts
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
```

### Optional (with defaults)

```bash
# Signal thresholds
MIN_EVENT_VOLUME=100000        # event must have $100k+ total volume
MIN_TRADE_VALUE=5000           # log trades ≥ $5k to DB
MIN_NOTIFY_VALUE=25000         # Telegram alert ≥ $25k

# Loop intervals
PING_INTERVAL=20               # WebSocket keepalive (seconds)
REFRESH_INTERVAL=600           # event re-scan daytime (seconds)
REFRESH_INTERVAL_NIGHT=3600    # event re-scan 00:00–09:00 Bucharest

# Trading
TRADE_AMOUNT=10                # USD per bot order
BLOCKED_SPORTS=Soccer          # comma-separated sports blocked from trading

TELEGRAM_ENABLED=True
```

Note: `CONVICTION_THRESHOLD` ($50k) is currently **hardcoded** at [bot/trader.py:42](bot/trader.py#L42) rather than env-configurable. Changing it requires a code edit.

---

## 9. Database Schema (Quick Reference)

Three tables, all in the same Postgres instance. Full DDL lives in [schema.sql](schema.sql).

**`events`** — one row per tracked event
- `id`, `title`, `sport`, `outcomes[]`, `game_start_time`, `total_volume`, `status`
- `whales_won` (nullable bool) — filled in manually post-settlement for win/loss tracking
- `result_outcome`, `odds` — manual settlement fields used by the dashboard

**`whale_activity`** — one row per qualifying whale trade seen on the feed
- `event_id`, `outcome`, `token_id`, `side`, `price`, `trade_value`, `timestamp_utc`
- `token_id` is critical for the soccer disambiguation fix

**`trades`** — one row per order the bot actually placed
- `event_id`, `outcome`, `token_id`, `price`, `amount_usd`, `order_id`, `status`, `placed_at`

The dashboard reads all three to render market heatmaps, consensus charts, and historical P&L.

---

## 10. Running the Bot

```bash
# Terminal 1 — watcher (long-running)
cd bot
python main.py

# Terminal 2 — trader (polls every 5 min)
cd bot
python trader.py

# Terminal 3 — dashboard (optional)
cd dashboard
npm run dev
```

The two Python processes are independent. Restarting the trader does not interrupt the signal stream; restarting the watcher loses a few seconds of incoming trades but otherwise rebuilds state from the DB and Gamma API.

---

## 11. TL;DR

> The bot watches the CLOB WebSocket for pre-game moneyline BUYs ≥ $5k on $100k+ sports events. It writes them to a `whale_activity` table. Every 5 minutes, a separate trader process scans for events where the highest-volume outcome has at least one whale bet ≥ $50k, verifies the game has started, checks balance, and fires a $10 Fill-or-Kill market buy on the consensus side. Soccer is blocked. The edge comes from following disciplined pre-game whale consensus into a market that hasn't fully repriced by kickoff.
