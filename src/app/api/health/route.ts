import { NextResponse } from 'next/server';

export async function GET() {
  const checks: Record<string, any> = {};

  // Check 1: Anthropic API key present
  const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
  checks.anthropic_key_set = hasAnthropicKey;

  // Check 2: Test Anthropic API actually works
  if (hasAnthropicKey) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY!,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'ping' }],
        }),
      });
      checks.anthropic_api_works = res.ok;
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        checks.anthropic_error = err?.error?.message ?? `HTTP ${res.status}`;
      }
    } catch (e: any) {
      checks.anthropic_api_works = false;
      checks.anthropic_error = e.message;
    }
  } else {
    checks.anthropic_api_works = false;
    checks.anthropic_error = 'ANTHROPIC_API_KEY not set in environment variables';
  }

  // Check 3: Yahoo Finance reachable
  try {
    const yf = await import('yahoo-finance2');
    const lib = (yf.default ?? yf) as any;
    const quote = await lib.quote('AAPL', {}, { validateResult: false });
    checks.yahoo_finance = quote?.regularMarketPrice > 0;
    checks.yahoo_sample_price = quote?.regularMarketPrice ?? null;
    checks.yahoo_ticker = 'AAPL';
  } catch (e: any) {
    checks.yahoo_finance = false;
    checks.yahoo_error = e.message?.slice(0, 100);
  }

  // Check 4: Optional keys
  checks.alpha_vantage_key_set = !!process.env.ALPHA_VANTAGE_KEY;
  checks.finnhub_key_set = !!process.env.FINNHUB_KEY;
  checks.broker = process.env.BROKER ?? 'paper (default)';

  const allGood = checks.anthropic_api_works && checks.yahoo_finance;

  return NextResponse.json({
    status: allGood ? 'ok' : 'degraded',
    checks,
    instructions: allGood ? 'All systems operational' : 'See checks above. Most likely fix: add ANTHROPIC_API_KEY to Vercel Environment Variables → Redeploy.',
  }, { status: allGood ? 200 : 503 });
}
