import { NextRequest, NextResponse } from 'next/server';

const priceCache = new Map<string, { data: StockPrice; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000;

export interface StockPrice {
  ticker: string; name: string; price: number; change1d: number; change52w: number;
  marketCap: string; currency: string; exchange: string; sector: string;
  high52w: number; low52w: number; volume: number; history: number[];
  source: string; error?: string;
}

function fmtCap(n: number): string {
  if (!n || n < 0) return 'N/A';
  if (n >= 1e12) return (n / 1e12).toFixed(1) + 'T';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  return n.toLocaleString();
}

// ── Source 1: Yahoo Finance v8 API (direct fetch, no npm package) ─────────────
async function fetchYahooV8(ticker: string): Promise<StockPrice | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1y`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ApexTrader/1.0)',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return null;
    const meta = result.meta;
    const price = meta.regularMarketPrice ?? meta.previousClose;
    if (!price || price <= 0) return null;
    const closes: number[] = (result.indicators?.quote?.[0]?.close ?? [])
      .filter((c: any) => typeof c === 'number' && c > 0);
    const yearAgo = closes[0] ?? price;
    const change52w = yearAgo > 0 ? ((price - yearAgo) / yearAgo) * 100 : 0;
    return {
      ticker: String(meta.symbol ?? ticker),
      name: String(meta.longName ?? meta.shortName ?? ticker),
      price: Math.round(price * 100) / 100,
      change1d: Math.round(((meta.regularMarketChangePercent ?? 0)) * 100) / 100,
      change52w: Math.round(change52w * 100) / 100,
      marketCap: fmtCap(meta.marketCap ?? 0),
      currency: String(meta.currency ?? 'USD'),
      exchange: String(meta.fullExchangeName ?? meta.exchangeName ?? 'NYSE'),
      sector: 'Equity',
      high52w: meta.fiftyTwoWeekHigh ?? 0,
      low52w: meta.fiftyTwoWeekLow ?? 0,
      volume: meta.regularMarketVolume ?? 0,
      history: closes.slice(-30),
      source: 'Yahoo Finance',
    };
  } catch (e: any) {
    console.warn(`[prices] Yahoo v8 ${ticker}:`, String(e?.message ?? '').slice(0, 80));
    return null;
  }
}

// ── Source 2: Yahoo Finance v7 (fallback endpoint) ────────────────────────────
async function fetchYahooV7(ticker: string): Promise<StockPrice | null> {
  try {
    const url = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(ticker)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ApexTrader/1.0)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const q = data?.quoteResponse?.result?.[0];
    if (!q?.regularMarketPrice) return null;
    return {
      ticker: String(q.symbol ?? ticker),
      name: String(q.longName ?? q.shortName ?? ticker),
      price: Math.round(q.regularMarketPrice * 100) / 100,
      change1d: Math.round((q.regularMarketChangePercent ?? 0) * 100) / 100,
      change52w: Math.round((q.fiftyTwoWeekChangePercent ?? 0) * 100) / 100,
      marketCap: fmtCap(q.marketCap ?? 0),
      currency: String(q.currency ?? 'USD'),
      exchange: String(q.fullExchangeName ?? q.exchange ?? 'NYSE'),
      sector: String(q.sector ?? 'Equity'),
      high52w: q.fiftyTwoWeekHigh ?? 0,
      low52w: q.fiftyTwoWeekLow ?? 0,
      volume: q.regularMarketVolume ?? 0,
      history: [],
      source: 'Yahoo Finance',
    };
  } catch (e: any) {
    console.warn(`[prices] Yahoo v7 ${ticker}:`, String(e?.message ?? '').slice(0, 80));
    return null;
  }
}

// ── Source 3: Twelve Data free tier (800 req/day free) ───────────────────────
async function fetchTwelveData(ticker: string): Promise<StockPrice | null> {
  const key = process.env.TWELVE_DATA_KEY;
  if (!key) return null;
  try {
    const res = await fetch(
      `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(ticker)}&apikey=${key}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const d = await res.json();
    if (d.status === 'error' || !d.close) return null;
    const price = parseFloat(d.close);
    if (!price || price <= 0) return null;
    return {
      ticker: String(d.symbol ?? ticker),
      name: String(d.name ?? ticker),
      price: Math.round(price * 100) / 100,
      change1d: parseFloat(d.percent_change ?? '0'),
      change52w: parseFloat(d.fifty_two_week?.change_percentage ?? '0'),
      marketCap: 'N/A',
      currency: String(d.currency ?? 'USD'),
      exchange: String(d.exchange ?? 'NYSE'),
      sector: 'Equity',
      high52w: parseFloat(d.fifty_two_week?.high ?? '0'),
      low52w: parseFloat(d.fifty_two_week?.low ?? '0'),
      volume: parseInt(d.volume ?? '0'),
      history: [],
      source: 'Twelve Data',
    };
  } catch { return null; }
}

// ── Source 4: Alpha Vantage ───────────────────────────────────────────────────
async function fetchAlphaVantage(ticker: string): Promise<StockPrice | null> {
  const key = process.env.ALPHA_VANTAGE_KEY;
  if (!key || key === 'demo') return null;
  try {
    const res = await fetch(
      `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(ticker)}&apikey=${key}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const q = data['Global Quote'];
    if (!q?.['05. price']) return null;
    const price = parseFloat(q['05. price']);
    if (!price || price <= 0) return null;
    return {
      ticker, name: ticker, price,
      change1d: parseFloat((q['10. change percent'] ?? '0%').replace('%', '')) || 0,
      change52w: 0, marketCap: 'N/A', currency: 'USD', exchange: 'NYSE', sector: 'Equity',
      high52w: parseFloat(q['03. high'] ?? '0'),
      low52w: parseFloat(q['04. low'] ?? '0'),
      volume: parseInt(q['06. volume'] ?? '0'),
      history: [], source: 'Alpha Vantage',
    };
  } catch { return null; }
}

// ── Master fetcher — tries all sources in order ───────────────────────────────
async function getPrice(ticker: string): Promise<StockPrice> {
  const t = ticker.toUpperCase().trim();
  const cached = priceCache.get(t);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  // Try all sources in parallel for speed, use first success
  const [v8, v7] = await Promise.all([
    fetchYahooV8(t),
    fetchYahooV7(t),
  ]);

  let result = v8 ?? v7;

  // Fallback to paid sources if Yahoo fails
  if (!result || result.price <= 0) {
    result = await fetchTwelveData(t) ?? await fetchAlphaVantage(t);
  }

  if (result && result.price > 0) {
    priceCache.set(t, { data: result, ts: Date.now() });
    return result;
  }

  return {
    ticker: t, name: t, price: 0, change1d: 0, change52w: 0,
    marketCap: 'N/A', currency: 'USD', exchange: 'N/A', sector: 'Equity',
    high52w: 0, low52w: 0, volume: 0, history: [],
    source: 'unavailable', error: `No price data available for ${t}`,
  };
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('tickers') ?? '';
  const tickers = raw.split(',').map(t => t.trim().toUpperCase()).filter(Boolean).slice(0, 20);
  if (!tickers.length) return NextResponse.json({ error: 'No tickers provided' }, { status: 400 });

  const results = await Promise.all(tickers.map(getPrice));
  const map: Record<string, StockPrice> = {};
  results.forEach(r => {
    map[r.ticker] = r;
    // Index without exchange suffix for easier lookup
    const clean = r.ticker.replace('.AX', '').replace('-USD', '');
    if (clean !== r.ticker) map[clean] = r;
  });

  return NextResponse.json(map, {
    headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=60' },
  });
}
