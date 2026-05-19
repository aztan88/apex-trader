import { NextRequest, NextResponse } from 'next/server';
import { placeOrder, getAccount, getBrokerName, type OrderRequest } from '@/lib/broker';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { ticker, side, shares, orderType, limitPrice, stopLoss, takeProfit, currentPrice, mode } = body;

    // Validate
    if (!ticker || !side || !shares || shares <= 0) {
      return NextResponse.json({ error: 'ticker, side, and shares are required' }, { status: 400 });
    }
    if (!['buy', 'sell'].includes(side)) {
      return NextResponse.json({ error: 'side must be buy or sell' }, { status: 400 });
    }

    // Paper mode always routes to paper broker regardless of env var
    if (mode === 'paper') {
      return NextResponse.json({
        success: true,
        orderId: `PAPER-${Date.now()}`,
        filledPrice: currentPrice ?? limitPrice ?? 0,
        filledShares: shares,
        filledAt: Date.now(),
        broker: 'paper',
        mode: 'paper',
      });
    }

    // Live mode — route to configured broker
    const broker = getBrokerName();
    if (broker === 'paper') {
      return NextResponse.json({
        error: 'No live broker configured. Set BROKER=ibkr or BROKER=alpaca in environment variables.',
        broker: 'paper',
      }, { status: 400 });
    }

    const order: OrderRequest = {
      ticker: ticker.toUpperCase(),
      side, shares, orderType: orderType ?? 'market',
      limitPrice, stopLoss, takeProfit,
    };

    const result = await placeOrder(order, currentPrice ?? 0);

    if (!result.success) {
      return NextResponse.json({ error: result.error, broker: result.broker }, { status: 422 });
    }

    return NextResponse.json({ ...result, mode: 'live' });
  } catch (e: any) {
    console.error('[trade] Error:', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// GET /api/trade — returns current broker status and account info
export async function GET() {
  try {
    const broker = getBrokerName();
    const account = await getAccount();
    return NextResponse.json({
      broker,
      mode: broker === 'paper' ? 'paper' : 'live',
      account,
      configured: {
        ibkr: !!process.env.IBKR_GATEWAY_URL,
        alpaca: !!(process.env.ALPACA_KEY && process.env.ALPACA_SECRET),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
