import { NextRequest, NextResponse } from 'next/server';
import { groq } from '@/lib/groq';

// Extended cache — 4 hours. Signals don't change that fast.
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

export async function GET(req: NextRequest) {
  const ticker   = (req.nextUrl.searchParams.get('ticker') ?? '').replace(/[^A-Z0-9.\-]/gi,'').toUpperCase().slice(0,10);
  const price    = parseFloat(req.nextUrl.searchParams.get('price') ?? '0');
  const name     = (req.nextUrl.searchParams.get('name') ?? ticker).slice(0,60);
  const change52w= parseFloat(req.nextUrl.searchParams.get('change52w') ?? '0');
  const marketCap= (req.nextUrl.searchParams.get('marketCap') ?? 'N/A').slice(0,15);
  const sector   = (req.nextUrl.searchParams.get('sector') ?? 'Equity').slice(0,30);
  const exchange = (req.nextUrl.searchParams.get('exchange') ?? 'NYSE').slice(0,20);

  if (!ticker || price <= 0) return NextResponse.json({ error: 'ticker and price required' }, { status: 400 });

  // Cache by $10 price buckets to maximise cache hits
  const bucket = Math.round(price / 10) * 10;
  const cacheKey = `${ticker}:${bucket}`;
  const cached = signalCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return NextResponse.json({ ...cached.data, cached: true });
  }

  // Ultra-compact prompt — ~120 tokens input vs ~300 before
  const prompt = `${name}(${ticker}) ${exchange} ${sector} $${price} cap:${marketCap} 52w:${change52w.toFixed(0)}%
ONE line pipe-delimited:
NAME|CONV|UP%|REC|RISK|RSI|MACD|TREND|CANDLE|ENTRY|STOP|TARGET|THESIS|RISKS|CAT1|CAT2
REC=StrongBuy|Buy|Hold|SpecBuy|Sell RISK=Low|Medium|High|VeryHigh MACD=BullCross|BearCross|Neutral TREND=StrongUp|Up|Sideways|Down|StrongDown`;

  try {
    const txt = await groq('Return only the pipe-delimited line. No other text.', prompt, 160);
    const p = txt.replace(/\n/g,'').trim().split('|');
    const result: SignalResult = {
      name: p[0]?.trim() || name,
      conviction: Math.min(10, Math.max(1, parseInt(p[1]) || 6)),
      upside: isFinite(parseFloat(p[2])) ? parseFloat(p[2]) : 15,
      recommendation: REC_MAP[p[3]?.trim()] ?? 'Buy',
      riskLevel: RISK_MAP[p[4]?.trim()] ?? 'Medium',
      rsiEstimate: Math.min(100, Math.max(0, parseInt(p[5]) || 50)),
      macdSignal: MACD_MAP[p[6]?.trim()] ?? 'Neutral',
      trend: TREND_MAP[p[7]?.trim()] ?? 'Sideways',
      candleSignal: p[8]?.trim() || 'None',
      entryPrice: parseFloat(p[9]) || price,
      stopLoss: parseFloat(p[10]) || parseFloat((price * 0.92).toFixed(2)),
      targetPrice: parseFloat(p[11]) || parseFloat((price * 1.25).toFixed(2)),
      thesis: p[12]?.trim() || 'Strong fundamentals.',
      risks: p[13]?.trim() || 'Market risk.',
      catalysts: [p[14]?.trim(), p[15]?.trim()].filter(Boolean),
    };
    signalCache.set(cacheKey, { data: result, ts: Date.now() });
    return NextResponse.json(result, { headers: { 'Cache-Control': 's-maxage=14400' } });
  } catch (e: any) {
    // Return a sensible default so the screener still shows the card
    const fallback: SignalResult = {
      name, conviction: 5, upside: 10, recommendation: 'Hold', riskLevel: 'Medium',
      rsiEstimate: 50, macdSignal: 'Neutral', trend: 'Sideways', candleSignal: 'None',
      entryPrice: price, stopLoss: parseFloat((price*0.92).toFixed(2)),
      targetPrice: parseFloat((price*1.15).toFixed(2)),
      thesis: 'AI analysis temporarily unavailable — price data loaded.',
      risks: 'Rate limit — retry later.', catalysts: [],
    };
    // Cache the fallback for 15 min so we don't hammer a rate-limited API
    signalCache.set(cacheKey, { data: fallback, ts: Date.now() - CACHE_TTL + 15 * 60 * 1000 });
    console.warn('[signals] fallback for', ticker, e?.message?.slice(0, 80));
    return NextResponse.json({ ...fallback, rateLimited: true });
  }
}
