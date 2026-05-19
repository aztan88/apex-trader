# Apex Trader v2 — AI Paper Trading Platform

Real market data via Yahoo Finance · AI analysis via Claude · Paper trading with $50,000 virtual cash

---

## What was improved (v2)

**28 bugs and improvements from code review:**

- Fixed ASX ticker lookup (BHP.AX price now resolves correctly)
- Fixed portfolio chart (now actually renders)
- Fixed autopilot (now actually makes AI-driven trade decisions)
- Fixed race condition in stop-loss execution
- Fixed daily P&L tracking (shown separately from all-time P&L)
- Added position sizer (calculate optimal position size as % of portfolio)
- Added skeleton loading cards while screener fetches
- Added portfolio performance chart
- Added proper P&L colour coding on portfolio page
- Added history filter (All / Buy / Sell / Auto)
- Added buy button from Watchlist
- Added mobile hamburger menu
- Added error boundary (app no longer crashes on JS errors)
- Added trade confirmation banner in order modal
- Added ⌘K keyboard shortcut for search
- Properly formed coach context string
- Parallel signal fetching (screener ~70% faster)
- Toast duration proportional to message length
- Input sanitisation on all API endpoints

---

## Deploy to Vercel

### 1. Push to GitHub

```bash
cd apex-trader-v2
git init && git add . && git commit -m "Apex Trader v2"
gh repo create apex-trader --public --push
```

### 2. Deploy

1. [vercel.com](https://vercel.com) → New Project → import repo
2. Framework: **Next.js** (auto-detected)
3. Click Deploy

### 3. Add Environment Variables

Vercel dashboard → Project → Settings → Environment Variables:

| Variable | Required | Get from |
|---|---|---|
| `ANTHROPIC_API_KEY` | **Yes** | [console.anthropic.com](https://console.anthropic.com) |
| `ALPHA_VANTAGE_KEY` | Optional | [alphavantage.co](https://www.alphavantage.co/support/#api-key) — free 25 req/day |
| `FINNHUB_KEY` | Optional | [finnhub.io](https://finnhub.io/register) — free 60 req/min |

### 4. Redeploy after adding env vars

---

## Can I use this to actually buy real stocks?

**No — not directly.** This is a paper trading simulator. All trades are virtual.

To place real trades, you need to connect to a brokerage API. Here are the options:

### Option A: Interactive Brokers (recommended for Australia)
- IBKR has a full REST API and Python/Node libraries
- ASIC-regulated, supports ASX + US + global markets
- Minimum account: $0 (no minimum)
- API docs: [interactivebrokers.github.io](https://interactivebrokers.github.io)
- Cost: ~USD 0.0035/share for US stocks, ~0.08% for ASX

To connect: add an `/api/trade` route that calls the IBKR REST API with your account credentials and order details.

### Option B: Alpaca (US stocks only)
- Free commission trading, excellent API, paper trading built-in
- US stocks and ETFs only (not ASX)
- API docs: [docs.alpaca.markets](https://docs.alpaca.markets)
- Add `ALPACA_KEY` and `ALPACA_SECRET` to your Vercel env vars

### Option C: Coinbase Advanced API (crypto)
- For BTC, ETH, SOL etc.
- API docs: [docs.cdp.coinbase.com](https://docs.cdp.coinbase.com)

### What needs to change in the code
1. Add your broker's API credentials to `.env.local`
2. Create `/api/trade/route.ts` that forwards buy/sell orders to your broker
3. In `store.ts`, update the `buy()` and `sell()` functions to call `/api/trade` after updating local state
4. Add order status tracking (pending → filled → cancelled)

**Important:** Before connecting real money, paper trade for at least 3-6 months to validate your strategy returns are consistent and your stop-loss rules work correctly.

---

## Local development

```bash
npm install
# create .env.local with your keys (see .env.example)
npm run dev
```

---

## Architecture

```
Browser
  │
  ├── /api/prices  → Yahoo Finance + Alpha Vantage + Finnhub (parallel)
  ├── /api/signals → Claude (pipe-delimited, 1hr cache)
  ├── /api/analysis → Claude (full analysis, 24hr cache)
  ├── /api/screener → Curated ticker lists per theme
  └── /api/coach  → Claude (portfolio coaching with context)
```

---

## Approximate running costs

| Action | Claude tokens | Cost (USD) |
|---|---|---|
| Screener run (8 stocks, parallel) | ~1,600 | ~$0.005 |
| Full stock analysis | ~600 | ~$0.002 |
| Coach question | ~800 | ~$0.002 |
| Autopilot cycle | ~200 | ~$0.001 |

Signals cached 1 hour · Analysis cached 24 hours · Repeat runs ≈ free
