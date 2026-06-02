import { NextRequest, NextResponse } from 'next/server';
import { groq } from '@/lib/groq';

const signalCache = new Map<string, { data: SignalResult; ts: number }>();
const CACHE_TTL = 4 * 60 * 60 * 1000;

export interface SignalResult {
  name: string; conviction: number; upside: number;
  recommendation: string; riskLevel: string; rsiEstimate: number;
  macdSignal: string; trend: string; candleSignal: string;
  entryPrice: number; stopLoss: number; targetPrice: number;
  thesis: string; risks: string; catalysts: string[];
}

const REC_MAP: Record<string,string> = { StrongBuy:'Strong Buy',Buy:'Buy',Hold:'Hold',SpecBuy:'Speculative Buy',Sell:'Sell' };
const RISK_MAP: Record<string,string> = { Low:'Low',Medium:'Medium',High:'High',VeryHigh:'Very High' };
const TREND_MAP: Record<string,string> = { StrongUp:'Strong Uptrend',Up:'Uptrend',Sideways:'Sideways',Down:'Downtrend',StrongDown:'Strong Downtrend' };
const MACD_MAP: Record<string,string> = { BullCross:'Bullish Crossover',BearCross:'Bearish Crossover',Neutral:'Neutral' };

function makeDefault(name: string, price: number): SignalResult {
  return {
    name, conviction: 5, upside: 10, recommendation: 'Hold', riskLevel: 'Medium',
    rsiEstimate: 50, macdSignal: 'Neutral', trend: 'Sideways', candleSignal: 'None',
    entryPrice: price, stopLoss: parseFloat((price * 0.92).toFixed(2)),
    targetPrice: parseFloat((price * 1.15).toFixed(2)),
    thesis: 'AI analysis unavailable — price data loaded.', risks: 'Retry later.', catalysts: [],
  };
}

export async function GET(req: NextRequest) {
  const ticker    = (req.nextUrl.searchParams.get('ticker') ?? '').replace(/[^A-Z0-9.\-]/gi,'').toUpperCase().slice(0,10);
  const price     = parseFloat(req.nextUrl.searchParams.get('price') ?? '0');
  const name      = (req.nextUrl.searchParams.get('name') ?? ticker).slice(0,60);
  const change52w = parseFloat(req.nextUrl.searchParams.get('change52w') ?? '0');
  const marketCap = (req.nextUrl.searchParams.get('marketCap') ?? 'N/A').slice(0,15);
  const sector    = (req.nextUrl.searchParams.get('sector') ?? 'Equity').slice(0,30);
  const exchange  = (req.nextUrl.searchParams.get('exchange') ?? 'NYSE').slice(0,20);

  if (!ticker || price <= 0) return NextResponse.json({ error: 'ticker and price required' }, { status: 400 });

  const bucket = Math.round(price / 10) * 10;
  const cacheKey = `${ticker}:${bucket}`;
  const cached = signalCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return NextResponse.json({ ...cached.data, cached: true });

  // Compact prompt — ~120 tokens
  const prompt = `Analyse ${name} (${ticker}) on ${exchange}. Sector: ${sector}. Price: $${price}. MarketCap: ${marketCap}. 52w change: ${change52w.toFixed(0)}%.

Reply with EXACTLY ONE pipe-delimited line of data (no headers, no explanation):
[FullCompanyName]|[1-10]|[upside%]|[StrongBuy/Buy/Hold/SpecBuy/Sell]|[Low/Medium/High/VeryHigh]|[RSI 0-100]|[BullCross/BearCross/Neutral]|[StrongUp/Up/Sideways/Down/StrongDown]|[candle or None]|[entry$]|[stop$]|[target$]|[thesis max 20 words]|[risk max 10 words]|[catalyst1 max 6 words]|[catalyst2 max 6 words]

Example: NVIDIA Corporation|8|22|Buy|Medium|62|BullCross|StrongUp|Hammer|$${price.toFixed(0)}|$${(price*0.92).toFixed(0)}|$${(price*1.22).toFixed(0)}|AI chip demand accelerating globally|Valuation stretched at current levels|Data center expansion|Blackwell GPU ramp`;

  try {
    const txt = await groq('You are a stock analyst. Reply with only the single data line requested.', prompt, 180);

    // Parse the response — take the first line that looks like data (has multiple pipes and doesn't start with a field label)
    const lines = txt.split('\n').filter(l => {
      const pipes = (l.match(/\|/g) ?? []).length;
      const isHeader = /^NAME\||\bFULLNAME\b|\bTICKER\b/i.test(l.trim());
      return pipes >= 8 && !isHeader;
    });

    if (!lines.length) {
      console.warn('[signals] no valid data line for', ticker, '— response:', txt.slice(0, 100));
      const def = makeDefault(name, price);
      return NextResponse.json(def);
    }

    const p = lines[0].split('|');

    // FIX: validate that p[0] is actually a company name, not a field label
    const rawName = p[0]?.trim() ?? '';
    const isLabel = /^NAME$|^FULLNAME$|^TICKER$|^COMPANY$/i.test(rawName);
    const parsedName = (rawName && !isLabel && rawName.length > 1) ? rawName : name;

    const result: SignalResult = {
      name: parsedName,
      conviction: Math.min(10, Math.max(1, parseInt(p[1]) || 5)),
      upside: isFinite(parseFloat(p[2])) ? parseFloat(p[2]) : 10,
      recommendation: REC_MAP[p[3]?.trim()] ?? 'Hold',
      riskLevel: RISK_MAP[p[4]?.trim()] ?? 'Medium',
      rsiEstimate: Math.min(100, Math.max(0, parseInt(p[5]) || 50)),
      macdSignal: MACD_MAP[p[6]?.trim()] ?? 'Neutral',
      trend: TREND_MAP[p[7]?.trim()] ?? 'Sideways',
      candleSignal: p[8]?.trim() || 'None',
      entryPrice: parseFloat(p[9]?.replace('$','')) || price,
      stopLoss: parseFloat(p[10]?.replace('$','')) || parseFloat((price * 0.92).toFixed(2)),
      targetPrice: parseFloat(p[11]?.replace('$','')) || parseFloat((price * 1.15).toFixed(2)),
      thesis: p[12]?.trim() || 'Strong fundamentals.',
      risks: p[13]?.trim() || 'Market risk.',
      catalysts: [p[14]?.trim(), p[15]?.trim()].filter(Boolean),
    };

    signalCache.set(cacheKey, { data: result, ts: Date.now() });
    return NextResponse.json(result, { headers: { 'Cache-Control': 's-maxage=14400' } });
  } catch (e: any) {
    const def = makeDefault(name, price);
    signalCache.set(cacheKey, { data: def, ts: Date.now() - CACHE_TTL + 15 * 60 * 1000 });
    console.warn('[signals] fallback for', ticker, ':', e?.message?.slice(0, 80));
    return NextResponse.json({ ...def, rateLimited: true });
  }
}
