import { NextRequest, NextResponse } from 'next/server';
// FIX #6: static top-level import, not dynamic import inside handler
import yahooFinance from 'yahoo-finance2';

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

async function fetchYahoo(ticker: string): Promise<StockPrice | null> {
  try {
    // FIX #20: parallel requests for quote + history
    const [quote, hist] = await Promise.all([
      yahooFinance.quote(ticker, {}, { validateResult: false }),
      yahooFinance.chart(ticker, {
        period1: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
        interval: '1d',
      }, { validateResult: false }).catch(() => null),
    ]);
    if (!quote?.regularMarketPrice) return null;

    const closes = (hist?.quotes ?? [])
      .map((q: any) => q.close)
      .filter((c: any): c is number => typeof c === 'number' && c > 0);
    const history = closes.slice(-30);
    const yearAgo = closes[0] ?? quote.regularMarketPrice;
    const change52w = yearAgo > 0 ? ((quote.regularMarketPrice - yearAgo) / yearAgo) * 100 : 0;

    return {
      ticker: quote.symbol ?? ticker,
      name: quote.longName ?? quote.shortName ?? ticker,
      price: Math.round(quote.regularMarketPrice * 100) / 100,
      change1d: Math.round((quote.regularMarketChangePercent ?? 0) * 100) / 100,
      change52w: Math.round(change52w * 100) / 100,
      marketCap: fmtCap(quote.marketCap ?? 0),
      currency: quote.currency ?? 'USD',
      exchange: quote.fullExchangeName ?? quote.exchange ?? 'NASDAQ',
      sector: (quote as any).sector ?? 'Equity',
      high52w: quote.fiftyTwoWeekHigh ?? 0,
      low52w: quote.fiftyTwoWeekLow ?? 0,
      volume: quote.regularMarketVolume ?? 0,
      history, source: 'Yahoo Finance',
    };
  } catch (e: any) {
    console.warn(`[prices] Yahoo error ${ticker}:`, e?.message?.slice(0, 80));
    return null;
  }
}

async function fetchAlphaVantage(ticker: string): Promise<StockPrice | null> {
  const key = process.env.ALPHA_VANTAGE_KEY;
  if (!key || key === 'demo') return null;
  try {
    const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(ticker)}&apikey=${key}`;
    const res = await fetch(url, { next: { revalidate: 300 } });
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

async function enrichWithFinnhub(ticker: string, base: StockPrice): Promise<StockPrice> {
  const key = process.env.FINNHUB_KEY;
  if (!key || base.name !== ticker) return base; // only enrich if name is still just ticker
  try {
    const res = await fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${ticker}&token=${key}`, { next: { revalidate: 86400 } });
    if (!res.ok) return base;
    const p = await res.json();
    return {
      ...base,
      name: p?.name ?? base.name,
      sector: p?.finnhubIndustry ?? base.sector,
      exchange: p?.exchange ?? base.exchange,
      marketCap: p?.marketCapitalization ? fmtCap(p.marketCapitalization * 1e6) : base.marketCap,
    };
  } catch { return base; }
}

async function getPrice(ticker: string): Promise<StockPrice> {
  const t = ticker.toUpperCase().trim();
  const cached = priceCache.get(t);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  let result = await fetchYahoo(t);
  if (!result || result.price <= 0) result = await fetchAlphaVantage(t);
  if (result && result.price > 0) {
    result = await enrichWithFinnhub(t, result);
    priceCache.set(t, { data: result, ts: Date.now() });
    return result;
  }
  return {
    ticker: t, name: t, price: 0, change1d: 0, change52w: 0, marketCap: 'N/A',
    currency: 'USD', exchange: 'N/A', sector: 'Equity',
    high52w: 0, low52w: 0, volume: 0, history: [],
    source: 'unavailable', error: `No data for ${t}`,
  };
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('tickers') ?? '';
  const tickers = raw.split(',').map(t => t.trim().toUpperCase()).filter(Boolean).slice(0, 20);
  if (!tickers.length) return NextResponse.json({ error: 'No tickers provided' }, { status: 400 });

  // FIX #20: all tickers fetched in parallel
  const results = await Promise.all(tickers.map(getPrice));
  const map: Record<string, StockPrice> = {};
  // FIX #1: store under both raw ticker and display ticker so ASX lookups work
  results.forEach(r => {
    map[r.ticker] = r;
    map[r.ticker.replace('.AX', '').replace('-USD', '')] = r;
  });

  return NextResponse.json(map, { headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=60' } });
}
