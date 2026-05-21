import { NextRequest, NextResponse } from 'next/server';
import { gemini } from '@/lib/gemini';

const signalCache = new Map<string, { data: SignalResult; ts: number }>();
const CACHE_TTL = 60 * 60 * 1000;

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
  const ticker = (req.nextUrl.searchParams.get('ticker') ?? '').replace(/[^A-Z0-9.\-]/gi,'').toUpperCase().slice(0,10);
  const price = parseFloat(req.nextUrl.searchParams.get('price') ?? '0');
  const name = (req.nextUrl.searchParams.get('name') ?? ticker).slice(0,80);
  const change52w = parseFloat(req.nextUrl.searchParams.get('change52w') ?? '0');
  const marketCap = (req.nextUrl.searchParams.get('marketCap') ?? 'N/A').slice(0,20);
  const sector = (req.nextUrl.searchParams.get('sector') ?? 'Equity').slice(0,40);
  const exchange = (req.nextUrl.searchParams.get('exchange') ?? 'NYSE').slice(0,30);
  const high52w = parseFloat(req.nextUrl.searchParams.get('high52w') ?? '0');
  const low52w = parseFloat(req.nextUrl.searchParams.get('low52w') ?? '0');

  if (!ticker || price <= 0) return NextResponse.json({ error: 'ticker and valid price required' }, { status: 400 });

  const bucket = price > 50 ? Math.round(price/5)*5 : Math.round(price);
  const cacheKey = `${ticker}:${bucket}`;
  const cached = signalCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return NextResponse.json({ ...cached.data, cached: true });

  const pctFromHigh = high52w > 0 ? ((price-high52w)/high52w*100).toFixed(0) : '?';
  const impliedStop = (price*0.92).toFixed(2);
  const impliedTarget = (price*1.25).toFixed(2);

  const prompt = `Stock: ${name} (${ticker}) | Exchange: ${exchange} | Sector: ${sector}
Price: $${price.toFixed(2)} | Market Cap: ${marketCap} | 52w change: ${change52w.toFixed(1)}%
52w High: $${high52w.toFixed(2)} (${pctFromHigh}% from high) | 52w Low: $${low52w.toFixed(2)}

Return exactly ONE line in this pipe-delimited format. No explanation, no markdown, no extra text:
FULLNAME|CONVICTION|UPSIDE_PCT|REC|RISK|RSI|MACD|TREND|CANDLE|ENTRY|STOP|TARGET|THESIS|RISKS|CAT1|CAT2

FULLNAME=official company name (no pipes) | CONVICTION=integer 1-10 | UPSIDE_PCT=integer percent
REC=StrongBuy|Buy|Hold|SpecBuy|Sell | RISK=Low|Medium|High|VeryHigh
RSI=integer 0-100 | MACD=BullCross|BearCross|Neutral
TREND=StrongUp|Up|Sideways|Down|StrongDown | CANDLE=candlestick pattern or None
ENTRY=entry price | STOP=stop loss near ${impliedStop} | TARGET=12-month target near ${impliedTarget}
THESIS=max 25 words no pipes | RISKS=max 12 words no pipes | CAT1=max 6 words | CAT2=max 6 words`;

  try {
    const txt = await gemini('Return only the single pipe-delimited line. No explanation. No markdown.', prompt, 220);
    const p = txt.replace(/\n/g,'').trim().split('|');
    const result: SignalResult = {
      name: p[0]?.trim() || name,
      conviction: Math.min(10,Math.max(1,parseInt(p[1])||6)),
      upside: isFinite(parseFloat(p[2])) ? parseFloat(p[2]) : 15,
      recommendation: REC_MAP[p[3]?.trim()] ?? 'Buy',
      riskLevel: RISK_MAP[p[4]?.trim()] ?? 'Medium',
      rsiEstimate: Math.min(100,Math.max(0,parseInt(p[5])||50)),
      macdSignal: MACD_MAP[p[6]?.trim()] ?? 'Neutral',
      trend: TREND_MAP[p[7]?.trim()] ?? 'Sideways',
      candleSignal: p[8]?.trim() || 'None',
      entryPrice: parseFloat(p[9]) || price,
      stopLoss: parseFloat(p[10]) || parseFloat((price*0.92).toFixed(2)),
      targetPrice: parseFloat(p[11]) || parseFloat((price*1.25).toFixed(2)),
      thesis: p[12]?.trim() || 'Strong fundamentals with growth potential.',
      risks: p[13]?.trim() || 'Market and sector risk.',
      catalysts: [p[14]?.trim(),p[15]?.trim()].filter(Boolean),
    };
    signalCache.set(cacheKey, { data: result, ts: Date.now() });
    return NextResponse.json(result, { headers: { 'Cache-Control': 's-maxage=3600, stale-while-revalidate=300' } });
  } catch (e: any) {
    console.error('[signals] Error:', e?.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
