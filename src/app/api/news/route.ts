import { NextRequest, NextResponse } from 'next/server';
import { groq } from '@/lib/groq';

const newsCache = new Map<string, { data: NewsResult; ts: number }>();
const CACHE_TTL = 30 * 60 * 1000; // 30 min cache

export interface NewsItem {
  title: string;
  source: string;
  url: string;
  publishedAt: string;
  sentiment: 'positive' | 'negative' | 'neutral';
}

export interface NewsResult {
  ticker: string;
  name: string;
  overallSentiment: 'Bullish' | 'Bearish' | 'Neutral' | 'Mixed';
  sentimentScore: number; // -100 to +100
  summary: string;
  keyPoints: string[];
  catalysts: string[];
  risks: string[];
  redditMood: string;
  analystConsensus: string;
  priceTargets: { low: number; median: number; high: number; currency: string };
  news: NewsItem[];
}

// Fetch from NewsAPI (free tier: 100 req/day)
async function fetchNewsAPI(ticker: string, name: string): Promise<NewsItem[]> {
  const key = process.env.NEWS_API_KEY;
  if (!key) return [];
  try {
    const q = encodeURIComponent(`${name} OR ${ticker} stock`);
    const res = await fetch(
      `https://newsapi.org/v2/everything?q=${q}&language=en&sortBy=publishedAt&pageSize=10&apiKey=${key}`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.articles ?? []).slice(0, 8).map((a: any) => ({
      title: a.title ?? '',
      source: a.source?.name ?? 'Unknown',
      url: a.url ?? '',
      publishedAt: a.publishedAt ?? '',
      sentiment: 'neutral' as const,
    }));
  } catch { return []; }
}

// AI sentiment analysis with Groq
async function analyseWithAI(ticker: string, name: string, price: number, headlines: string[]): Promise<NewsResult> {
  const headlineStr = headlines.length > 0
    ? headlines.slice(0, 8).map((h, i) => `${i + 1}. ${h}`).join('\n')
    : `No recent headlines available for ${name}.`;

  const prompt = `Analyse market sentiment for ${name} (${ticker}) at $${price}.

Recent headlines:
${headlineStr}

Return pipe-delimited on ONE line (no newlines in fields):
SENTIMENT|SCORE|SUMMARY|POINT1|POINT2|POINT3|CATALYST1|CATALYST2|RISK1|RISK2|REDDIT_MOOD|ANALYST_CONSENSUS|TARGET_LOW|TARGET_MED|TARGET_HIGH

SENTIMENT = Bullish|Bearish|Neutral|Mixed
SCORE = integer -100 to +100 (positive=bullish)
SUMMARY = 20 word market sentiment summary
POINT1-3 = key market insight max 12 words each
CATALYST1-2 = near-term price catalyst max 8 words each  
RISK1-2 = key risk factor max 8 words each
REDDIT_MOOD = one of: Very Bullish|Bullish|Neutral|Bearish|Very Bearish
ANALYST_CONSENSUS = one of: Strong Buy|Buy|Hold|Sell|Strong Sell
TARGET_LOW = analyst price target low (number)
TARGET_MED = analyst price target median (number)
TARGET_HIGH = analyst price target high (number)`;

  try {
    const txt = await groq('Financial sentiment analyst. Return only the pipe-delimited line.', prompt, 300);
    const p = txt.replace(/\n/g, '').trim().split('|');

    const sentMap: Record<string, NewsResult['overallSentiment']> = {
      Bullish: 'Bullish', Bearish: 'Bearish', Neutral: 'Neutral', Mixed: 'Mixed',
    };

    return {
      ticker,
      name,
      overallSentiment: sentMap[p[0]?.trim()] ?? 'Neutral',
      sentimentScore: Math.min(100, Math.max(-100, parseInt(p[1]) || 0)),
      summary: p[2]?.trim() || 'Insufficient data for sentiment analysis.',
      keyPoints: [p[3], p[4], p[5]].map(s => s?.trim()).filter(Boolean),
      catalysts: [p[6], p[7]].map(s => s?.trim()).filter(Boolean),
      risks: [p[8], p[9]].map(s => s?.trim()).filter(Boolean),
      redditMood: p[10]?.trim() || 'Neutral',
      analystConsensus: p[11]?.trim() || 'Hold',
      priceTargets: {
        low: parseFloat(p[12]) || price * 0.85,
        median: parseFloat(p[13]) || price * 1.1,
        high: parseFloat(p[14]) || price * 1.35,
        currency: 'USD',
      },
      news: [],
    };
  } catch (e: any) {
    return {
      ticker, name,
      overallSentiment: 'Neutral', sentimentScore: 0,
      summary: 'Sentiment analysis temporarily unavailable.',
      keyPoints: [], catalysts: [], risks: [],
      redditMood: 'Neutral', analystConsensus: 'Hold',
      priceTargets: { low: price * 0.85, median: price, high: price * 1.2, currency: 'USD' },
      news: [],
    };
  }
}

export async function GET(req: NextRequest) {
  const ticker = (req.nextUrl.searchParams.get('ticker') ?? '').toUpperCase().slice(0, 10);
  const name = (req.nextUrl.searchParams.get('name') ?? ticker).slice(0, 80);
  const price = parseFloat(req.nextUrl.searchParams.get('price') ?? '0');

  if (!ticker) return NextResponse.json({ error: 'ticker required' }, { status: 400 });

  const cached = newsCache.get(ticker);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return NextResponse.json({ ...cached.data, cached: true });
  }

  // Fetch news headlines and AI analysis in parallel
  const [newsItems, aiResult] = await Promise.all([
    fetchNewsAPI(ticker, name),
    analyseWithAI(ticker, name, price || 100, []),
  ]);

  // Re-run AI with actual headlines if we got some
  let result = aiResult;
  if (newsItems.length > 0) {
    const headlines = newsItems.map(n => n.title);
    result = await analyseWithAI(ticker, name, price || 100, headlines);
    result.news = newsItems;
  }

  newsCache.set(ticker, { data: result, ts: Date.now() });
  return NextResponse.json(result, {
    headers: { 'Cache-Control': 's-maxage=1800, stale-while-revalidate=300' },
  });
}
