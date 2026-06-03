import { NextRequest, NextResponse } from 'next/server';

// Fallback curated lists for theme-based loading
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

// Simple GET — return curated theme tickers
export async function GET(req: NextRequest) {
  const theme = req.nextUrl.searchParams.get('theme') ?? 'all';
  const tickers = THEME_TICKERS[theme] ?? THEME_TICKERS.all;
  return NextResponse.json({ tickers, theme, count: tickers.length });
}

// POST — TradingView screener with real technical filters
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      rsiMin = 0, rsiMax = 100,
      macd = [], trend = [],
      recommendation = [], risk = [],
      sectors = [], limit = 30,
    } = body;

    const hasFilter = rsiMin > 0 || rsiMax < 100 || macd.length ||
      trend.length || recommendation.length || risk.length || sectors.length;

    if (!hasFilter) {
      return NextResponse.json({ tickers: THEME_TICKERS.all, source: 'default' });
    }

    // Build TradingView screener query dynamically
    // TradingView's internal API endpoint — no auth needed
    const filters: any[] = [];
    const columns = ['name', 'close', 'RSI', 'MACD.macd', 'MACD.signal',
      'EMA20', 'EMA50', 'SMA200', 'volume', 'market_cap_basic',
      'sector', 'beta_1_year', 'Recommend.All'];

    // RSI filter
    if (rsiMin > 0 || rsiMax < 100) {
      filters.push({ left: 'RSI', operation: 'in_range', right: [rsiMin, rsiMax] });
    }

    // MACD filters
    if (macd.includes('Bullish')) {
      filters.push({ left: 'MACD.macd', operation: 'egreater', right: 'MACD.signal' });
    }
    if (macd.includes('Bearish')) {
      filters.push({ left: 'MACD.macd', operation: 'eless', right: 'MACD.signal' });
    }

    // Trend filters using EMA relationships
    if (trend.includes('Strong Uptrend') || trend.includes('Uptrend')) {
      filters.push({ left: 'close', operation: 'greater', right: 'EMA20' });
      filters.push({ left: 'EMA20', operation: 'greater', right: 'EMA50' });
    }
    if (trend.includes('Strong Downtrend') || trend.includes('Downtrend')) {
      filters.push({ left: 'close', operation: 'less', right: 'EMA20' });
      filters.push({ left: 'EMA20', operation: 'less', right: 'EMA50' });
    }
    if (trend.includes('Sideways')) {
      // Price within 2% of EMA20
      filters.push({ left: 'close', operation: 'in_range', right: ['EMA20*0.98', 'EMA20*1.02'] });
    }

    // Risk via beta
    if (risk.includes('Low')) {
      filters.push({ left: 'beta_1_year', operation: 'in_range', right: [0, 0.8] });
    } else if (risk.includes('Very High')) {
      filters.push({ left: 'beta_1_year', operation: 'greater', right: 1.8 });
    } else if (risk.includes('High')) {
      filters.push({ left: 'beta_1_year', operation: 'in_range', right: [1.3, 1.8] });
    } else if (risk.includes('Medium')) {
      filters.push({ left: 'beta_1_year', operation: 'in_range', right: [0.8, 1.3] });
    }

    // TradingView Recommend.All: 1=Strong Buy, 0.5=Buy, 0=Neutral, -0.5=Sell, -1=Strong Sell
    if (recommendation.includes('Strong Buy')) {
      filters.push({ left: 'Recommend.All', operation: 'greater', right: 0.5 });
    } else if (recommendation.includes('Buy')) {
      filters.push({ left: 'Recommend.All', operation: 'greater', right: 0.1 });
    } else if (recommendation.includes('Sell')) {
      filters.push({ left: 'Recommend.All', operation: 'less', right: -0.1 });
    }

    // Sector filter
    const sectorMap: Record<string, string> = {
      'Technology': 'Technology Services',
      'Healthcare': 'Health Technology',
      'Finance': 'Finance',
      'Energy': 'Energy Minerals',
      'Consumer': 'Consumer Durables',
      'Industrials': 'Industrial Services',
    };
    const tvSectors = sectors.map((s: string) => sectorMap[s]).filter(Boolean);
    if (tvSectors.length > 0) {
      filters.push({ left: 'sector', operation: 'in_range', right: tvSectors });
    }

    // Minimum volume and price for liquidity
    filters.push({ left: 'volume', operation: 'greater', right: 100000 });
    filters.push({ left: 'close', operation: 'greater', right: 0.5 });

    const payload = {
      filter: filters,
      options: { lang: 'en' },
      symbols: { query: { types: ['stock', 'dr', 'fund'] }, tickers: [] },
      columns,
      sort: { sortBy: 'volume', sortOrder: 'desc' },
      range: [0, limit],
      markets: ['america'],
    };

    const res = await fetch('https://scanner.tradingview.com/america/scan', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0',
        'Origin': 'https://www.tradingview.com',
        'Referer': 'https://www.tradingview.com/',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      console.warn('[screener] TradingView error:', res.status);
      return NextResponse.json({ tickers: THEME_TICKERS.all, source: 'fallback', error: `TV returned ${res.status}` });
    }

    const data = await res.json();
    const rows: any[] = data.data ?? [];

    if (!rows.length) {
      return NextResponse.json({ tickers: [], source: 'tradingview', count: 0, totalFound: data.totalCount ?? 0 });
    }

    // Extract tickers and enriched data
    const results = rows.map((row: any) => {
      const d = row.d ?? [];
      return {
        ticker: row.s?.replace('NASDAQ:', '').replace('NYSE:', '').replace('AMEX:', '').replace('ASX:', '') ?? '',
        price: d[1] ?? 0,
        rsi: Math.round(d[2] ?? 50),
        macdLine: d[3] ?? 0,
        macdSignal: d[4] ?? 0,
        ema20: d[5] ?? 0,
        ema50: d[6] ?? 0,
        sma200: d[7] ?? 0,
        volume: d[8] ?? 0,
        marketCap: d[9] ?? 0,
        sector: d[10] ?? '',
        beta: d[11] ?? 1,
        recommend: d[12] ?? 0,
      };
    }).filter(r => r.ticker && r.price > 0);

    const tickers = results.map(r => r.ticker);

    return NextResponse.json({
      tickers,
      source: 'tradingview',
      count: tickers.length,
      totalFound: data.totalCount ?? tickers.length,
      enriched: results, // pass pre-fetched data to avoid redundant API calls
    });

  } catch (e: any) {
    console.error('[screener/post]', e?.message);
    return NextResponse.json({
      tickers: THEME_TICKERS.all,
      source: 'fallback',
      error: e.message,
    }, { status: 500 });
  }
}
