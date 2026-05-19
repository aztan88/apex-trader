import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type AppMode = 'paper' | 'live';

export interface Position {
  ticker: string; name: string; shares: number; avgPrice: number;
  currentPrice: number; stopLoss: number | null; takeProfit: number | null;
  exchange: string; sector: string; openedAt: number;
  brokerId?: string;
}

export interface Transaction {
  id: string; type: 'buy' | 'sell'; ticker: string; name: string;
  shares: number; price: number; total: number; ts: number;
  source: 'manual' | 'auto' | 'stop' | 'tp';
  mode: AppMode;
  note?: string; orderId?: string; commission?: number;
}

export interface HistoryPoint { ts: number; value: number; mode: AppMode; }

export interface ModeState {
  cash: number;
  positions: Record<string, Position>;
  transactions: Transaction[];
  history: HistoryPoint[];
  startingCash: number;
  dayStartValue: number;
  dayStartTs: number;
}

interface TraderState {
  mode: AppMode;
  paper: ModeState;
  live: ModeState;
  watchlist: string[];

  current: () => ModeState;
  setMode: (mode: AppMode) => void;
  buy: (stock: any, shares: number, stopLoss: number | null, takeProfit: number | null, source?: Transaction['source'], orderId?: string, filledPrice?: number, commission?: number) => boolean;
  sell: (ticker: string, shares: number, price: number, source?: Transaction['source'], note?: string, orderId?: string, commission?: number) => boolean;
  updatePrice: (ticker: string, price: number) => void;
  checkStopsAndTPs: () => { ticker: string; type: 'stop' | 'tp'; price: number; shares: number }[];
  recordHistory: () => void;
  addWatchlist: (ticker: string) => void;
  removeWatchlist: (ticker: string) => void;
  updateLiveCash: (cash: number) => void;
  resetPaper: () => void;
  resetLive: () => void;
}

const PAPER_CASH = 50000;

function freshMode(cash: number, mode: AppMode): ModeState {
  return {
    cash, positions: {}, transactions: [],
    history: [{ ts: Date.now(), value: cash, mode }],
    startingCash: cash, dayStartValue: cash, dayStartTs: Date.now(),
  };
}

function newDayUpdate(s: ModeState): Partial<ModeState> {
  const n = new Date(), d = new Date(s.dayStartTs);
  if (n.getDate() !== d.getDate() || n.getMonth() !== d.getMonth()) {
    const v = s.cash + Object.values(s.positions).reduce((a, p) => a + p.shares * p.currentPrice, 0);
    return { dayStartValue: v, dayStartTs: Date.now() };
  }
  return {};
}

function modeKey(mode: AppMode): 'paper' | 'live' { return mode; }

export const useTraderStore = create<TraderState>()(
  persist(
    (set, get) => ({
      mode: 'paper' as AppMode,
      paper: freshMode(PAPER_CASH, 'paper'),
      live: freshMode(0, 'live'),
      watchlist: [],

      current: () => {
        const s = get();
        return s.mode === 'live' ? s.live : s.paper;
      },

      setMode: (mode) => set({ mode }),

      buy: (stock, shares, stopLoss, takeProfit, source = 'manual', orderId, filledPrice, commission = 0) => {
        const { mode } = get();
        const state = get()[mode];
        const price = filledPrice ?? Number(stock.price ?? stock.currentPrice ?? 0);
        if (!price || price <= 0 || shares <= 0) return false;
        const total = shares * price + (commission ?? 0);
        if (mode === 'paper' && total > state.cash) return false;

        const ex = state.positions[stock.ticker];
        const updPos: Position = ex
          ? { ...ex, shares: ex.shares + shares, avgPrice: (ex.avgPrice * ex.shares + price * shares) / (ex.shares + shares), currentPrice: price, stopLoss: stopLoss ?? ex.stopLoss, takeProfit: takeProfit ?? ex.takeProfit, brokerId: orderId ?? ex.brokerId }
          : { ticker: stock.ticker, name: stock.name ?? stock.ticker, shares, avgPrice: price, currentPrice: price, stopLoss, takeProfit, exchange: stock.exchange ?? '', sector: stock.sector ?? 'Equity', openedAt: Date.now(), brokerId: orderId };

        const tx: Transaction = {
          id: `${mode}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          type: 'buy', ticker: stock.ticker, name: stock.name ?? stock.ticker,
          shares, price, total, ts: Date.now(), source, mode, orderId, commission,
        };

        set({ [modeKey(mode)]: { ...state, cash: state.cash - total, positions: { ...state.positions, [stock.ticker]: updPos }, transactions: [...state.transactions, tx], ...newDayUpdate(state) } });
        get().recordHistory();
        return true;
      },

      sell: (ticker, shares, price, source = 'manual', note, orderId, commission = 0) => {
        const { mode } = get();
        const state = get()[mode];
        const pos = state.positions[ticker];
        if (!pos || pos.shares < shares || price <= 0) return false;
        const net = shares * price - (commission ?? 0);
        const newPos = { ...state.positions };
        const remaining = pos.shares - shares;
        if (remaining <= 0) delete newPos[ticker];
        else newPos[ticker] = { ...pos, shares: remaining };

        const tx: Transaction = {
          id: `${mode}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          type: 'sell', ticker, name: pos.name, shares, price, total: shares * price,
          ts: Date.now(), source, mode, note, orderId, commission,
        };

        set({ [modeKey(mode)]: { ...state, cash: state.cash + net, positions: newPos, transactions: [...state.transactions, tx], ...newDayUpdate(state) } });
        get().recordHistory();
        return true;
      },

      updatePrice: (ticker, price) => {
        if (!price || price <= 0) return;
        const { mode } = get();
        const state = get()[mode];
        const pos = state.positions[ticker];
        if (!pos) return;
        set({ [modeKey(mode)]: { ...state, positions: { ...state.positions, [ticker]: { ...pos, currentPrice: price } } } });
      },

      checkStopsAndTPs: () => {
        const state = get()[get().mode];
        const triggered: { ticker: string; type: 'stop' | 'tp'; price: number; shares: number }[] = [];
        for (const [ticker, pos] of Object.entries(state.positions)) {
          if (pos.stopLoss && pos.currentPrice <= pos.stopLoss) triggered.push({ ticker, type: 'stop', price: pos.currentPrice, shares: pos.shares });
          else if (pos.takeProfit && pos.currentPrice >= pos.takeProfit) triggered.push({ ticker, type: 'tp', price: pos.currentPrice, shares: pos.shares });
        }
        triggered.forEach(({ ticker, type, price, shares }) => {
          get().sell(ticker, shares, price, type, type === 'stop' ? 'Stop loss triggered' : 'Take profit hit');
        });
        return triggered;
      },

      recordHistory: () => {
        const { mode } = get();
        const state = get()[mode];
        const value = state.cash + Object.values(state.positions).reduce((s, p) => s + p.shares * p.currentPrice, 0);
        set({ [modeKey(mode)]: { ...state, history: [...state.history.slice(-2000), { ts: Date.now(), value, mode }] } });
      },

      addWatchlist: (ticker) => set(s => ({ watchlist: s.watchlist.includes(ticker) ? s.watchlist : [...s.watchlist, ticker] })),
      removeWatchlist: (ticker) => set(s => ({ watchlist: s.watchlist.filter(t => t !== ticker) })),
      updateLiveCash: (cash) => set(s => ({ live: { ...s.live, cash, startingCash: s.live.startingCash === 0 ? cash : s.live.startingCash, dayStartValue: s.live.dayStartValue === 0 ? cash : s.live.dayStartValue } })),
      resetPaper: () => set({ paper: freshMode(PAPER_CASH, 'paper') }),
      resetLive: () => set({ live: freshMode(0, 'live') }),
    }),
    {
      name: 'apex-trader-v3',
      partialize: (s) => ({ mode: s.mode, paper: s.paper, live: s.live, watchlist: s.watchlist }),
    }
  )
);

export function getPortfolioValue(s: ModeState): number {
  return s.cash + Object.values(s.positions).reduce((a, p) => a + p.shares * p.currentPrice, 0);
}
export function getDayPnl(s: ModeState): number {
  return getPortfolioValue(s) - s.dayStartValue;
}
