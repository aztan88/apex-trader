import { NextRequest, NextResponse } from 'next/server';
import { groqDeep } from '@/lib/groq';

// Curated lists for theme-based loading (fast, no AI needed)
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
  turnaround:  ['INTC','NIO','BYND','WBA','SNAP','RIVN','XPEV','LCID','PARA','OPEN','WISH','BBBY'],
  crypto_adj:  ['COIN','MSTR','MARA','RIOT','CLSK','SQ','PYPL','HOOD','BTBT','HUT','CIFR','CORZ'],
};

// AI-powered filter search — asks Groq to find tickers matching specific criteria
async function findTickersByFilter(filters: {
  rsiMin?: number; rsiMax?: number;
  conviction?: number; risk?: string[];
  recommendation?: string[]; macd?: string[];
  trend?: string[]; sectors?: string[];
  count?: number;
}): Promise<string[]> {
  const conditions: string[] = [];
  if (filters.rsiMin !== undefined || filters.rsiMax !== undefined) {
    const lo = filters.rsiMin ?? 0;
    const hi = filters.rsiMax ?? 100;
    if (lo > 0 || hi < 100) {
      if (lo <= 30) conditions.push(`oversold stocks (RSI ${lo}–${hi}, deeply beaten down with potential for reversal)`);
      else if (hi >= 70) conditions.push(`overbought momentum stocks (RSI ${lo}–${hi}, strong momentum plays)`);
      else conditions.push(`neutral RSI stocks (RSI ${lo}–${hi})`);
    }
  }
  if (filters.recommendation?.length) conditions.push(`recommendation: ${filters.recommendation.join(' or ')}`);
  if (filters.risk?.length) conditions.push(`risk level: ${filters.risk.join(' or ')}`);
  if (filters.macd?.length) conditions.push(`MACD signal: ${filters.macd.join(' or ')}`);
  if (filters.trend?.length) conditions.push(`trend: ${filters.trend.join(' or ')}`);
  if (filters.conviction) conditions.push(`conviction score ≥ ${filters.conviction}/10`);
  if (filters.sectors?.length) conditions.push(`sectors: ${filters.sectors.join(', ')}`);

  const count = filters.count ?? 20;

  const prompt = `You are a systematic quant analyst scanning global equity markets.
Find ${count} stocks that currently match ALL of these criteria:
${conditions.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Return ONLY a comma-separated list of tickers in Yahoo Finance format (AAPL, BHP.AX, BTC-USD).
No explanation. No numbering. Just the tickers.
Include diverse picks across market cap sizes and geographies.`;

  const txt = await groqDeep('Return only comma-separated tickers. No other text.', prompt, 150);
  return txt
    .replace(/[^A-Z0-9.,\-]/gi, ' ')
    .split(/[\s,]+/)
    .map(t => t.trim().toUpperCase())
    .filter(t => t.length >= 1 && t.length <= 10)
    .slice(0, count);
}

export async function GET(req: NextRequest) {
  const theme = req.nextUrl.searchParams.get('theme') ?? 'all';
  const tickers = THEME_TICKERS[theme] ?? THEME_TICKERS.all;
  return NextResponse.json({ tickers, theme, count: tickers.length });
}

// POST — filter-based search across the full market
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      rsiMin, rsiMax, conviction, risk, recommendation, macd, trend, sectors, count,
    } = body;

    // Check if any meaningful filter is set
    const hasFilter = (rsiMin > 0) || (rsiMax < 100) || conviction > 0 ||
      risk?.length || recommendation?.length || macd?.length || trend?.length || sectors?.length;

    if (!hasFilter) {
      return NextResponse.json({ tickers: THEME_TICKERS.all, source: 'default' });
    }

    const tickers = await findTickersByFilter({ rsiMin, rsiMax, conviction, risk, recommendation, macd, trend, sectors, count: count ?? 20 });

    if (!tickers.length) {
      return NextResponse.json({ tickers: [], source: 'filter', error: 'No matches found' });
    }

    return NextResponse.json({ tickers, source: 'filter', count: tickers.length });
  } catch (e: any) {
    console.error('[screener/filter]', e?.message);
    return NextResponse.json({ error: e.message, tickers: [] }, { status: 500 });
  }
}
