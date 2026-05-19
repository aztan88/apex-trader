// All API calls go through Next.js server routes — no CORS issues, real data

export async function fetchPrices(tickers: string[]): Promise<Record<string, any>> {
  if (!tickers.length) return {};
  const params = new URLSearchParams({ tickers: tickers.join(',') });
  const res = await fetch(`/api/prices?${params}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Prices API ${res.status}`);
  return res.json();
}

export async function fetchSignals(
  ticker: string, price: number, name: string,
  extras: { change52w?: number; marketCap?: string; sector?: string; exchange?: string; high52w?: number; low52w?: number; } = {}
): Promise<any> {
  const params = new URLSearchParams({
    ticker, price: price.toString(), name,
    change52w: (extras.change52w ?? 0).toString(),
    marketCap: extras.marketCap ?? 'N/A',
    sector: extras.sector ?? 'Equity',
    exchange: extras.exchange ?? 'NYSE',
    high52w: (extras.high52w ?? 0).toString(),
    low52w: (extras.low52w ?? 0).toString(),
  });
  const res = await fetch(`/api/signals?${params}`);
  if (!res.ok) throw new Error(`Signals API ${res.status}`);
  return res.json();
}

export async function fetchAnalysis(ticker: string, name: string, price: number, signals: any, mktData: any): Promise<string> {
  const params = new URLSearchParams({
    ticker, name, price: price.toString(),
    entry: (signals?.entryPrice ?? price).toString(),
    stop: (signals?.stopLoss ?? '').toString(),
    target: (signals?.targetPrice ?? '').toString(),
    rsi: (signals?.rsiEstimate ?? 50).toString(),
    macd: signals?.macdSignal ?? 'Neutral',
    mktCap: mktData?.marketCap ?? 'N/A',
    change52w: (mktData?.change52w ?? 0).toString(),
  });
  const res = await fetch(`/api/analysis?${params}`);
  if (!res.ok) throw new Error(`Analysis API ${res.status}`);
  const data = await res.json();
  return data.analysis ?? data.error ?? '';
}

export async function fetchScreenerTickers(theme: string): Promise<string[]> {
  const res = await fetch(`/api/screener?theme=${encodeURIComponent(theme)}`);
  if (!res.ok) return [];
  return (await res.json()).tickers ?? [];
}

export async function askCoach(question: string, portfolioContext?: string): Promise<{ reply: string; tokens: number }> {
  const res = await fetch('/api/coach', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, portfolioContext }),
  });
  if (!res.ok) throw new Error(`Coach API ${res.status}`);
  const data = await res.json();
  return { reply: data.reply ?? '', tokens: (data.inputTokens ?? 0) + (data.outputTokens ?? 0) };
}
