import { NextResponse } from 'next/server';

export async function GET() {
  const checks: Record<string, any> = {};

  // Check 1: Gemini key present
  checks.gemini_key_set = !!process.env.GEMINI_API_KEY;

  // Check 2: Test Gemini API works
  if (checks.gemini_key_set) {
    try {
      const { geminiSimple } = await import('@/lib/gemini');
      const result = await geminiSimple('Reply with the single word: ok', 10);
      checks.gemini_api_works = result.toLowerCase().includes('ok');
      checks.gemini_response = result.trim().slice(0,20);
    } catch (e: any) {
      checks.gemini_api_works = false;
      checks.gemini_error = e.message?.slice(0,100);
    }
  } else {
    checks.gemini_api_works = false;
    checks.gemini_error = 'GEMINI_API_KEY not set in Vercel Environment Variables';
  }

  // Check 3: Yahoo Finance
  try {
    const yf = await import('yahoo-finance2');
    const lib = (yf.default ?? yf) as any;
    const quote = await lib.quote('AAPL', {}, { validateResult: false });
    checks.yahoo_finance = (quote?.regularMarketPrice ?? 0) > 0;
    checks.aapl_price = quote?.regularMarketPrice ?? null;
  } catch (e: any) {
    checks.yahoo_finance = false;
    checks.yahoo_error = e.message?.slice(0,100);
  }

  // Check 4: Optional
  checks.alpha_vantage_set = !!process.env.ALPHA_VANTAGE_KEY;
  checks.finnhub_set = !!process.env.FINNHUB_KEY;
  checks.broker = process.env.BROKER ?? 'paper';

  const ok = checks.gemini_api_works && checks.yahoo_finance;
  return NextResponse.json({
    status: ok ? 'ok' : 'degraded',
    checks,
    message: ok ? 'All systems operational' : 'See checks above for what needs fixing',
  }, { status: ok ? 200 : 503 });
}
