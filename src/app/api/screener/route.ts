import { NextRequest, NextResponse } from 'next/server';

const THEME_TICKERS: Record<string, string[]> = {
  all:         ['NVDA','MSFT','TSLA','AMZN','PLTR','META','GOOGL','AAPL','SHOP','CRWD','AXON','MELI'],
  high_return: ['IONQ','RKLB','SOUN','ACHR','MSTR','ASTS','RGTI','LUNR','OKLO','JOBY','ARQT','HIMS'],
  small_cap:   ['CELH','RXRX','DOCS','HIMS','TMDX','AEHR','JOBY','CRKN','ACHR','GFAI','SOUN','ARQT'],
  growth:      ['NVDA','CRWD','DDOG','NET','AXON','MELI','TTD','SNOW','BILL','GTLB','DUOL','CELH'],
  value:       ['BRK-B','JPM','XOM','UNH','GOOGL','MU','INTC','CVX','WFC','BAC','VZ','T'],
  ai_tech:     ['NVDA','PLTR','AI','SOUN','IONQ','ARM','SMCI','DELL','MSFT','GOOG','META','AMZN'],
  emerging:    ['MELI','SE','NU','BABA','INFY','VALE','GRAB','KE','TCOM','JD','PDD','BRFS'],
  dividend:    ['O','T','VZ','MO','IBM','PFE','KO','JNJ','ABBV','PM','MMM','CVX'],
  asx:         ['BHP.AX','CBA.AX','CSL.AX','WDS.AX','MQG.AX','XRO.AX','WBC.AX','ANZ.AX','NAB.AX','RIO.AX','FMG.AX','WES.AX'],
  turnaround:  ['INTC','NIO','BYND','WBA','SNAP','RIVN','XPEV','LCID','PARA','OPEN','BBBY','WISH'],
  crypto_adj:  ['COIN','MSTR','MARA','RIOT','CLSK','SQ','PYPL','HOOD','BTBT','HUT','CIFR','CORZ'],
};

// ── Finviz filter codes ───────────────────────────────────────────────────────
// Finviz covers ~8,000 US stocks with 15-min delayed data. No key needed.
// Full filter reference: https://finviz.com/screener.ashx

function buildFinvizFilters(params: {
  rsiMin: number; rsiMax: number;
  macd: string[]; trend: string[];
  recommendation: string[]; risk: string[];
  sectors: string[];
}): string[] {
  const filters: string[] = [];

  // RSI — Finviz uses preset buckets
  const { rsiMin, rsiMax } = params;
  if (rsiMax <= 10) filters.push('ta_rsi_os10');
  else if (rsiMax <= 20) filters.push('ta_rsi_os20');
  else if (rsiMax <= 30) filters.push('ta_rsi_os30');
  else if (rsiMax <= 40) filters.push('ta_rsi_os40');
  else if (rsiMin >= 90) filters.push('ta_rsi_ob90');
  else if (rsiMin >= 80) filters.push('ta_rsi_ob80');
  else if (rsiMin >= 70) filters.push('ta_rsi_ob70');
  else if (rsiMin >= 60) filters.push('ta_rsi_ob60');
  else if (rsiMin > 50) filters.push('ta_rsi_nob50'); // not oversold >50
  // No RSI filter if range is wide (e.g. 0-100)

  // MACD signal
  if (params.macd.includes('Bullish')) filters.push('ta_macd_osig'); // MACD above signal
  if (params.macd.includes('Bearish')) filters.push('ta_macd_bsig'); // MACD below signal

  // Trend via SMA relationships
  if (params.trend.some(t => t.includes('Uptrend'))) {
    filters.push('ta_sma20_pa'); // price above SMA20
    filters.push('ta_sma50_pa'); // price above SMA50
  }
  if (params.trend.some(t => t.includes('Downtrend'))) {
    filters.push('ta_sma20_pb'); // price below SMA20
  }

  // Sector
  const sectorMap: Record<string, string> = {
    'Technology': 'sec_technology',
    'Healthcare': 'sec_healthcare',
    'Finance': 'sec_financial',
    'Energy': 'sec_energy',
    'Consumer': 'sec_consumercyclical',
    'Industrials': 'sec_industrials',
    'Materials': 'sec_basicmaterials',
  };
  for (const s of params.sectors) {
    if (sectorMap[s]) filters.push(sectorMap[s]);
  }

  // Analyst recommendation
  if (params.recommendation.includes('Strong Buy')) filters.push('an_recom_strongbuy');
  else if (params.recommendation.includes('Buy')) filters.push('an_recom_buybetter');

  return filters;
}

// ── Fetch tickers from Finviz screener HTML ────────────────────────────────────
// Finviz returns HTML — we parse ticker symbols from it
// Each page shows 20 results; we fetch up to 5 pages = 100 tickers
async function fetchFinviz(filterCodes: string[], limit: number): Promise<string[]> {
  const allTickers: string[] = [];
  const filterStr = filterCodes.join(',');
  const pages = Math.ceil(Math.min(limit, 100) / 20);

  for (let page = 0; page < pages; page++) {
    const row = page * 20 + 1;
    const url = `https://finviz.com/screener.ashx?v=111&f=${filterStr}&o=-volume&r=${row}`;

    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Referer': 'https://finviz.com/',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        console.warn('[finviz] HTTP', res.status);
        break;
      }

      const html = await res.text();

      // Parse tickers from Finviz HTML table
      // Tickers appear as: class="tab-link" href="quote.ashx?t=AAPL"
      const tickerMatches = html.matchAll(/quote\.ashx\?t=([A-Z]{1,6})/g);
      const pageTickers: string[] = [];
      for (const match of tickerMatches) {
        const ticker = match[1];
        if (ticker && !allTickers.includes(ticker) && !pageTickers.includes(ticker)) {
          pageTickers.push(ticker);
        }
      }

      if (pageTickers.length === 0) break; // no more results
      allTickers.push(...pageTickers);

      // Small delay between pages
      if (page < pages - 1) await new Promise(r => setTimeout(r, 300));
    } catch (e: any) {
      console.warn('[finviz] page', page, 'failed:', e?.message?.slice(0, 50));
      break;
    }
  }

  return allTickers;
}

// ── RSI/MACD self-calculation fallback ────────────────────────────────────────
// Used when no RSI bucket matches OR as enrichment for signal quality check
function calcRSI(prices: number[], period = 14): number {
  if (prices.length < period + 1) return 50;
  const changes = prices.slice(1).map((p, i) => p - prices[i]);
  const recent = changes.slice(-(period * 3));
  let avgGain = 0, avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (recent[i] > 0) avgGain += recent[i];
    else avgLoss += Math.abs(recent[i]);
  }
  avgGain /= period; avgLoss /= period;
  for (let i = period; i < recent.length; i++) {
    avgGain = (avgGain * (period - 1) + Math.max(recent[i], 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-recent[i], 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return Math.round(100 - (100 / (1 + avgGain / avgLoss)));
}

function calcMACD(prices: number[]): string {
  if (prices.length < 35) return 'Neutral';
  const ema = (data: number[], p: number) => {
    const k = 2 / (p + 1);
    return data.reduce((a: number[], v, i) => i === 0 ? [v] : [...a, v * k + a[i-1] * (1-k)], []);
  };
  const macd = ema(prices, 12).map((v, i) => v - ema(prices, 26)[i]);
  const sig = ema(macd.slice(-9), 9);
  const last = macd[macd.length - 1], prev = macd[macd.length - 2];
  const lSig = sig[sig.length - 1], pSig = sig.length > 1 ? sig[sig.length - 2] : lSig;
  if (prev <= pSig && last > lSig) return 'BullCross';
  if (prev >= pSig && last < lSig) return 'BearCross';
  return last > lSig ? 'Bullish' : last < lSig ? 'Bearish' : 'Neutral';
}

async function fetchHistory(ticker: string): Promise<number[]> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=3mo`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [])
      .filter((c: any) => typeof c === 'number' && c > 0);
  } catch { return []; }
}

export async function GET(req: NextRequest) {
  const theme = req.nextUrl.searchParams.get('theme') ?? 'all';
  return NextResponse.json({ tickers: THEME_TICKERS[theme] ?? THEME_TICKERS.all });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      rsiMin = 0, rsiMax = 100, macd = [], trend = [],
      recommendation = [], risk = [], sectors = [], limit = 50,
    } = body;

    const hasFilter = rsiMin > 0 || rsiMax < 100 || macd.length ||
      trend.length || recommendation.length || risk.length || sectors.length;

    if (!hasFilter) {
      return NextResponse.json({ tickers: THEME_TICKERS.all, source: 'default' });
    }

    // ── Step 1: Try Finviz — covers all ~8,000 US stocks ──────────────────────
    const finvizFilters = buildFinvizFilters({ rsiMin, rsiMax, macd, trend, recommendation, risk, sectors });
    let tickers: string[] = [];
    let source = 'finviz';

    if (finvizFilters.length > 0) {
      tickers = await fetchFinviz(finvizFilters, limit);
    }

    // ── Step 2: Try TradingView scanner as backup ──────────────────────────────
    if (!tickers.length) {
      try {
        const tvFilters: any[] = [];
        if (rsiMin > 0 || rsiMax < 100) tvFilters.push({ left: 'RSI', operation: 'in_range', right: [rsiMin, rsiMax] });
        if (macd.includes('Bullish')) tvFilters.push({ left: 'MACD.macd', operation: 'egreater', right: 'MACD.signal' });
        if (macd.includes('Bearish')) tvFilters.push({ left: 'MACD.macd', operation: 'eless', right: 'MACD.signal' });
        if (trend.some((t: string) => t.includes('Up'))) {
          tvFilters.push({ left: 'close', operation: 'greater', right: 'EMA20' });
        }
        tvFilters.push({ left: 'volume', operation: 'greater', right: 50000 });

        const tvRes = await fetch('https://scanner.tradingview.com/america/scan', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0',
            'Origin': 'https://www.tradingview.com',
            'Referer': 'https://www.tradingview.com/',
          },
          body: JSON.stringify({
            filter: tvFilters,
            columns: ['name', 'close', 'RSI', 'volume'],
            sort: { sortBy: 'volume', sortOrder: 'desc' },
            range: [0, limit],
            markets: ['america'],
          }),
          signal: AbortSignal.timeout(10000),
        });

        if (tvRes.ok) {
          const tvData = await tvRes.json();
          tickers = (tvData.data ?? [])
            .map((r: any) => (r.s ?? '').replace(/^(NASDAQ|NYSE|AMEX):/, ''))
            .filter((t: string) => t.length > 0);
          source = 'tradingview';
        }
      } catch (e: any) {
        console.warn('[screener] TradingView fallback failed:', e?.message?.slice(0, 50));
      }
    }

    // ── Step 3: Self-calculated RSI from Yahoo Finance ─────────────────────────
    // Used when RSI range doesn't map to a Finviz bucket (e.g. RSI 35-55)
    // OR as additional filter on Finviz results
    const needsExactRsi = (rsiMin > 0 && rsiMin > 10) || (rsiMax < 100 && ![40,30,20,10,60,70,80,90].includes(rsiMax));
    const needsMacdExact = macd.length > 0 && !tickers.length;

    if (!tickers.length) {
      // Full self-calculated scan as final fallback
      // Use a broader universe — S&P500 + NASDAQ100 + Russell 2000 major names
      const BROAD_UNIVERSE = [
        'AAPL','MSFT','AMZN','GOOGL','META','NVDA','TSLA','BRK-B','JPM','V',
        'UNH','XOM','JNJ','PG','MA','HD','CVX','MRK','ABBV','PEP',
        'COST','AVGO','ORCL','CSCO','ACN','MCD','NKE','TMO','ABT','ADBE',
        'CRM','NFLX','LIN','AMD','QCOM','DHR','TXN','INTU','AMGN','INTC',
        'PLTR','CRWD','NET','DDOG','SNOW','AXON','TTD','BILL','SHOP','MELI',
        'SE','CELH','HIMS','RXRX','IONQ','RKLB','SOUN','ASTS','MSTR','COIN',
        'MARA','RIOT','SQ','PYPL','HOOD','AFRM','SOFI','OPEN','RIVN','LCID',
        'NIO','XPEV','SNAP','PARA','WBA','BYND','BBBY','WISH','SPCE','CLOV',
        'BAC','WFC','GS','MS','C','BLK','SCHW','PFE','MRNA','CRSP','BEAM',
        'LLY','REGN','GILD','BIIB','VRTX','JAZZ','EXAS','IDXX','ZTS','DGX',
        'OXY','DVN','COP','SLB','HAL','MRO','APA','FANG','EOG','PXD',
        'WMT','TGT','COST','AMZN','EBAY','ETSY','W','CHWY','CVNA','CARVANA',
        'DIS','CMCSA','NFLX','WBD','PARA','FOX','NYT','SPOT','RBLX','U',
        'O','AMT','PLD','EQIX','SPG','WELL','VICI','IRM','SBA','CCI',
        'BHP.AX','CBA.AX','CSL.AX','WDS.AX','MQG.AX','XRO.AX','RIO.AX',
      ];

      const BATCH = 10;
      const results: string[] = [];

      for (let i = 0; i < BROAD_UNIVERSE.length && results.length < limit; i += BATCH) {
        const batch = BROAD_UNIVERSE.slice(i, i + BATCH);
        const histories = await Promise.all(batch.map(t => fetchHistory(t)));

        for (let j = 0; j < batch.length; j++) {
          const prices = histories[j];
          if (prices.length < 15) continue;

          const rsi = calcRSI(prices);
          if (rsi < rsiMin || rsi > rsiMax) continue;

          if (macd.length > 0) {
            const macdSig = calcMACD(prices);
            const wantBull = macd.includes('Bullish');
            const wantBear = macd.includes('Bearish');
            if (wantBull && !macdSig.includes('Bull')) continue;
            if (wantBear && !macdSig.includes('Bear')) continue;
          }

          results.push(batch[j]);
        }

        if (i + BATCH < BROAD_UNIVERSE.length) await new Promise(r => setTimeout(r, 100));
      }

      tickers = results;
      source = 'calculated';
    }

    if (!tickers.length) {
      return NextResponse.json({
        tickers: [],
        source: 'none',
        count: 0,
        message: `No stocks found with RSI ${rsiMin}-${rsiMax}${macd.length ? ' + ' + macd.join('/') + ' MACD' : ''}. Try wider filters.`,
      });
    }

    return NextResponse.json({
      tickers: tickers.slice(0, limit),
      source,
      count: tickers.length,
      total: tickers.length,
    });

  } catch (e: any) {
    console.error('[screener/post]', e?.message);
    return NextResponse.json({ tickers: THEME_TICKERS.all, source: 'error', error: e.message });
  }
}
