import { NextRequest, NextResponse } from 'next/server';
import { groqSimple } from '@/lib/groq';

const TICKER_MAP: Record<string, string[]> = {
  apple:['AAPL'],microsoft:['MSFT'],google:['GOOGL'],alphabet:['GOOGL'],amazon:['AMZN'],
  meta:['META'],facebook:['META'],nvidia:['NVDA'],tesla:['TSLA'],netflix:['NFLX'],
  adobe:['ADBE'],salesforce:['CRM'],palantir:['PLTR'],shopify:['SHOP'],snowflake:['SNOW'],
  datadog:['DDOG'],cloudflare:['NET'],crowdstrike:['CRWD'],arm:['ARM'],intel:['INTC'],
  amd:['AMD'],qualcomm:['QCOM'],broadcom:['AVGO'],micron:['MU'],dell:['DELL'],
  oracle:['ORCL'],servicenow:['NOW'],workday:['WDAY'],zoom:['ZM'],uber:['UBER'],
  airbnb:['ABNB'],doordash:['DASH'],coinbase:['COIN'],robinhood:['HOOD'],
  paypal:['PYPL'],block:['SQ'],jpmorgan:['JPM'],visa:['V'],mastercard:['MA'],
  pfizer:['PFE'],moderna:['MRNA'],johnson:['JNJ'],abbvie:['ABBV'],
  unitedhealth:['UNH'],walmart:['WMT'],costco:['COST'],nike:['NKE'],disney:['DIS'],
  exxon:['XOM'],chevron:['CVX'],berkshire:['BRK-B'],blackrock:['BLK'],
  bhp:['BHP.AX'],commbank:['CBA.AX'],cba:['CBA.AX'],csl:['CSL.AX'],
  westpac:['WBC.AX'],anz:['ANZ.AX'],nab:['NAB.AX'],macquarie:['MQG.AX'],
  woodside:['WDS.AX'],xero:['XRO.AX'],weebit:['WBT.AX'],
  bitcoin:['BTC-USD'],ethereum:['ETH-USD'],solana:['SOL-USD'],
  xrp:['XRP-USD'],dogecoin:['DOGE-USD'],
  spy:['SPY'],qqq:['QQQ'],voo:['VOO'],
  'ai stocks':['NVDA','PLTR','AI','SOUN','IONQ'],
  'ev stocks':['TSLA','RIVN','LCID','NIO'],
  'bank stocks':['JPM','BAC','WFC','GS','MS'],
  'tech stocks':['AAPL','MSFT','GOOGL','META','NVDA'],
  'asx stocks':['BHP.AX','CBA.AX','CSL.AX','WDS.AX','MQG.AX'],
  'crypto stocks':['COIN','MSTR','MARA','RIOT','CLSK'],
  'dividend stocks':['O','T','VZ','KO','JNJ'],
  lithium:['PLL','SQM','ALB','LTHM'],
  semiconductors:['NVDA','AMD','INTC','QCOM','AVGO'],
  biotech:['MRNA','RXRX','CRSP','BEAM','EXAS'],
  fintech:['SQ','PYPL','COIN','HOOD','AFRM'],
  gold:['GLD','GDX','NEM'],oil:['XOM','CVX','COP'],
};

function staticLookup(q: string): string[] | null {
  const low = q.toLowerCase().trim();
  if (/^[A-Z0-9.\-]{1,10}$/i.test(low.toUpperCase())) return [low.toUpperCase()];
  if (TICKER_MAP[low]) return TICKER_MAP[low];
  const hits: string[] = [];
  for (const [k, v] of Object.entries(TICKER_MAP)) {
    if (k.includes(low) || low.includes(k)) hits.push(...v);
  }
  return hits.length > 0 ? [...new Set(hits)].slice(0,6) : null;
}

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
  if (!q) return NextResponse.json({ tickers: [], error: 'No query' }, { status: 400 });

  const found = staticLookup(q);
  if (found) return NextResponse.json({ tickers: found, source: 'static' });

  try {
    const txt = await groqSimple(
      `List up to 6 stock tickers for: "${q}". Yahoo Finance format (AAPL, BHP.AX, BTC-USD). Comma-separated only, nothing else.`,
      60
    );
    const tickers = txt.replace(/[^A-Z0-9.,\-]/gi,' ').split(/[\s,]+/)
      .map((t:string) => t.trim().toUpperCase()).filter((t:string) => t.length >= 1 && t.length <= 10).slice(0,6);
    return NextResponse.json({ tickers: tickers.length ? tickers : [], source: 'groq' });
  } catch (e: any) {
    return NextResponse.json({ tickers: [], error: e.message }, { status: 500 });
  }
}
