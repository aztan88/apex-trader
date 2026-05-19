// ─────────────────────────────────────────────────────────────────────────────
// Broker abstraction layer
// Swap brokers without changing any UI code.
// ─────────────────────────────────────────────────────────────────────────────

export type BrokerName = 'paper' | 'ibkr' | 'alpaca';

export interface OrderRequest {
  ticker: string;
  side: 'buy' | 'sell';
  shares: number;
  orderType: 'market' | 'limit';
  limitPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
}

export interface OrderResult {
  success: boolean;
  orderId?: string;
  filledPrice?: number;
  filledShares?: number;
  filledAt?: number;
  broker: BrokerName;
  error?: string;
  raw?: any;
}

export interface BrokerAccount {
  broker: BrokerName;
  accountId: string;
  cashBalance: number;
  buyingPower: number;
  currency: string;
  connected: boolean;
  error?: string;
}

// ─── IBKR Client Portal API ──────────────────────────────────────────────────
// IBKR Client Portal runs locally on port 5000 (or via their gateway)
// Set IBKR_GATEWAY_URL in env to point to your gateway instance
async function ibkrGetAccount(): Promise<BrokerAccount> {
  const base = process.env.IBKR_GATEWAY_URL ?? 'https://localhost:5000/v1/api';
  try {
    const [summaryRes, accountRes] = await Promise.all([
      fetch(`${base}/portfolio/summary`, { headers: { 'Content-Type': 'application/json' } }),
      fetch(`${base}/portfolio/accounts`),
    ]);
    if (!summaryRes.ok) throw new Error(`IBKR summary: ${summaryRes.status}`);
    const accounts = await accountRes.json();
    const accountId = accounts[0]?.accountId ?? '';
    const summary = await summaryRes.json();
    const cash = summary?.availablefunds?.value ?? 0;
    const buyingPower = summary?.buyingpower?.value ?? 0;
    return { broker: 'ibkr', accountId, cashBalance: parseFloat(cash), buyingPower: parseFloat(buyingPower), currency: 'USD', connected: true };
  } catch (e: any) {
    return { broker: 'ibkr', accountId: '', cashBalance: 0, buyingPower: 0, currency: 'USD', connected: false, error: e.message };
  }
}

async function ibkrPlaceOrder(order: OrderRequest): Promise<OrderResult> {
  const base = process.env.IBKR_GATEWAY_URL ?? 'https://localhost:5000/v1/api';
  try {
    const accounts = await fetch(`${base}/portfolio/accounts`);
    const accts = await accounts.json();
    const accountId = accts[0]?.accountId;
    if (!accountId) throw new Error('No IBKR account found');

    // Search for contract ID
    const searchRes = await fetch(`${base}/iserver/secdef/search?symbol=${order.ticker}&secType=STK`);
    const searchData = await searchRes.json();
    const conid = searchData[0]?.conid;
    if (!conid) throw new Error(`No contract found for ${order.ticker}`);

    const orderBody = {
      acctId: accountId,
      conid,
      orderType: order.orderType === 'limit' ? 'LMT' : 'MKT',
      side: order.side === 'buy' ? 'BUY' : 'SELL',
      quantity: order.shares,
      tif: 'DAY',
      ...(order.orderType === 'limit' && { price: order.limitPrice }),
    };

    const placeRes = await fetch(`${base}/iserver/account/${accountId}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orders: [orderBody] }),
    });
    const placeData = await placeRes.json();

    if (placeData[0]?.order_status === 'PreSubmitted' || placeData[0]?.order_id) {
      return {
        success: true,
        orderId: String(placeData[0].order_id ?? placeData[0].orderId),
        broker: 'ibkr',
        raw: placeData[0],
      };
    }
    // IBKR sometimes returns a confirmation challenge
    if (placeData[0]?.messageIds) {
      const confirmRes = await fetch(`${base}/iserver/reply/${placeData[0].messageIds[0]}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmed: true }),
      });
      const confirmData = await confirmRes.json();
      return { success: true, orderId: String(confirmData[0]?.order_id), broker: 'ibkr', raw: confirmData };
    }
    throw new Error(JSON.stringify(placeData));
  } catch (e: any) {
    return { success: false, broker: 'ibkr', error: e.message };
  }
}

// ─── Alpaca API ───────────────────────────────────────────────────────────────
async function alpacaGetAccount(): Promise<BrokerAccount> {
  const key = process.env.ALPACA_KEY;
  const secret = process.env.ALPACA_SECRET;
  const base = process.env.ALPACA_PAPER === 'true'
    ? 'https://paper-api.alpaca.markets'
    : 'https://api.alpaca.markets';
  if (!key || !secret) {
    return { broker: 'alpaca', accountId: '', cashBalance: 0, buyingPower: 0, currency: 'USD', connected: false, error: 'ALPACA_KEY and ALPACA_SECRET not set' };
  }
  try {
    const res = await fetch(`${base}/v2/account`, {
      headers: { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret },
    });
    if (!res.ok) throw new Error(`Alpaca account: ${res.status}`);
    const data = await res.json();
    return {
      broker: 'alpaca',
      accountId: data.account_number ?? '',
      cashBalance: parseFloat(data.cash ?? '0'),
      buyingPower: parseFloat(data.buying_power ?? '0'),
      currency: 'USD',
      connected: true,
    };
  } catch (e: any) {
    return { broker: 'alpaca', accountId: '', cashBalance: 0, buyingPower: 0, currency: 'USD', connected: false, error: e.message };
  }
}

async function alpacaPlaceOrder(order: OrderRequest): Promise<OrderResult> {
  const key = process.env.ALPACA_KEY!;
  const secret = process.env.ALPACA_SECRET!;
  const base = process.env.ALPACA_PAPER === 'true'
    ? 'https://paper-api.alpaca.markets'
    : 'https://api.alpaca.markets';
  try {
    const body: any = {
      symbol: order.ticker,
      qty: String(order.shares),
      side: order.side,
      type: order.orderType,
      time_in_force: 'day',
      ...(order.orderType === 'limit' && { limit_price: String(order.limitPrice) }),
    };
    // Attach bracket legs if stop/take provided
    if (order.stopLoss || order.takeProfit) {
      body.order_class = 'bracket';
      if (order.stopLoss) body.stop_loss = { stop_price: String(order.stopLoss) };
      if (order.takeProfit) body.take_profit = { limit_price: String(order.takeProfit) };
    }
    const res = await fetch(`${base}/v2/orders`, {
      method: 'POST',
      headers: {
        'APCA-API-KEY-ID': key,
        'APCA-API-SECRET-KEY': secret,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message ?? res.statusText);
    }
    const data = await res.json();
    return {
      success: true,
      orderId: data.id,
      filledPrice: parseFloat(data.filled_avg_price ?? '0') || undefined,
      filledShares: parseInt(data.filled_qty ?? '0') || undefined,
      broker: 'alpaca',
      raw: data,
    };
  } catch (e: any) {
    return { success: false, broker: 'alpaca', error: e.message };
  }
}

// ─── Paper broker (always succeeds, instant fill) ─────────────────────────────
function paperPlaceOrder(order: OrderRequest, currentPrice: number): OrderResult {
  return {
    success: true,
    orderId: `PAPER-${Date.now()}`,
    filledPrice: currentPrice,
    filledShares: order.shares,
    filledAt: Date.now(),
    broker: 'paper',
  };
}

// ─── Public interface ─────────────────────────────────────────────────────────
export function getBrokerName(): BrokerName {
  if (process.env.BROKER === 'ibkr') return 'ibkr';
  if (process.env.BROKER === 'alpaca') return 'alpaca';
  return 'paper';
}

export async function getAccount(): Promise<BrokerAccount> {
  const broker = getBrokerName();
  if (broker === 'ibkr') return ibkrGetAccount();
  if (broker === 'alpaca') return alpacaGetAccount();
  return { broker: 'paper', accountId: 'PAPER', cashBalance: 0, buyingPower: 0, currency: 'USD', connected: true };
}

export async function placeOrder(order: OrderRequest, currentPrice: number): Promise<OrderResult> {
  const broker = getBrokerName();
  if (broker === 'ibkr') return ibkrPlaceOrder(order);
  if (broker === 'alpaca') return alpacaPlaceOrder(order);
  return paperPlaceOrder(order, currentPrice);
}
