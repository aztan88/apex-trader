import { NextResponse } from 'next/server';

export async function GET() {
  const checks: Record<string, any> = {};

  // Check 1: Groq API
  checks.groq_key_set = !!process.env.GROQ_API_KEY;
  if (checks.groq_key_set) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.GROQ_API_KEY}` },
        body: JSON.stringify({ model: 'llama-3.3-70b-versatile', max_tokens: 5, messages: [{ role: 'user', content: 'ping' }] }),
      });
      checks.groq_api_works = res.ok;
      if (!res.ok) checks.groq_error = `HTTP ${res.status}`;
    } catch (e: any) {
      checks.groq_api_works = false;
      checks.groq_error = e.message?.slice(0, 100);
    }
  } else {
    checks.groq_api_works = false;
    checks.groq_error = 'GROQ_API_KEY not set in Vercel Environment Variables';
  }

  // Check 2: Yahoo Finance direct API
  try {
    const res = await fetch(
      'https://query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=1d&range=5d',
      { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ApexTrader/1.0)' }, signal: AbortSignal.timeout(8000) }
    );
    if (res.ok) {
      const data = await res.json();
      const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
      checks.yahoo_finance = !!price && price > 0;
      checks.aapl_price = price ?? null;
    } else {
      checks.yahoo_finance = false;
      checks.yahoo_error = `HTTP ${res.status}`;
    }
  } catch (e: any) {
    checks.yahoo_finance = false;
    checks.yahoo_error = e.message?.slice(0, 100);
  }

  checks.alpha_vantage_set = !!process.env.ALPHA_VANTAGE_KEY;
  checks.twelve_data_set = !!process.env.TWELVE_DATA_KEY;
  checks.broker = process.env.BROKER ?? 'paper';

  const ok = checks.groq_api_works && checks.yahoo_finance;
  return NextResponse.json({
    status: ok ? 'ok' : 'degraded',
    checks,
    message: ok ? 'All systems operational' : 'See checks above',
  }, { status: ok ? 200 : 503 });
}
