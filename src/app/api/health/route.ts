import { NextResponse } from 'next/server';

export async function GET() {
  const checks: Record<string, any> = {};

  checks.groq_key_set = !!process.env.GROQ_API_KEY;

  if (checks.groq_key_set) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.GROQ_API_KEY}` },
        body: JSON.stringify({ model: 'llama-3.3-70b-versatile', max_tokens: 5, messages: [{ role: 'user', content: 'ping' }] }),
      });
      checks.groq_api_works = res.ok;
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        checks.groq_error = (err as any)?.error?.message ?? `HTTP ${res.status}`;
      }
    } catch (e: any) {
      checks.groq_api_works = false;
      checks.groq_error = e.message?.slice(0,100);
    }
  } else {
    checks.groq_api_works = false;
    checks.groq_error = 'GROQ_API_KEY not set in Vercel Environment Variables';
  }

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

  checks.gemini_key_set = !!process.env.GEMINI_API_KEY;
  checks.alpha_vantage_set = !!process.env.ALPHA_VANTAGE_KEY;
  checks.broker = process.env.BROKER ?? 'paper';

  const ok = checks.groq_api_works && checks.yahoo_finance;
  return NextResponse.json({
    status: ok ? 'ok' : 'degraded',
    checks,
    message: ok ? 'All systems operational' : 'See checks above',
  }, { status: ok ? 200 : 503 });
}
