import { NextRequest, NextResponse } from 'next/server';
import { groq } from '@/lib/groq';

const analysisCache = new Map<string, string>();

export async function GET(req: NextRequest) {
  const ticker = (req.nextUrl.searchParams.get('ticker') ?? '').slice(0,10);
  const name   = (req.nextUrl.searchParams.get('name') ?? ticker).slice(0,80);
  const price  = req.nextUrl.searchParams.get('price') ?? '0';
  const entry  = req.nextUrl.searchParams.get('entry') ?? price;
  const stop   = req.nextUrl.searchParams.get('stop') ?? '';
  const target = req.nextUrl.searchParams.get('target') ?? '';
  const rsi    = req.nextUrl.searchParams.get('rsi') ?? '50';
  const macd   = req.nextUrl.searchParams.get('macd') ?? 'Neutral';
  const mktCap = req.nextUrl.searchParams.get('mktCap') ?? 'N/A';
  const change52w = req.nextUrl.searchParams.get('change52w') ?? '0';

  if (!ticker) return NextResponse.json({ error: 'ticker required' }, { status: 400 });
  if (analysisCache.has(ticker)) return NextResponse.json({ analysis: analysisCache.get(ticker), cached: true });

  const prompt = `Write a 4-paragraph equity analysis of ${name} (${ticker}) at $${price}.
Market cap: ${mktCap} | 52w return: ${change52w}% | RSI: ${rsi} | MACD: ${macd}
Trade levels: entry $${entry} | stop $${stop} | target $${target}

P1: Business model and competitive moat (2-3 sentences)
P2: Key growth drivers and what market is missing (2-3 sentences)
P3: Valuation and technical setup (2-3 sentences)
P4: Biggest risk and position sizing (1-2 sentences)

No headers. No bullets. No disclaimers. Be specific.`;

  try {
    const analysis = await groq('Senior equity analyst. Specific, concise, no disclaimers.', prompt, 500);
    analysisCache.set(ticker, analysis);
    return NextResponse.json({ analysis }, { headers: { 'Cache-Control': 's-maxage=86400' } });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
