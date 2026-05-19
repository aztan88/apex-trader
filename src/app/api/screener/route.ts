import { NextRequest, NextResponse } from 'next/server';

// Curated ticker lists per theme — update these as market conditions change
const THEME_TICKERS: Record<string, string[]> = {
  all:         ['NVDA', 'MSFT', 'TSLA', 'AMZN', 'PLTR', 'META', 'GOOGL', 'SHOP'],
  high_return: ['IONQ', 'RKLB', 'SOUN', 'ACHR', 'MSTR', 'ASTS', 'RGTI', 'LUNR'],
  small_cap:   ['CELH', 'RXRX', 'DOCS', 'HIMS', 'TMDX', 'AEHR', 'JOBY', 'CRKN'],
  growth:      ['NVDA', 'CRWD', 'DDOG', 'NET', 'AXON', 'MELI', 'TTD', 'SNOW'],
  value:       ['BRK-B', 'JPM', 'XOM', 'UNH', 'GOOGL', 'MU', 'INTC', 'CVX'],
  ai_tech:     ['NVDA', 'PLTR', 'AI', 'SOUN', 'IONQ', 'ARM', 'SMCI', 'DELL'],
  emerging:    ['MELI', 'SE', 'NU', 'BABA', 'INFY', 'VALE', 'GRAB', 'KE'],
  dividend:    ['O', 'T', 'VZ', 'MO', 'IBM', 'PFE', 'KO', 'JNJ'],
  asx:         ['BHP.AX', 'CBA.AX', 'CSL.AX', 'WDS.AX', 'MQG.AX', 'XRO.AX', 'WBC.AX', 'ANZ.AX'],
  turnaround:  ['INTC', 'NIO', 'BYND', 'WBA', 'SNAP', 'RIVN', 'XPEV', 'LCID'],
  crypto_adj:  ['COIN', 'MSTR', 'MARA', 'RIOT', 'CLSK', 'SQ', 'PYPL', 'HOOD'],
};

export async function GET(req: NextRequest) {
  const theme = req.nextUrl.searchParams.get('theme') ?? 'all';
  const tickers = THEME_TICKERS[theme] ?? THEME_TICKERS.all;
  return NextResponse.json({ tickers, theme });
}
