import { NextRequest, NextResponse } from 'next/server';
import { groqDeep } from '@/lib/groq';

// Cache discoveries for 2 hours — we don't want to re-research every 30 seconds
const discoveryCache = new Map<string, { data: Discovery[]; ts: number }>();
const CACHE_TTL = 2 * 60 * 60 * 1000;

export interface Discovery {
  ticker: string;
  name: string;
  thesis: string;        // why this specific stock right now
  edge: string;          // what most traders are missing
  conviction: number;    // 1-10
  category: string;      // small-cap, catalyst, sector-rotation, etc
  timeframe: string;     // days, weeks, months
  riskNote: string;
}

// The quant discovery prompt — this is the core of what makes it different
// It asks Groq to behave like a systematic quant analyst, not a retail stock picker
function buildDiscoveryPrompt(
  risk: string,
  sectors: string[],
  existingTickers: string[],
  cash: number,
  totalValue: number,
  minConviction: number
): string {
  const sectorFocus = sectors.length > 0
    ? `Focus sectors: ${sectors.join(', ')}.`
    : 'No sector restriction — scan the entire market globally.';

  const avoidStr = existingTickers.length > 0
    ? `Already holding: ${existingTickers.join(', ')} — do not suggest these.`
    : 'No current positions.';

  return `You are a quantitative hedge fund analyst with deep knowledge of global equity markets.
Risk profile: ${risk} | Available cash: $${cash.toFixed(0)} of $${totalValue.toFixed(0)} portfolio
Min conviction threshold: ${minConviction}/10
${sectorFocus}
${avoidStr}

Your task: Find 6 genuinely high-potential stock opportunities right now. Think like a quant:
- Look beyond obvious large-caps. Find stocks with specific catalysts, mispricing, or momentum
- Consider: small/mid caps being ignored by retail, sector rotation plays, beaten-down stocks with recovery catalysts
- ASX stocks for Australian exposure, emerging market leaders, biotech near catalysts
- Technical setups: breakouts, accumulation patterns, oversold with improving fundamentals
- Macro tailwinds: AI infrastructure, energy transition, defence, healthcare innovation, commodities

For each pick, identify the specific EDGE — what does the market not know or is underweighting?

Return exactly 6 lines, pipe-delimited, no other text:
TICKER|FULLNAME|THESIS(max 20 words)|EDGE(max 15 words)|CONVICTION(1-10)|CATEGORY|TIMEFRAME|RISK(max 10 words)

TICKER = Yahoo Finance format (AAPL, BHP.AX, BTC-USD)
CATEGORY = one of: small-cap|catalyst|sector-rotation|technical-breakout|value-trap-reversal|macro-play|momentum|beaten-down|emerging-market|special-situation
TIMEFRAME = one of: days|weeks|1-3months|3-6months|6-12months`;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      risk = 'moderate',
      sectors = [],
      existingTickers = [],
      cash = 0,
      totalValue = 50000,
      minConviction = 6,
      forceRefresh = false,
    } = body;

    const cacheKey = `${risk}:${sectors.join(',')}:${minConviction}`;

    if (!forceRefresh) {
      const cached = discoveryCache.get(cacheKey);
      if (cached && Date.now() - cached.ts < CACHE_TTL) {
        return NextResponse.json({ discoveries: cached.data, cached: true, cacheAge: Math.round((Date.now() - cached.ts) / 60000) + 'min' });
      }
    }

    const prompt = buildDiscoveryPrompt(risk, sectors, existingTickers, cash, totalValue, minConviction);

    const txt = await groqDeep(
      'You are a systematic quantitative analyst. Return only the pipe-delimited lines as instructed. No markdown, no explanations.',
      prompt,
      600
    );

    const discoveries: Discovery[] = [];
    const lines = txt.trim().split('\n').filter(l => l.includes('|'));

    for (const line of lines) {
      const p = line.split('|');
      if (p.length < 6) continue;
      const ticker = p[0]?.trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, '');
      if (!ticker || ticker.length < 1 || ticker.length > 10) continue;

      discoveries.push({
        ticker,
        name: p[1]?.trim() || ticker,
        thesis: p[2]?.trim() || '',
        edge: p[3]?.trim() || '',
        conviction: Math.min(10, Math.max(1, parseInt(p[4]) || 6)),
        category: p[5]?.trim() || 'unknown',
        timeframe: p[6]?.trim() || 'weeks',
        riskNote: p[7]?.trim() || '',
      });
    }

    if (discoveries.length > 0) {
      discoveryCache.set(cacheKey, { data: discoveries, ts: Date.now() });
    }

    return NextResponse.json({ discoveries, cached: false });
  } catch (e: any) {
    console.error('[autopilot/discover]', e?.message);
    return NextResponse.json({ error: e.message, discoveries: [] }, { status: 500 });
  }
}
