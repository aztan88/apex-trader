import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const signalCache = new Map<string, { data: SignalResult; ts: number }>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

export interface SignalResult {
  name: string; conviction: number; upside: number;
  recommendation: string; riskLevel: string; rsiEstimate: number;
  macdSignal: string; trend: string; candleSignal: string;
  entryPrice: number; stopLoss: number; targetPrice: number;
  thesis: string; risks: string; catalysts: string[];
}

const REC_MAP: Record<string, string> = {
  StrongBuy: 'Strong Buy', Buy: 'Buy', Hold: 'Hold', SpecBuy: 'Speculative Buy', Sell: 'Sell',
};
const RISK_MAP: Record<string, string> = { Low: 'Low', Medium: 'Medium', High: 'High', VeryHigh: 'Very High' };
const TREND_MAP: Record<string, string> = {
  StrongUp: 'Strong Uptrend', Up: 'Uptrend', Sideways: 'Sideways',
  Down: 'Downtrend', StrongDown: 'Strong Downtrend',
};
const MACD_MAP: Record<string, string> = {
  BullCross: 'Bullish Crossover', BearCross: 'Bearish Crossover', Neutral: 'Neutral',
};

export async function GET(req: NextRequest) {
  // FIX #5: sanitise all inputs
  const ticker = (req.nextUrl.searchParams.get('ticker') ?? '').replace(/[^A-Z0-9.\-]/gi, '').toUpperCase().slice(0, 10);
  const price = parseFloat(req.nextUrl.searchParams.get('price') ?? '0');
  const name = (req.nextUrl.searchParams.get('name') ?? ticker).slice(0, 80);
  const change52w = parseFloat(req.nextUrl.searchParams.get('change52w') ?? '0');
  const marketCap = (req.nextUrl.searchParams.get('marketCap') ?? 'N/A').slice(0, 20);
  const sector = (req.nextUrl.searchParams.get('sector') ?? 'Equity').slice(0, 40);
  const exchange = (req.nextUrl.searchParams.get('exchange') ?? 'NYSE').slice(0, 30);
  const high52w = parseFloat(req.nextUrl.searchParams.get('high52w') ?? '0');
  const low52w = parseFloat(req.nextUrl.searchParams.get('low52w') ?? '0');

  if (!ticker || price <= 0) {
    return NextResponse.json({ error: 'ticker and valid price required' }, { status: 400 });
  }

  // Cache key: ticker + price bucket ($5 increments for expensive stocks, $1 for cheap)
  const bucket = price > 50 ? Math.round(price / 5) * 5 : Math.round(price);
  const cacheKey = `${ticker}:${bucket}`;
  const cached = signalCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return NextResponse.json({ ...cached.data, cached: true });
  }

  // Calculate price context
  const pctFromHigh = high52w > 0 ? ((price - high52w) / high52w * 100).toFixed(0) : '?';
  const pctFromLow = low52w > 0 ? ((price - low52w) / low52w * 100).toFixed(0) : '?';
  const impliedStop = (price * 0.92).toFixed(2);
  const impliedTarget = (price * 1.25).toFixed(2);

  const prompt = `Stock: ${name} (${ticker}) | Exchange: ${exchange} | Sector: ${sector}
Price: $${price.toFixed(2)} | Market Cap: ${marketCap} | 52w: ${change52w.toFixed(1)}%
52w High: $${high52w.toFixed(2)} (${pctFromHigh}% from high) | 52w Low: $${low52w.toFixed(2)} (+${pctFromLow}% from low)

Return exactly ONE line in this pipe-delimited format, no other text:
FULLNAME|CONVICTION|UPSIDE_PCT|REC|RISK|RSI|MACD|TREND|CANDLE|ENTRY|STOP|TARGET|THESIS|RISKS|CAT1|CAT2

FULLNAME=official company name | CONVICTION=1-10 integer | UPSIDE_PCT=percent integer
REC=StrongBuy|Buy|Hold|SpecBuy|Sell | RISK=Low|Medium|High|VeryHigh
RSI=0-100 integer | MACD=BullCross|BearCross|Neutral
TREND=StrongUp|Up|Sideways|Down|StrongDown | CANDLE=pattern or None
ENTRY=entry price number | STOP=stop loss price (near ${impliedStop}) | TARGET=target price (near ${impliedTarget})
THESIS=investment thesis max 25 words, no pipes | RISKS=key risk max 12 words, no pipes
CAT1=catalyst 1 max 6 words | CAT2=catalyst 2 max 6 words`;

  try {
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 220,
      system: 'Return only the single pipe-delimited line requested. No explanation. No markdown.',
      messages: [{ role: 'user', content: prompt }],
    });

    const txt = (msg.content[0] as any).text.replace(/\n/g, '').trim();
    const p = txt.split('|');

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
      thesis: p[12]?.trim() || 'Strong fundamentals with growth potential.',
      risks: p[13]?.trim() || 'Market and sector risk.',
      catalysts: [p[14]?.trim(), p[15]?.trim()].filter(Boolean),
    };

    signalCache.set(cacheKey, { data: result, ts: Date.now() });
    return NextResponse.json(result, { headers: { 'Cache-Control': 's-maxage=3600, stale-while-revalidate=300' } });
  } catch (e: any) {
    console.error('[signals] Error:', e?.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
