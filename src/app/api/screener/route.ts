import { NextRequest, NextResponse } from 'next/server';

const THEME_TICKERS: Record<string, string[]> = {
  all:         ['NVDA','MSFT','TSLA','AMZN','PLTR','META','GOOGL','AAPL','SHOP','CRWD','AXON','MELI'],
  high_return: ['IONQ','RKLB','SOUN','ACHR','MSTR','ASTS','RGTI','LUNR','OKLO','JOBY','ARQT','HIMS'],
  small_cap:   ['CELH','RXRX','DOCS','HIMS','TMDX','AEHR','JOBY','CRKN','ACHR','GFAI','SOUN','ARQT'],
  growth:      ['NVDA','CRWD','DDOG','NET','AXON','MELI','TTD','SNOW','BILL','GTLB','DUOL','CELH'],
  value:       ['BRK-B','JPM','XOM','UNH','GOOGL','MU','INTC','CVX','WFC','BAC','VZ','T'],
  ai_tech:     ['NVDA','PLTR','AI','SOUN','IONQ','ARM','SMCI','DELL','MSFT','GOOG','META','AMZN'],
  emerging:    ['MELI','SE','NU','BABA','INFY','VALE','GRAB','KE','TCOM','JD','PDD','BRFS'],
  dividend:    ['O','T','VZ','MO','IBM','PFE','KO','JNJ','ABBV','PM','MMM','CVX'],
  asx:         ['BHP.AX','CBA.AX','CSL.AX','WDS.AX','MQG.AX','XRO.AX','WBC.AX','ANZ.AX','NAB.AX','RIO.AX','FMG.AX','WES.AX'],
  turnaround:  ['INTC','NIO','BYND','WBA','SNAP','RIVN','XPEV','LCID','PARA','OPEN','WISH','BBBY'],
  crypto_adj:  ['COIN','MSTR','MARA','RIOT','CLSK','SQ','PYPL','HOOD','BTBT','HUT','CIFR','CORZ'],
};

export async function GET(req: NextRequest) {
  const theme = req.nextUrl.searchParams.get('theme') ?? 'all';
  const tickers = THEME_TICKERS[theme] ?? THEME_TICKERS.all;
  return NextResponse.json({ tickers, theme, count: tickers.length });
}
