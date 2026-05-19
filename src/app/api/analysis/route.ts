import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Analysis is expensive — cache permanently per ticker in this function instance
const analysisCache = new Map<string, string>();

export async function GET(req: NextRequest) {
  const ticker = req.nextUrl.searchParams.get('ticker') ?? '';
  const name = req.nextUrl.searchParams.get('name') ?? ticker;
  const price = req.nextUrl.searchParams.get('price') ?? '0';
  const entry = req.nextUrl.searchParams.get('entry') ?? price;
  const stop = req.nextUrl.searchParams.get('stop') ?? '';
  const target = req.nextUrl.searchParams.get('target') ?? '';
  const rsi = req.nextUrl.searchParams.get('rsi') ?? '50';
  const macd = req.nextUrl.searchParams.get('macd') ?? 'Neutral';
  const mktCap = req.nextUrl.searchParams.get('mktCap') ?? 'N/A';
  const change52w = req.nextUrl.searchParams.get('change52w') ?? '0';

  if (!ticker) return NextResponse.json({ error: 'ticker required' }, { status: 400 });

  if (analysisCache.has(ticker)) {
    return NextResponse.json({ analysis: analysisCache.get(ticker), cached: true });
  }

  const prompt = `Write a 4-paragraph equity analysis of ${name} (${ticker}) at $${price}.
Context: market cap ${mktCap}, 52-week return ${change52w}%, RSI ${rsi}, MACD ${macd}.
Trade levels: entry $${entry}, stop $${stop}, target $${target}.

Paragraph 1: Business model and competitive moat (2-3 sentences, specific)
Paragraph 2: Key growth drivers and what the market is currently missing (2-3 sentences)
Paragraph 3: Valuation and technical setup — is it cheap or expensive, and what do the signals say (2-3 sentences)
Paragraph 4: Biggest risk and how a disciplined investor should size this position (1-2 sentences)

No headers. No bullet points. No disclaimers. Plain paragraphs only. Be specific and direct.`;

  try {
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: 'You are a senior equity analyst. Write clear, specific, paragraph-based analysis. No generic statements. No disclaimers.',
      messages: [{ role: 'user', content: prompt }],
    });

    const analysis = (msg.content[0] as any).text;
    analysisCache.set(ticker, analysis);

    return NextResponse.json({ analysis }, {
      headers: { 'Cache-Control': 's-maxage=86400, stale-while-revalidate=3600' },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
