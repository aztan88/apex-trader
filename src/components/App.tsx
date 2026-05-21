'use client';
import {
  useState, useEffect, useCallback, useRef, useMemo
} from 'react';
import { useTraderStore, getPortfolioValue, getDayPnl, type AppMode } from '@/lib/store';
import { fetchPrices, fetchSignals, fetchAnalysis, fetchScreenerTickers, askCoach } from '@/lib/api';
import { ModeSwitcher, ValidationScreen } from '@/components/ModeSwitcher';

// ── Helpers ───────────────────────────────────────────────────────────────────
const r2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number, d = 2) =>
  Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtC = (n: number) => '$' + fmt(Math.abs(n));
const pct = (n: number) => (n >= 0 ? '+' : '') + fmt(n) + '%';
const recCls = (r: string) => ({
  'Strong Buy': 'bg-green-500/10 text-green-400 border-green-500/20',
  'Buy': 'bg-green-500/10 text-green-400 border-green-500/20',
  'Hold': 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  'Speculative Buy': 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  'Sell': 'bg-red-500/10 text-red-400 border-red-500/20',
} as Record<string,string>)[r] ?? 'bg-white/5 text-white/60 border-white/10';
const riskCls = (r: string) => ({
  Low: 'text-green-400', Medium: 'text-amber-400', High: 'text-red-400', 'Very High': 'text-red-500'
} as Record<string,string>)[r] ?? 'text-white/40';

const THEMES = [
  { id: 'all', label: '🌐 All Opportunities' },
  { id: 'high_return', label: '🔥 High Potential Returns' },
  { id: 'small_cap', label: '🔬 Hidden Small Caps' },
  { id: 'growth', label: '🚀 High Growth' },
  { id: 'value', label: '💎 Deep Value' },
  { id: 'ai_tech', label: '🤖 AI & Tech' },
  { id: 'emerging', label: '🌏 Emerging Markets' },
  { id: 'dividend', label: '💰 Income & Dividend' },
  { id: 'asx', label: '🦘 ASX Listed' },
  { id: 'turnaround', label: '🔄 Turnaround Plays' },
  { id: 'crypto_adj', label: '₿ Crypto Adjacent' },
];

interface StockCard {
  ticker: string; name: string; price: number; change1d: number; change52w: number;
  marketCap: string; currency: string; exchange: string; sector: string;
  source: string; history: number[]; high52w: number; low52w: number; volume: number;
  conviction: number; upside: number; recommendation: string; riskLevel: string;
  rsiEstimate: number; macdSignal: string; trend: string; candleSignal: string;
  entryPrice: number; stopLoss: number; targetPrice: number;
  thesis: string; risks: string; catalysts: string[];
}

// ── Error Boundary (FIX #21) ─────────────────────────────────────────────────
import React from 'react';
class ErrorBoundary extends React.Component<{children: React.ReactNode}, {error: string | null}> {
  constructor(props: any) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e: Error) { return { error: e.message }; }
  render() {
    if (this.state.error) return (
      <div className="flex items-center justify-center h-screen bg-[#080810] text-red-400 p-8 text-center">
        <div>
          <div className="text-4xl mb-4">⚠️</div>
          <div className="font-serif text-xl mb-2">Something went wrong</div>
          <p className="text-white/50 text-sm mb-4">{this.state.error}</p>
          <button onClick={() => { this.setState({error:null}); window.location.reload(); }}
            className="px-4 py-2 bg-green-500 text-black rounded-lg text-sm font-medium">Reload</button>
        </div>
      </div>
    );
    return this.props.children;
  }
}

// ── Skeleton card (FIX #14) ───────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div className="rounded-xl p-4 border border-white/5 bg-[#13131f] animate-pulse">
      <div className="flex justify-between mb-3">
        <div className="h-6 w-20 bg-white/10 rounded-md" />
        <div className="h-5 w-16 bg-white/5 rounded-full" />
      </div>
      <div className="h-3 w-32 bg-white/5 rounded mb-3" />
      <div className="h-7 w-24 bg-white/10 rounded mb-3" />
      <div className="grid grid-cols-3 gap-1.5 mb-3">
        {[0,1,2].map(i => <div key={i} className="h-12 bg-white/5 rounded-lg" />)}
      </div>
      <div className="h-3 w-full bg-white/5 rounded mb-1.5" />
      <div className="h-3 w-3/4 bg-white/5 rounded" />
    </div>
  );
}

// ── Sparkline ─────────────────────────────────────────────────────────────────
function Sparkline({ data, positive }: { data: number[]; positive: boolean }) {
  if (data.length < 2) return <div className="w-20 h-8" />;
  const min = Math.min(...data), max = Math.max(...data), range = max - min || 1;
  const w = 80, h = 32;
  const pts = data.map((v, i) =>
    `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`
  ).join(' ');
  return (
    <svg width={w} height={h} className="overflow-visible flex-shrink-0">
      <polyline points={pts} fill="none" stroke={positive ? '#00d48a' : '#ff3d5a'} strokeWidth="1.5" />
    </svg>
  );
}

// ── Conviction dots ───────────────────────────────────────────────────────────
function Dots({ n }: { n: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({length:10},(_,i) => (
        <div key={i} className={`w-1.5 h-1.5 rounded-sm ${i < n ? 'bg-green-400' : 'bg-white/10'}`} />
      ))}
    </div>
  );
}

// ── Position size helper (FIX #10) ────────────────────────────────────────────
function PositionSizer({ price, cash, portfolioValue }: { price: number; cash: number; portfolioValue: number }) {
  const [pctInput, setPctInput] = useState('5');
  const pctVal = parseFloat(pctInput) || 0;
  const shares = Math.max(1, Math.floor((portfolioValue * pctVal / 100) / price));
  const cost = shares * price;
  const affordable = cost <= cash;
  return (
    <div className="bg-[#1f1f2e] rounded-lg p-3 mb-3">
      <div className="text-[10px] text-white/30 uppercase tracking-wide mb-2">Position Sizer</div>
      <div className="flex items-center gap-2 mb-2">
        {[2, 5, 10, 15].map(p => (
          <button key={p} onClick={() => setPctInput(String(p))}
            className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
              pctInput === String(p) ? 'bg-green-500 text-black' : 'bg-white/5 text-white/50 hover:bg-white/10'
            }`}>{p}%</button>
        ))}
        <input type="number" value={pctInput} onChange={e => setPctInput(e.target.value)}
          className="w-16 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-center font-mono outline-none focus:border-green-500/50"
          min="0.5" max="100" step="0.5"
        />
        <span className="text-xs text-white/30">% of portfolio</span>
      </div>
      <div className="flex justify-between text-xs">
        <span className="text-white/40">→ {shares} shares @ ${fmt(price)}</span>
        <span className={affordable ? 'text-green-400' : 'text-red-400'}>
          Cost: ${fmt(cost)} {!affordable && '(insufficient cash)'}
        </span>
      </div>
    </div>
  );
}

// ── Discovery card ────────────────────────────────────────────────────────────
function DiscoveryCard({ stock, selected, onClick, onBuy, onWatch }: {
  stock: StockCard; selected: boolean;
  onClick: () => void; onBuy: () => void; onWatch: () => void;
}) {
  const up = stock.change1d >= 0;
  const rsiC = stock.rsiEstimate > 70 ? 'text-red-400' : stock.rsiEstimate < 30 ? 'text-green-400' : 'text-white/60';
  const macdC = stock.macdSignal.includes('Bull') ? 'text-green-400' : stock.macdSignal.includes('Bear') ? 'text-red-400' : 'text-white/50';
  const trendC = stock.trend.includes('Up') ? 'text-green-400' : stock.trend.includes('Down') ? 'text-red-400' : 'text-white/50';
  const trendIcon = stock.trend.includes('Strong Up') ? '↑↑' : stock.trend.includes('Up') ? '↑' : stock.trend.includes('Strong Down') ? '↓↓' : stock.trend.includes('Down') ? '↓' : '→';
  return (
    <div onClick={onClick} className={`rounded-xl p-4 cursor-pointer transition-all border select-none ${
      selected ? 'border-green-500/50 bg-green-500/5 shadow-[0_0_20px_rgba(0,212,138,0.08)]'
               : 'border-white/5 bg-[#13131f] hover:border-white/15 hover:-translate-y-px'
    }`}>
      <div className="flex justify-between items-start mb-2">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className="font-mono text-sm bg-[#1f1f2e] border border-white/10 rounded-md px-2 py-0.5 shrink-0">{stock.ticker}</span>
          <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border shrink-0 ${recCls(stock.recommendation)}`}>{stock.recommendation}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          <span className="text-[10px] text-green-400 bg-green-400/10 border border-green-400/20 rounded-full px-2 py-0.5 font-semibold whitespace-nowrap">↑{Math.round(stock.upside)}%</span>
          <Sparkline data={stock.history.slice(-20)} positive={up} />
        </div>
      </div>

      <div className="text-xs text-white/50 mb-2 leading-tight truncate">
        {stock.name}<span className="text-white/25"> · {stock.exchange} · {stock.currency}</span>
      </div>

      <div className="flex items-baseline gap-2 mb-2 flex-wrap">
        <span className="font-mono text-xl font-medium">${fmt(stock.price)}</span>
        <span className={`text-xs ${up ? 'text-green-400' : 'text-red-400'}`}>{up ? '+' : ''}{fmt(stock.change1d)}%</span>
        {stock.change52w !== 0 && (
          <span className={`text-[10px] ${stock.change52w >= 0 ? 'text-green-400/60' : 'text-red-400/60'}`}>
            52w: {pct(stock.change52w)}
          </span>
        )}
      </div>

      <div className="flex gap-1.5 flex-wrap mb-2">
        <span className="text-[11px] bg-[#1f1f2e] rounded px-1.5 py-0.5 text-white/40">{stock.marketCap}</span>
        <span className="text-[11px] bg-[#1f1f2e] rounded px-1.5 py-0.5 text-white/40">{stock.sector}</span>
        <span className={`text-[11px] ${riskCls(stock.riskLevel)}`}>{stock.riskLevel} risk</span>
        {stock.source && stock.source !== 'unavailable' && (
          <span className="text-[10px] text-green-400/60 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />{stock.source.replace(' (Live)','').replace('Yahoo Finance','YF')}
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-1.5 mb-2 bg-[#1f1f2e] rounded-lg p-2">
        <div className="text-center">
          <div className="text-[9px] text-white/25 uppercase mb-0.5">RSI</div>
          <div className={`font-mono text-sm font-medium ${rsiC}`}>{Math.round(stock.rsiEstimate)}</div>
        </div>
        <div className="text-center">
          <div className="text-[9px] text-white/25 uppercase mb-0.5">MACD</div>
          <div className={`text-[10px] font-mono ${macdC}`}>{stock.macdSignal.includes('Bull') ? 'Bull ✓' : stock.macdSignal.includes('Bear') ? 'Bear ✗' : 'Neutral'}</div>
        </div>
        <div className="text-center">
          <div className="text-[9px] text-white/25 uppercase mb-0.5">Trend</div>
          <div className={`font-mono text-base ${trendC}`}>{trendIcon}</div>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] text-white/25">Conviction</span>
        <Dots n={stock.conviction} />
        <span className="text-[11px] text-white/30">{stock.conviction}/10</span>
      </div>

      {stock.candleSignal && stock.candleSignal !== 'None' && (
        <div className="mb-2">
          <span className="text-[10px] bg-teal-500/10 text-teal-400 border border-teal-500/20 rounded px-1.5 py-0.5">🕯 {stock.candleSignal}</span>
        </div>
      )}

      <div className="text-[11px] text-white/35 border-t border-white/5 pt-2 mb-3 leading-relaxed line-clamp-2">{stock.thesis}</div>

      <div className="flex gap-2">
        <button onClick={e => { e.stopPropagation(); onBuy(); }}
          className="flex-1 py-1.5 text-[11px] font-semibold bg-green-500 text-black rounded-lg hover:bg-green-400 transition-colors">
          Buy
        </button>
        <button onClick={e => { e.stopPropagation(); onWatch(); }}
          className="flex-1 py-1.5 text-[11px] font-medium bg-white/5 text-white/50 border border-white/10 rounded-lg hover:border-white/25 transition-colors">
          + Watch
        </button>
      </div>
    </div>
  );
}

// ── Order Modal ───────────────────────────────────────────────────────────────
function OrderModal({ stock, onClose, showToast }: {
  stock: StockCard; onClose: () => void;
  showToast: (msg: string, type?: 'ok'|'err'|'info') => void;
}) {
  const [shares, setShares] = useState('');
  const [stopLoss, setStopLoss] = useState(stock.stopLoss.toFixed(2));
  const [takeProfit, setTakeProfit] = useState(stock.targetPrice.toFixed(2));
  const [analysis, setAnalysis] = useState('');
  const [loadingAnalysis, setLoadingAnalysis] = useState(true);
  const [side, setSide] = useState<'buy'|'sell'>('buy');
  const [confirmed, setConfirmed] = useState<{shares:number;price:number} | null>(null);
  const [executing, setExecuting] = useState(false);
  const store = useTraderStore();
  const { mode } = store;
  const current = store.current();
  const totalValue = getPortfolioValue(current);
  const existing = current.positions[stock.ticker];

  useEffect(() => {
    setStopLoss(stock.stopLoss.toFixed(2));
    setTakeProfit(stock.targetPrice.toFixed(2));
    setShares('');
    setConfirmed(null);
    setLoadingAnalysis(true);
    fetchAnalysis(stock.ticker, stock.name, stock.price, stock, null)
      .then(setAnalysis).catch(() => setAnalysis(stock.thesis))
      .finally(() => setLoadingAnalysis(false));
  }, [stock.ticker]);

  const n = parseInt(shares) || 0;
  const total = n * stock.price;
  const after = current.cash - total;
  const rr = stock.stopLoss > 0 && stock.price > stock.stopLoss
    ? ((stock.targetPrice - stock.price) / (stock.price - stock.stopLoss)).toFixed(1)
    : 'N/A';

  const handleExecute = async () => {
    if (n <= 0 || executing) return;
    setExecuting(true);
    if (mode === 'paper') {
      if (side === 'buy') {
        const ok = store.buy(stock, n, parseFloat(stopLoss) || null, parseFloat(takeProfit) || null);
        if (!ok) { showToast('Insufficient cash', 'err'); setExecuting(false); return; }
        setConfirmed({ shares: n, price: stock.price });
        showToast(`✓ [Paper] Bought ${n}× ${stock.ticker} @ $${fmt(stock.price)}`);
      } else {
        if (!existing || existing.shares < n) { showToast('Not enough shares', 'err'); setExecuting(false); return; }
        store.sell(stock.ticker, n, stock.price, 'manual');
        setConfirmed({ shares: -n, price: stock.price });
        showToast(`✓ [Paper] Sold ${n}× ${stock.ticker} @ $${fmt(stock.price)}`);
      }
    } else {
      showToast(`Sending ${side} order to broker…`, 'info');
      try {
        const res = await fetch('/api/trade', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticker: stock.ticker, side, shares: n, orderType: 'market', stopLoss: parseFloat(stopLoss) || undefined, takeProfit: parseFloat(takeProfit) || undefined, currentPrice: stock.price, mode: 'live' }),
        });
        const result = await res.json();
        if (!res.ok || result.error) { showToast(`Order failed: ${result.error ?? 'Unknown error'}`, 'err'); setExecuting(false); return; }
        const filledPrice = result.filledPrice ?? stock.price;
        if (side === 'buy') {
          store.buy(stock, n, parseFloat(stopLoss) || null, parseFloat(takeProfit) || null, 'manual', result.orderId, filledPrice, result.commission ?? 0);
          setConfirmed({ shares: n, price: filledPrice });
          showToast(`✓ [Live] Bought ${n}× ${stock.ticker} @ $${fmt(filledPrice)} · ID ${result.orderId ?? 'pending'}`);
        } else {
          store.sell(stock.ticker, n, filledPrice, 'manual', undefined, result.orderId, result.commission ?? 0);
          setConfirmed({ shares: -n, price: filledPrice });
          showToast(`✓ [Live] Sold ${n}× ${stock.ticker} @ $${fmt(filledPrice)} · ID ${result.orderId ?? 'pending'}`);
        }
      } catch (e: any) { showToast('Network error: ' + e.message, 'err'); setExecuting(false); return; }
    }
    setShares(''); setExecuting(false);
  };

  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-[#13131f] border border-white/10 rounded-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}>
        <div className="p-6">
          {/* Header */}
          <div className="flex justify-between items-start mb-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono text-base bg-[#1f1f2e] border border-white/10 rounded-md px-2 py-0.5">{stock.ticker}</span>
                <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${recCls(stock.recommendation)}`}>{stock.recommendation}</span>
              </div>
              <div className="text-sm text-white/60">{stock.name}</div>
              <div className="text-[11px] text-white/30 mt-0.5">{stock.exchange} · {stock.sector}</div>
            </div>
            <div className="text-right">
              <div className="font-mono text-2xl">${fmt(stock.price)}</div>
              <div className={`text-xs ${stock.change1d >= 0 ? 'text-green-400' : 'text-red-400'}`}>{pct(stock.change1d)} today</div>
              {stock.change52w !== 0 && <div className="text-[10px] text-white/30">52w: {pct(stock.change52w)}</div>}
            </div>
          </div>

          {/* FIX #24: Confirmation banner */}
          {confirmed && (
            <div className={`rounded-lg p-3 mb-4 text-sm font-medium flex items-center gap-2 ${
              confirmed.shares > 0 ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                                   : 'bg-red-500/10 text-red-400 border border-red-500/20'
            }`}>
              ✓ {confirmed.shares > 0 ? 'Bought' : 'Sold'} {Math.abs(confirmed.shares)}× {stock.ticker} @ ${fmt(confirmed.price)}
            </div>
          )}

          {/* Trade levels */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            {[['Entry', stock.entryPrice, 'text-green-400'], ['Stop Loss', stock.stopLoss, 'text-red-400'], ['Target', stock.targetPrice, 'text-violet-400']].map(([l, v, c]) => (
              <div key={String(l)} className="bg-[#1f1f2e] rounded-lg p-2 text-center">
                <div className="text-[9px] text-white/25 uppercase mb-1">{String(l)}</div>
                <div className={`font-mono text-sm font-medium ${String(c)}`}>${fmt(Number(v))}</div>
              </div>
            ))}
          </div>

          {/* Technical snapshot */}
          <div className="bg-[#1f1f2e] rounded-lg p-3 mb-4 grid grid-cols-2 gap-2 text-xs">
            {[['RSI', Math.round(stock.rsiEstimate), stock.rsiEstimate > 70 ? 'text-red-400' : stock.rsiEstimate < 30 ? 'text-green-400' : 'text-white/60'],
              ['MACD', stock.macdSignal.replace(' Crossover',''), stock.macdSignal.includes('Bull') ? 'text-green-400' : stock.macdSignal.includes('Bear') ? 'text-red-400' : 'text-white/50'],
              ['Trend', stock.trend, stock.trend.includes('Up') ? 'text-green-400' : stock.trend.includes('Down') ? 'text-red-400' : 'text-white/50'],
              ['R/R', rr + ':1', 'text-amber-400'],
            ].map(([l, v, c]) => (
              <div key={String(l)} className="flex justify-between">
                <span className="text-white/30">{String(l)}</span>
                <span className={`font-mono ${String(c)}`}>{String(v)}</span>
              </div>
            ))}
          </div>

          {/* Position sizer (FIX #10) */}
          <PositionSizer price={stock.price} cash={current.cash} portfolioValue={totalValue} />

          {/* AI Analysis */}
          <div className="border-l-2 border-violet-500/40 bg-violet-500/5 rounded-r-lg p-3 mb-4">
            <div className="text-[10px] text-violet-400 uppercase tracking-wider font-semibold mb-2 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse" />
              Claude Analysis <span className="text-white/25 normal-case tracking-normal">(cached per ticker)</span>
            </div>
            {loadingAnalysis ? (
              <div className="flex gap-1 py-2">{[0,1,2].map(i => <div key={i} className="w-1 h-1 rounded-full bg-white/20 animate-bounce" style={{animationDelay:`${i*0.15}s`}} />)}</div>
            ) : (
              <div className="text-xs text-white/50 leading-relaxed space-y-2">
                {analysis.split('\n\n').map((p, i) => <p key={i}>{p}</p>)}
              </div>
            )}
          </div>

          {/* Risks */}
          {stock.risks && (
            <div className="bg-red-500/5 border border-red-500/15 rounded-lg p-3 mb-4 text-xs text-red-400/80">
              <span className="font-semibold">⚠ Key Risk: </span>{stock.risks}
            </div>
          )}

          {/* Order form */}
          <div className="space-y-3">
            {/* FIX: Buy/Sell toggle */}
            <div className="flex bg-[#1f1f2e] rounded-lg p-1 gap-1">
              <button onClick={() => setSide('buy')} className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${side === 'buy' ? 'bg-green-500 text-black' : 'text-white/50 hover:text-white'}`}>Buy</button>
              <button onClick={() => setSide('sell')} className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${side === 'sell' ? 'bg-red-500 text-white' : 'text-white/50 hover:text-white'}`}>Sell</button>
            </div>

            <div>
              <label className="block text-[10px] text-white/30 uppercase tracking-wider mb-1.5">
                Shares {existing && <span className="text-white/20 normal-case">(holding {existing.shares})</span>}
              </label>
              <input type="number" value={shares} onChange={e => setShares(e.target.value)} placeholder="0" min="1"
                className="w-full bg-[#1f1f2e] border border-white/10 rounded-lg px-3 py-2.5 font-mono text-sm focus:border-green-500/50 outline-none" />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] text-white/30 uppercase tracking-wider mb-1.5">Stop Loss</label>
                <input type="number" value={stopLoss} onChange={e => setStopLoss(e.target.value)} step="0.01"
                  className="w-full bg-[#1f1f2e] border border-white/10 rounded-lg px-3 py-2.5 font-mono text-sm text-red-400 focus:border-red-500/50 outline-none" />
              </div>
              <div>
                <label className="block text-[10px] text-white/30 uppercase tracking-wider mb-1.5">Take Profit</label>
                <input type="number" value={takeProfit} onChange={e => setTakeProfit(e.target.value)} step="0.01"
                  className="w-full bg-[#1f1f2e] border border-white/10 rounded-lg px-3 py-2.5 font-mono text-sm text-violet-400 focus:border-violet-500/50 outline-none" />
              </div>
            </div>

            {n > 0 && (
              <div className="bg-[#1f1f2e] rounded-lg p-3 text-xs space-y-1.5">
                <div className="flex justify-between"><span className="text-white/35">Price × shares</span><span className="font-mono">${fmt(stock.price)} × {n}</span></div>
                <div className="flex justify-between"><span className="text-white/35">Total {side === 'buy' ? 'cost' : 'proceeds'}</span><span className="font-mono">${fmt(total)}</span></div>
                <div className="flex justify-between border-t border-white/5 pt-1.5">
                  <span className="text-white/35">Cash after</span>
                  <span className={`font-mono ${side === 'buy' ? (after < 0 ? 'text-red-400' : 'text-green-400') : 'text-green-400'}`}>
                    ${fmt(side === 'buy' ? after : current.cash + total)}
                  </span>
                </div>
                {/* FIX #10: show portfolio % */}
                <div className="flex justify-between">
                  <span className="text-white/35">% of portfolio</span>
                  <span className="font-mono text-amber-400">{fmt(total / totalValue * 100)}%</span>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <button onClick={handleExecute} disabled={n <= 0 || (side === 'buy' && after < 0)}
                className={`flex-1 py-2.5 font-semibold rounded-xl disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${
                  side === 'buy' ? 'bg-green-500 text-black hover:bg-green-400' : 'bg-red-500 text-white hover:bg-red-400'
                }`}>
                {executing ? 'Sending…' : side === 'buy' ? `Buy ${n > 0 ? n + '×' : ''}` : `Sell ${n > 0 ? n + '×' : ''}`}
              </button>
              <button onClick={onClose}
                className="px-4 py-2.5 bg-white/5 text-white/40 border border-white/10 rounded-xl hover:border-white/25 transition-colors text-sm">
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Portfolio performance chart ───────────────────────────────────────────────
function PortfolioChart({ history }: { history: {ts:number;value:number}[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<any>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !canvasRef.current || history.length < 2) return;
    import('chart.js/auto').then(({ default: Chart }) => {
      if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }
      const data = history.slice(-100);
      const vals = data.map(h => h.value);
      const isUp = vals[vals.length - 1] >= vals[0];
      const col = isUp ? '#00d48a' : '#ff3d5a';
      const ctx = canvasRef.current!.getContext('2d')!;
      const grad = ctx.createLinearGradient(0, 0, 0, 160);
      grad.addColorStop(0, isUp ? 'rgba(0,212,138,0.2)' : 'rgba(255,61,90,0.2)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      chartRef.current = new Chart(canvasRef.current!, {
        type: 'line',
        data: {
          labels: data.map(h => new Date(h.ts).toLocaleTimeString('en-AU', {hour:'2-digit',minute:'2-digit'})),
          datasets: [{
            data: vals, borderColor: col, backgroundColor: grad, fill: true,
            tension: 0.4, pointRadius: 0, borderWidth: 1.5,
          }],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c: any) => '$' + c.parsed.y.toLocaleString('en-AU', {minimumFractionDigits:2}) } } },
          scales: {
            x: { ticks: { color: '#50506a', font: { size: 9 }, maxTicksLimit: 6 }, grid: { color: 'rgba(255,255,255,0.03)' } },
            y: { ticks: { color: '#50506a', font: { size: 9 }, callback: (v: any) => '$' + Math.round(v / 1000) + 'k' }, grid: { color: 'rgba(255,255,255,0.03)' } },
          },
        },
      });
    });
    return () => { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } };
  }, [history.length]);

  return <div className="h-40 relative"><canvas ref={canvasRef} /></div>;
}

// ── Autopilot cycle (FIX #18: fully wired) ───────────────────────────────────
async function runAutopilotCycle(
  store: { current: () => { cash: number; positions: Record<string, any> }; buy: (...a: any[]) => boolean; sell: (...a: any[]) => boolean },
  risk: string, maxPct: number, stopPct: number, tpPct: number,
  totalValue: number, addLog: (msg: string) => void, showToast: (m: string, t?: any) => void
) {
  const positions = store.current().positions;
  const keys = Object.keys(positions);
  const posStr = keys.length
    ? keys.map(k => { const p = positions[k]; const pnlPct = (p.currentPrice - p.avgPrice) / p.avgPrice * 100; return `${k}:pnl${pnlPct.toFixed(1)}%`; }).join(',')
    : 'none';

  const prompt = `Portfolio: cash $${store.current().cash.toFixed(0)} of $${totalValue.toFixed(0)} total, positions: ${posStr}
Risk profile: ${risk} | Max per trade: ${maxPct}% | Auto stop: ${stopPct}% | Auto take-profit: ${tpPct}%
Return max 3 pipe-delimited action lines then SUMMARY|sentence. Format: ACTION|TICKER|REASON(max 8 words)
ACTION = buy/sell/trim/hold. Only sell if pnl < -${stopPct} or > ${tpPct}. Only buy if cash > 15% of total.`;

  try {
    const res = await fetch('/api/coach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: prompt }),
    });
    const data = await res.json();
    const lines = (data.reply ?? '').trim().split('\n').filter(Boolean);
    for (const line of lines) {
      const parts = line.split('|');
      if (parts.length < 2) continue;
      const action = parts[0].toLowerCase().trim();
      const ticker = parts[1].trim().toUpperCase();
      const reason = (parts[2] ?? '').trim();
      if (action === 'summary') { addLog(`📊 ${reason || ticker}`); continue; }
      if ((action === 'buy') && store.current().cash > totalValue * 0.15) {
        const budget = totalValue * maxPct / 100;
        const existingPos = store.current().positions[ticker];
        const price = existingPos?.currentPrice ?? 100;
        const shares = Math.max(1, Math.floor(budget / price));
        const sl = parseFloat((price * (1 - stopPct / 100)).toFixed(2));
        const tp = parseFloat((price * (1 + tpPct / 100)).toFixed(2));
        const ok = store.buy({ ticker, name: ticker, price, exchange: 'AUTO', sector: 'Equity' }, shares, sl, tp, 'auto');
        if (ok) { addLog(`🟢 BUY ${shares}× ${ticker} — ${reason}`); showToast(`🤖 Bought ${shares}× ${ticker}`, 'info'); }
      } else if ((action === 'sell' || action === 'trim') && store.current().positions[ticker]) {
        const pos = store.current().positions[ticker];
        const shares = action === 'trim' ? Math.max(1, Math.floor(pos.shares / 2)) : pos.shares;
        store.sell(ticker, shares, pos.currentPrice, 'auto');
        addLog(`🔴 ${action.toUpperCase()} ${shares}× ${ticker} — ${reason}`);
        showToast(`🤖 Sold ${shares}× ${ticker}`, 'info');
      }
    }
  } catch (e: any) {
    addLog(`⚠️ Cycle error: ${e.message.slice(0, 50)}`);
  }
}

// ── Watchlist page ────────────────────────────────────────────────────────────
function WatchlistPage({ showToast }: { showToast: (m: string, t?: any) => void }) {
  const { watchlist, addWatchlist, removeWatchlist } = useTraderStore();
  const store = useTraderStore();
  const current = store.current();
  const [prices, setPrices] = useState<Record<string, any>>({});
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!watchlist.length) return;
    setLoading(true);
    fetchPrices(watchlist).then(setPrices).finally(() => setLoading(false));
  }, [watchlist.join(',')]);

  const add = () => {
    if (!input.trim()) return;
    addWatchlist(input.trim().toUpperCase());
    setInput('');
  };

  return (
    <div>
      <div className="flex gap-3 mb-5">
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()}
          placeholder="Add ticker e.g. AAPL, BHP.AX, BTC-USD"
          className="flex-1 bg-[#13131f] border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:border-green-500/50 outline-none placeholder:text-white/30" />
        <button onClick={add} className="px-5 py-2.5 bg-green-500 text-black text-sm font-semibold rounded-xl hover:bg-green-400">Add</button>
      </div>
      {watchlist.length === 0 ? (
        <div className="text-center py-16 text-white/30">
          <div className="text-4xl mb-3">⭐</div>
          <div className="font-serif text-lg text-white/50 mb-1">Watchlist empty</div>
          <p className="text-sm">Add tickers above or click + Watch on any screener card</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {watchlist.map(tk => {
            const mkt = prices[tk] ?? prices[tk.replace('.AX', '').replace('-USD', '')];
            const up = mkt ? mkt.change1d >= 0 : true;
            return (
              <div key={tk} className="bg-[#13131f] border border-white/5 rounded-xl p-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="font-mono text-sm bg-[#1f1f2e] border border-white/10 rounded-md px-2 py-0.5">{tk.replace('.AX','').replace('-USD','')}</span>
                  <button onClick={() => removeWatchlist(tk)} className="text-white/25 hover:text-red-400 transition-colors text-xl leading-none">×</button>
                </div>
                {loading ? (
                  <div className="h-12 bg-white/5 rounded animate-pulse" />
                ) : mkt && mkt.price > 0 ? (
                  <>
                    <div className="font-mono text-xl font-medium mb-0.5">${fmt(mkt.price)}</div>
                    <div className={`text-xs mb-1 ${up ? 'text-green-400' : 'text-red-400'}`}>
                      {up ? '+' : ''}{fmt(mkt.change1d)}% today
                    </div>
                    {mkt.name && mkt.name !== tk && <div className="text-[11px] text-white/30 truncate mb-1">{mkt.name}</div>}
                    <div className="text-[10px] text-green-400/50 flex items-center gap-1 mb-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400" />{mkt.source?.replace(' (Live)','')}
                    </div>
                    {/* FIX #12: Buy from watchlist */}
                    <button onClick={() => {
                      const shares = Math.max(1, Math.floor(current.cash * 0.05 / mkt.price));
                      const ok = store.buy({ ticker: tk.replace('.AX','').replace('-USD',''), name: mkt.name || tk, price: mkt.price, exchange: mkt.exchange, sector: mkt.sector }, shares, null, null);
                      if (ok) showToast(`Bought ${shares}× ${tk.replace('.AX','')}`);
                      else showToast('Insufficient cash', 'err');
                    }} className="w-full py-1.5 text-[11px] font-semibold bg-green-500 text-black rounded-lg hover:bg-green-400 transition-colors">
                      Quick Buy 5%
                    </button>
                  </>
                ) : (
                  <div className="text-xs text-white/25">Price unavailable</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
function AppInner() {
  const [page, setPage] = useState<'discover'|'search'|'portfolio'|'history'|'autopilot'|'coach'|'watchlist'>('discover');
  const [theme, setTheme] = useState('all');
  const [stocks, setStocks] = useState<StockCard[]>([]);
  const [screenLoading, setScreenLoading] = useState(false);
  const [screeningCount, setScreeningCount] = useState(0); // FIX #14: skeleton count
  const [screenStatus, setScreenStatus] = useState('');
  const [orderStock, setOrderStock] = useState<StockCard | null>(null);
  const [searchQ, setSearchQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [coachQ, setCoachQ] = useState('');
  const [coachReply, setCoachReply] = useState('');
  const [coachLoading, setCoachLoading] = useState(false);
  const [apOn, setApOn] = useState(false);
  const [apLog, setApLog] = useState<{ts:number;msg:string}[]>([]);
  const [apRisk, setApRisk] = useState('moderate');
  const [apMax, setApMax] = useState(5);
  const [apStop, setApStop] = useState(7);
  const [apTp, setApTp] = useState(15);
  const [histFilter, setHistFilter] = useState<'all'|'buy'|'sell'|'auto'>('all'); // FIX #15
  const [toast, setToast] = useState<{msg:string;type:'ok'|'err'|'info'}|null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false); // FIX #13 mobile
  const apIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const store = useTraderStore();
  const { mode } = store;
  const current = store.current();
  const totalValue = getPortfolioValue(current);
  const pnl = totalValue - current.startingCash;
  const pnlPct = current.startingCash > 0 ? (pnl / current.startingCash) * 100 : 0;
  const dayPnl = getDayPnl(current);
  const [validationResult, setValidationResult] = useState<any>(null);

  // FIX #27: longer toast for longer messages
  const showToast = useCallback((msg: string, type: 'ok'|'err'|'info' = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), Math.max(3000, msg.length * 60));
  }, []);

  // Price tick simulation
  useEffect(() => {
    const tick = () => {
      const positions = store.current().positions;
      for (const [ticker, pos] of Object.entries(positions)) {
        const vol = pos.sector === 'Crypto' ? 0.02 : pos.sector === 'Technology' ? 0.009 : 0.006;
        const newPrice = Math.max(0.01, pos.currentPrice * (1 + 0.0002 + (Math.random() - 0.485) * vol));
        store.updatePrice(ticker, r2(newPrice));
      }
      const triggered = store.checkStopsAndTPs();
      triggered.forEach(t => {
        showToast(
          t.type === 'stop' ? `🛑 Stop loss: sold ${t.shares}× ${t.ticker} @ $${fmt(t.price)}` : `🎯 Take profit: sold ${t.shares}× ${t.ticker} @ $${fmt(t.price)}`,
          t.type === 'stop' ? 'err' : 'ok'
        );
      });
      if (triggered.length) store.recordHistory();
    };
    const interval = setInterval(tick, 15000);
    return () => clearInterval(interval);
  }, []);

  // FIX #26: Cmd+K search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setPage('search');
        setTimeout(() => document.getElementById('search-input')?.focus(), 100);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // FIX #18: Autopilot properly wired
  useEffect(() => {
    if (apOn) {
      // Restart the cycle immediately with new settings whenever any setting changes
      if (apIntervalRef.current) clearInterval(apIntervalRef.current);
      const cycle = () => runAutopilotCycle(
        store, apRisk, apMax, apStop, apTp, totalValue,
        (msg) => setApLog(l => [{ ts: Date.now(), msg }, ...l].slice(0, 60)),
        showToast
      );
      cycle(); // run immediately with new settings
      apIntervalRef.current = setInterval(cycle, 30000);
    } else {
      if (apIntervalRef.current) { clearInterval(apIntervalRef.current); apIntervalRef.current = null; }
    }
    return () => { if (apIntervalRef.current) clearInterval(apIntervalRef.current); };
  }, [apOn, apRisk, apMax, apStop, apTp]); // re-run whenever any setting changes

  // ── Screener ────────────────────────────────────────────────────────────
  const runScreener = async () => {
    setScreenLoading(true);
    setStocks([]);
    setOrderStock(null);
    setScreenStatus('Fetching ticker list…');
    try {
      const tickers = await fetchScreenerTickers(theme);
      setScreeningCount(tickers.length); // FIX #14: show skeletons
      setScreenStatus(`Fetching live prices for ${tickers.length} stocks…`);
      // FIX #20: prices fetched in parallel server-side, signals fetched in parallel here
      const priceMap = await fetchPrices(tickers);
      const successfulPrices = Object.values(priceMap).filter((v: any) => v.price > 0).length;
      if (successfulPrices === 0) {
        setScreenStatus('Price API returned no data. Yahoo Finance may be rate-limited — try again in 30 seconds.');
        showToast('No price data returned. Try again shortly.', 'err');
        setScreenLoading(false);
        setScreeningCount(0);
        return;
      }
      setScreenStatus(`Prices loaded (${successfulPrices}/${tickers.length}) · Generating AI signals…`);

      // FIX #20: fetch all signals in parallel
      const signalJobs = tickers.map(async tk => {
        const mkt = priceMap[tk] ?? priceMap[tk.replace('.AX','').replace('-USD','')];
        if (!mkt || mkt.error || mkt.price <= 0) return null;
        try {
          const sig = await fetchSignals(tk, mkt.price, mkt.name || tk, {
            change52w: mkt.change52w, marketCap: mkt.marketCap,
            sector: mkt.sector, exchange: mkt.exchange,
            high52w: mkt.high52w, low52w: mkt.low52w,
          });
          return {
            ticker: tk.replace('.AX','').replace('-USD',''),
            name: sig.name || mkt.name || tk,
            price: mkt.price, change1d: mkt.change1d, change52w: mkt.change52w,
            marketCap: mkt.marketCap, currency: mkt.currency, exchange: mkt.exchange,
            sector: mkt.sector, source: mkt.source, history: mkt.history ?? [],
            high52w: mkt.high52w ?? 0, low52w: mkt.low52w ?? 0, volume: mkt.volume ?? 0,
            ...sig,
          } as StockCard;
        } catch (e: any) {
          console.error('[screener] signal error for', tk, e?.message);
          return null;
        }
      });

      // Show cards as they arrive using Promise.allSettled + progressive update
      const results: StockCard[] = [];
      for (const job of signalJobs) {
        const card = await job;
        if (card) {
          results.push(card);
          setStocks([...results]);
          setScreenStatus(`${results.length}/${tickers.length} stocks loaded…`);
        }
      }
      setScreeningCount(0);
      if (results.length === 0) {
        setScreenStatus('No data returned — check GEMINI_API_KEY is set in Vercel Environment Variables, then redeploy');
        showToast('No stocks loaded. Check /api/health to diagnose.', 'err');
      } else {
        const sources = [...new Set(results.map(s => (s.source || 'unknown').replace(' (Live)','')))];
        setScreenStatus(`${results.length} stocks · ${sources.join(', ')}`);
      }
    } catch (e: any) {
      setScreenStatus('Error: ' + e.message);
      showToast('Screener error: ' + e.message, 'err');
      setScreeningCount(0);
    }
    setScreenLoading(false);
  };

  // ── Search ──────────────────────────────────────────────────────────────
  const doSearch = async () => {
    if (!searchQ.trim()) return;
    setSearching(true);
    setStocks([]);
    try {
      // Use dedicated search endpoint — static map for common stocks, Gemini fallback
      const res = await fetch(`/api/search?q=${encodeURIComponent(searchQ.trim())}`);
      const data = await res.json();

      if (!res.ok || !data.tickers || data.tickers.length === 0) {
        showToast(`No tickers found for "${searchQ}" — try a company name or ticker symbol`, 'err');
        setSearching(false);
        return;
      }

      const tickers: string[] = data.tickers;
      const priceMap = await fetchPrices(tickers);
      const results: StockCard[] = [];

      for (const tk of tickers) {
        const mkt = priceMap[tk] ?? priceMap[tk.replace('.AX','').replace('-USD','')];
        if (!mkt || mkt.error || mkt.price <= 0) continue;
        try {
          const sig = await fetchSignals(tk, mkt.price, mkt.name || tk, {
            change52w: mkt.change52w, marketCap: mkt.marketCap,
            sector: mkt.sector, exchange: mkt.exchange,
          });
          results.push({
            ticker: tk.replace('.AX','').replace('-USD',''),
            name: sig.name || mkt.name || tk,
            price: mkt.price, change1d: mkt.change1d, change52w: mkt.change52w,
            marketCap: mkt.marketCap, currency: mkt.currency, exchange: mkt.exchange,
            sector: mkt.sector, source: mkt.source, history: mkt.history ?? [],
            high52w: mkt.high52w ?? 0, low52w: mkt.low52w ?? 0, volume: mkt.volume ?? 0,
            ...sig,
          });
          setStocks([...results]);
        } catch (e: any) {
          console.warn('[search] signal error for', tk, e?.message);
        }
        await new Promise(r => setTimeout(r, 100));
      }

      if (results.length === 0) {
        showToast('Price data unavailable for those tickers — try again shortly', 'err');
      }
    } catch (e: any) {
      showToast('Search error: ' + e.message, 'err');
    }
    setSearching(false);
  };

  // ── Coach ───────────────────────────────────────────────────────────────
  const sendCoach = async (q?: string) => {
    const question = q ?? coachQ;
    if (!question.trim()) return;
    if (q) setCoachQ(q);
    setCoachLoading(true); setCoachReply('');
    try {
      // FIX #17: properly formed portfolio context
      const posEntries = Object.entries(current.positions);
      const posStr = posEntries.length > 0
        ? posEntries.map(([k, p]) => {
            const pnlPct = ((p.currentPrice - p.avgPrice) / p.avgPrice * 100).toFixed(1);
            return `${k}(${p.shares}sh avg$${fmt(p.avgPrice)} now$${fmt(p.currentPrice)} ${pnlPct}%)`;
          }).join(' ')
        : 'none';
      const ctx = `Portfolio: total $${fmt(totalValue)}, cash $${fmt(current.cash)}, P&L $${fmt(pnl)} (${pct(pnlPct)}), day P&L $${fmt(dayPnl)}, positions: ${posStr}.`;
      const { reply } = await askCoach(question, ctx);
      setCoachReply(reply);
    } catch (e: any) { setCoachReply('Error: ' + e.message); }
    setCoachLoading(false);
  };

  // ── Quick buy ───────────────────────────────────────────────────────────
  const quickBuy = (stock: StockCard) => {
    const shares = Math.max(1, Math.floor(current.cash * 0.05 / stock.price));
    const ok = store.buy(stock, shares, stock.stopLoss || null, stock.targetPrice || null);
    if (ok) showToast(`✓ Bought ${shares}× ${stock.ticker} @ $${fmt(stock.price)}`);
    else showToast('Insufficient cash', 'err');
  };

  // FIX #15: filtered history
  const filteredTxs = useMemo(() => {
    const txs = [...current.transactions].reverse();
    if (histFilter === 'all') return txs;
    if (histFilter === 'buy') return txs.filter(t => t.type === 'buy' && t.source === 'manual');
    if (histFilter === 'sell') return txs.filter(t => t.type === 'sell' && t.source === 'manual');
    return txs.filter(t => ['auto', 'stop', 'tp'].includes(t.source));
  }, [current.transactions, histFilter]);

  const pageLabel: Record<string, string> = {
    discover:'Discover Opportunities', search:'Search & Trade', portfolio:'My Portfolio',
    history:'Transaction History', autopilot:'AI Autopilot', coach:'AI Investment Coach', watchlist:'Watchlist',
  };

  const navItems = [
    { id: 'discover', icon: '🔍', label: 'AI Screener' },
    { id: 'search', icon: '📡', label: 'Search & Trade' },
    { id: 'watchlist', icon: '⭐', label: 'Watchlist' },
    { id: 'portfolio', icon: '📊', label: 'Portfolio' },
    { id: 'autopilot', icon: '🤖', label: 'AI Autopilot' },
    { id: 'history', icon: '🕐', label: 'History' },
    { id: 'coach', icon: '💡', label: 'AI Coach' },
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-[#080810] text-white">
      {/* FIX #13: mobile overlay */}
      {sidebarOpen && <div className="fixed inset-0 bg-black/60 z-30 lg:hidden" onClick={() => setSidebarOpen(false)} />}

      {/* Sidebar */}
      <aside className={`fixed lg:relative inset-y-0 left-0 z-40 w-56 min-w-56 bg-[#0e0e1a] border-r border-white/5 flex flex-col transition-transform duration-200 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <div className="px-5 pt-5 pb-4 border-b border-white/5">
          <div className="font-serif text-xl">Apex<span className="text-green-400 italic">Trader</span></div>
          <div className="text-[9px] text-white/25 tracking-wide mt-0.5">Live Data · AI Analysis</div>
        </div>
        <nav className="p-2 flex-1">
          {navItems.map(({ id, icon, label }) => (
            <button key={id} onClick={() => { setPage(id as any); setSidebarOpen(false); }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] mb-0.5 transition-all text-left border ${
                page === id ? 'text-green-400 bg-green-400/10 border-green-400/20'
                            : 'text-white/45 hover:text-white hover:bg-white/5 border-transparent'
              }`}>
              <span>{icon}</span>{label}
            </button>
          ))}
        </nav>
        <div className="p-4 border-t border-white/5">
          <div className="text-[10px] text-white/25 uppercase tracking-wide">Available Cash</div>
          <div className="font-mono text-lg text-green-400 font-medium mt-0.5">${fmt(current.cash)}</div>
          <div className={`text-xs mt-0.5 ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            P&L: {pnl >= 0 ? '+' : ''}{fmtC(pnl)} ({pct(pnlPct)})
          </div>
          {/* FIX #16: show daily P&L */}
          <div className={`text-xs mt-0.5 ${dayPnl >= 0 ? 'text-green-400/70' : 'text-red-400/70'}`}>
            Today: {dayPnl >= 0 ? '+' : ''}{fmtC(dayPnl)}
          </div>
          {apOn && (
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-violet-400 bg-violet-500/10 border border-violet-500/20 rounded-lg px-2 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse" />Autopilot ON
            </div>
          )}
          <button onClick={() => { if(confirm('Reset to $50,000?')) store.resetPaper(); }}
            className="mt-3 w-full py-1.5 text-[11px] text-white/35 bg-white/5 border border-white/10 rounded-lg hover:border-white/25 transition-colors">
            Reset Portfolio
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Topbar */}
        <div className="h-[52px] bg-[#0e0e1a] border-b border-white/5 flex items-center justify-between px-4 lg:px-6 flex-shrink-0 gap-3">
          {/* FIX #13: hamburger for mobile */}
          <button className="lg:hidden text-white/50 hover:text-white" onClick={() => setSidebarOpen(true)}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="font-serif text-xl min-w-0 truncate">{pageLabel[page]}</div>
          <div className="flex items-center gap-3 shrink-0 flex-wrap">
            <ModeSwitcher onValidate={(result) => setValidationResult(result)} />
            {page !== 'search' && <span className="hidden lg:block text-xs text-white/20 opacity-50">⌘K</span>}
            {apOn && <span className="flex items-center gap-1.5 text-xs text-violet-400"><span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse" />Autopilot</span>}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 lg:p-6">

          {/* ── MODE BANNER ── */}
          {mode === 'live' && (
            <div className="mb-4 flex items-center gap-3 bg-green-500/8 border border-green-500/20 rounded-xl px-4 py-3">
              <span className="w-2.5 h-2.5 rounded-full bg-green-400 animate-pulse shrink-0" />
              <div className="text-sm">
                <span className="text-green-400 font-semibold">Live Trading Mode</span>
                <span className="text-white/50 ml-2">— Orders go directly to your broker. Prices are real. Money is real.</span>
              </div>
              <button onClick={() => store.setMode('paper')} className="ml-auto text-xs text-white/40 hover:text-white/70 border border-white/10 rounded-lg px-2 py-1 transition-colors shrink-0">Switch to Training</button>
            </div>
          )}
          {mode === 'paper' && page === 'discover' && (
            <div className="mb-3 flex items-center gap-3 bg-blue-500/8 border border-blue-500/15 rounded-xl px-4 py-2.5">
              <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse shrink-0" />
              <span className="text-xs text-blue-300/70">Training Mode — All trades are paper (virtual money). Validate your strategy before switching to Live.</span>
            </div>
          )}

          {/* ── DISCOVER ── */}
          {page === 'discover' && (
            <div>
              {/* FIX #25: scrollable theme filter bar */}
              <div className="flex gap-2 mb-4 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
                {THEMES.map(({ id, label }) => (
                  <button key={id} onClick={() => setTheme(id)}
                    className={`px-3 py-1.5 rounded-full text-[11px] font-medium border transition-all whitespace-nowrap shrink-0 ${
                      theme === id ? 'bg-green-400/10 text-green-400 border-green-400/30' : 'text-white/45 border-white/10 bg-[#191926] hover:border-white/25'
                    }`}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3 mb-5 flex-wrap">
                <button onClick={runScreener} disabled={screenLoading}
                  className="px-6 py-2.5 bg-green-500 text-black text-sm font-semibold rounded-xl hover:bg-green-400 disabled:opacity-60 transition-colors">
                  {screenLoading ? '⟳ Scanning…' : '✦ Run AI Screener'}
                </button>
                <span className="text-xs text-white/35">{screenStatus}</span>
              </div>

              {/* FIX #28: proper empty state */}
              {stocks.length === 0 && !screenLoading && screeningCount === 0 && (
                <div className="text-center py-16 text-white/30">
                  <div className="text-5xl mb-4">🔍</div>
                  <div className="font-serif text-xl text-white/50 mb-2">Choose a theme and run the screener</div>
                  <p className="text-sm">Real live prices from Yahoo Finance · AI analysis from Claude<br />Pick any theme above, then click Run AI Screener</p>
                </div>
              )}

              {/* FIX #14: skeleton cards while loading */}
              {screeningCount > 0 && stocks.length === 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {Array.from({length: screeningCount}).map((_, i) => <SkeletonCard key={i} />)}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {stocks.map(s => (
                  <DiscoveryCard key={s.ticker} stock={s} selected={orderStock?.ticker === s.ticker}
                    onClick={() => setOrderStock(s)}
                    onBuy={() => quickBuy(s)}
                    onWatch={() => { store.addWatchlist(s.ticker); showToast(s.ticker + ' added to watchlist'); }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* ── SEARCH ── */}
          {page === 'search' && (
            <div>
              <div className="flex gap-3 mb-5">
                <input id="search-input" value={searchQ} onChange={e => setSearchQ(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && doSearch()}
                  placeholder="Search any stock, ETF, or theme… (⌘K)"
                  className="flex-1 bg-[#13131f] border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:border-green-500/50 outline-none placeholder:text-white/25" />
                <button onClick={doSearch} disabled={searching}
                  className="px-5 py-2.5 bg-green-500 text-black text-sm font-semibold rounded-xl hover:bg-green-400 disabled:opacity-60">
                  {searching ? 'Searching…' : 'Search'}
                </button>
              </div>
              {stocks.length === 0 && !searching && (
                <div className="text-center py-12 text-white/30">
                  <div className="text-4xl mb-3">📡</div>
                  <p className="text-sm">Search for any company, ticker, sector, or theme</p>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {stocks.map(s => (
                  <DiscoveryCard key={s.ticker} stock={s} selected={orderStock?.ticker === s.ticker}
                    onClick={() => setOrderStock(s)}
                    onBuy={() => quickBuy(s)}
                    onWatch={() => { store.addWatchlist(s.ticker); showToast(s.ticker + ' added'); }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* ── PORTFOLIO ── */}
          {page === 'portfolio' && (
            <div>
              {/* FIX #16: 4 KPI cards including daily P&L */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
                {[
                  ['Total Value', '$' + fmt(totalValue), pct(pnlPct), pnl >= 0],
                  ['All-Time P&L', (pnl >= 0 ? '+' : '') + fmtC(pnl), 'since $50k start', pnl >= 0],
                  ['Today\'s P&L', (dayPnl >= 0 ? '+' : '') + fmtC(dayPnl), 'since market open', dayPnl >= 0],
                  ['Cash', '$' + fmt(current.cash), fmt(current.cash / totalValue * 100) + '% of portfolio', true],
                ].map(([label, val, sub, up]) => (
                  <div key={String(label)} className="bg-[#13131f] border border-white/5 rounded-xl p-4">
                    <div className="text-[10px] text-white/25 uppercase tracking-wide mb-1">{String(label)}</div>
                    <div className={`font-mono text-xl font-medium ${typeof up === 'boolean' && !up ? 'text-red-400' : typeof up === 'boolean' && up ? '' : ''}`}
                      style={{color: typeof up === 'boolean' ? (up ? '#f2f2f8' : '#ff3d5a') : undefined}}>
                      {String(val)}
                    </div>
                    <div className="text-[11px] text-white/35 mt-1">{String(sub)}</div>
                  </div>
                ))}
              </div>

              {/* FIX #8: Portfolio chart */}
              {current.history.length > 1 && (
                <div className="bg-[#13131f] border border-white/5 rounded-xl p-4 mb-5">
                  <div className="text-[10px] text-white/25 uppercase tracking-wide mb-3">Portfolio Growth</div>
                  <PortfolioChart history={current.history} />
                </div>
              )}

              {/* Positions table */}
              {Object.keys(current.positions).length > 0 ? (
                <div className="bg-[#13131f] border border-white/5 rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-white/5 text-[10px] text-white/25 uppercase tracking-wide">Open Positions</div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead><tr>
                        {['Ticker','Name','Shares','Avg','Current','P&L','%','Portfolio %','Stop',''].map(h => (
                          <th key={h} className="px-3 py-2 text-left text-[10px] text-white/25 uppercase tracking-wide font-medium whitespace-nowrap">{h}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {Object.entries(current.positions).map(([tk, pos]) => {
                          const posPnl = (pos.currentPrice - pos.avgPrice) * pos.shares;
                          const posPnlPct = (pos.currentPrice - pos.avgPrice) / pos.avgPrice * 100;
                          const portPct = pos.shares * pos.currentPrice / totalValue * 100;
                          const isUp = posPnl >= 0;
                          return (
                            <tr key={tk} className="border-t border-white/5 hover:bg-white/[0.02] transition-colors">
                              <td className="px-3 py-3"><span className="font-mono text-xs bg-[#1f1f2e] border border-white/10 rounded px-2 py-0.5">{tk}</span></td>
                              <td className="px-3 py-3 text-xs text-white/45 max-w-[100px] truncate">{pos.name}</td>
                              <td className="px-3 py-3 font-mono text-xs">{pos.shares}</td>
                              <td className="px-3 py-3 font-mono text-xs">${fmt(pos.avgPrice)}</td>
                              <td className="px-3 py-3 font-mono text-xs">${fmt(pos.currentPrice)}</td>
                              {/* FIX #9: properly colour-coded P&L */}
                              <td className={`px-3 py-3 font-mono text-xs ${isUp ? 'text-green-400' : 'text-red-400'}`}>
                                {isUp ? '+' : '-'}{fmtC(posPnl)}
                              </td>
                              <td className={`px-3 py-3 font-mono text-xs ${isUp ? 'text-green-400' : 'text-red-400'}`}>
                                {pct(posPnlPct)}
                              </td>
                              {/* FIX #10: portfolio % column */}
                              <td className="px-3 py-3 font-mono text-xs text-amber-400">{fmt(portPct)}%</td>
                              <td className="px-3 py-3 font-mono text-xs text-amber-400/70">{pos.stopLoss ? '$' + fmt(pos.stopLoss) : '—'}</td>
                              <td className="px-3 py-3">
                                <button onClick={() => store.sell(tk, pos.shares, pos.currentPrice)}
                                  className="text-xs px-2 py-1 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg hover:bg-red-500 hover:text-white transition-colors">
                                  Sell All
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="text-center py-16 text-white/30">
                  <div className="text-4xl mb-3">💼</div>
                  <div className="font-serif text-lg text-white/45 mb-1">No open positions</div>
                  <p className="text-sm">Use the AI Screener to find your first stock</p>
                </div>
              )}
            </div>
          )}

          {/* ── AUTOPILOT ── */}
          {page === 'autopilot' && (
            <div>
              <div className="bg-violet-500/5 border border-violet-500/20 rounded-2xl p-5 mb-5">
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <div>
                    <h2 className="font-serif text-xl mb-1">AI Autopilot</h2>
                    <p className="text-white/45 text-sm max-w-lg leading-relaxed">
                      Claude monitors positions every 30 seconds using real-time quant signals. Auto-buys high-conviction opportunities, cuts losers at stop-loss, rides winners to take-profit.
                    </p>
                  </div>
                  <button onClick={() => setApOn(v => !v)}
                    className={`px-6 py-2.5 text-sm font-semibold rounded-xl transition-all ${
                      apOn ? 'bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500 hover:text-white'
                           : 'bg-violet-500/10 text-violet-400 border border-violet-500/30 hover:bg-violet-500 hover:text-white'
                    }`}>
                    {apOn ? '⏹ Disable Autopilot' : '▶ Enable Autopilot'}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                <div className="bg-[#13131f] border border-white/5 rounded-xl p-4">
                  <div className="text-[10px] text-white/25 uppercase tracking-wide mb-4">Strategy Settings</div>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-[10px] text-white/30 uppercase tracking-wider mb-1.5">Risk Profile</label>
                      <select value={apRisk} onChange={e => setApRisk(e.target.value)}
                        className="w-full bg-[#1f1f2e] border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:border-green-500/50">
                        <option value="conservative">Conservative</option>
                        <option value="moderate">Moderate</option>
                        <option value="aggressive">Aggressive</option>
                      </select>
                    </div>
                    {[['Max % per trade', apMax, setApMax, 1, 20, 1], ['Auto Stop Loss %', apStop, setApStop, 1, 25, 0.5], ['Auto Take Profit %', apTp, setApTp, 2, 100, 1]].map(([label, val, setter, min, max, step]) => (
                      <div key={String(label)}>
                        <label className="block text-[10px] text-white/30 uppercase tracking-wider mb-1.5">{String(label)}: <span className="text-white/60 font-mono">{String(val)}%</span></label>
                        <input type="range" value={Number(val)} onChange={e => (setter as any)(parseFloat(e.target.value))}
                          min={Number(min)} max={Number(max)} step={Number(step)}
                          className="w-full accent-green-500" />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="lg:col-span-2 bg-[#13131f] border border-white/5 rounded-xl p-4">
                  <div className="text-[10px] text-white/25 uppercase tracking-wide mb-3">Activity Log</div>
                  {apLog.length === 0 ? (
                    <div className="text-center py-8 text-white/25 text-sm">Enable autopilot to start logging activity</div>
                  ) : (
                    <div className="space-y-0">
                      {apLog.map((l, i) => (
                        <div key={i} className="flex justify-between py-2 border-b border-white/5 last:border-0 text-xs">
                          <span className="text-white/55">{l.msg}</span>
                          <span className="text-white/25 whitespace-nowrap ml-3">{new Date(l.ts).toLocaleTimeString('en-AU', {hour:'2-digit',minute:'2-digit'})}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── HISTORY ── */}
          {page === 'history' && (
            <div className="bg-[#13131f] border border-white/5 rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-white/5 flex flex-wrap items-center justify-between gap-3">
                <div className="text-[10px] text-white/25 uppercase tracking-wide">{filteredTxs.length} transactions</div>
                {/* FIX #15: filter tabs */}
                <div className="flex bg-[#1f1f2e] rounded-lg p-1 gap-0.5">
                  {(['all','buy','sell','auto'] as const).map(f => (
                    <button key={f} onClick={() => setHistFilter(f)}
                      className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${histFilter === f ? 'bg-[#0e0e1a] text-white' : 'text-white/35 hover:text-white/60'}`}>
                      {f.charAt(0).toUpperCase() + f.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              {filteredTxs.length === 0 ? (
                <div className="text-center py-16 text-white/30"><div className="text-4xl mb-3">📋</div><p>No transactions match this filter</p></div>
              ) : (
                filteredTxs.map(tx => (
                  <div key={tx.id} className="flex items-center justify-between px-5 py-3 border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded shrink-0 ${tx.type === 'buy' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>{tx.type}</span>
                      {tx.source !== 'manual' && <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-violet-500/10 text-violet-400 shrink-0">{tx.source}</span>}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs bg-[#1f1f2e] border border-white/10 rounded px-1.5 py-0.5 shrink-0">{tx.ticker}</span>
                          <span className="text-xs text-white/40 truncate">{tx.name}</span>
                          {tx.note && <span className="text-[10px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded shrink-0">{tx.note}</span>}
                        </div>
                        <div className="text-[11px] text-white/25 mt-0.5">
                          {tx.shares} sh · ${fmt(tx.price)}/sh · {new Date(tx.ts).toLocaleString('en-AU', {day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}
                        </div>
                      </div>
                    </div>
                    <div className={`font-mono text-sm shrink-0 ml-3 ${tx.type === 'buy' ? 'text-red-400' : 'text-green-400'}`}>
                      {tx.type === 'buy' ? '-' : '+'}${fmt(tx.total)}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* ── WATCHLIST ── */}
          {page === 'watchlist' && <WatchlistPage showToast={showToast} />}

          {/* ── COACH ── */}
          {page === 'coach' && (
            <div>
              <div className="bg-[#13131f] border border-white/5 rounded-xl p-5 mb-4">
                <div className="text-[10px] text-white/25 uppercase tracking-wide mb-3">AI Investment Coach</div>
                <p className="text-white/40 text-sm mb-4 leading-relaxed">
                  Ask anything about your portfolio, market conditions, specific stocks, or investment strategy. Claude knows your current positions and P&L.
                </p>
                <textarea value={coachQ} onChange={e => setCoachQ(e.target.value)}
                  placeholder="Ask anything… (Ctrl+Enter to send)"
                  onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') sendCoach(); }}
                  className="w-full bg-[#1f1f2e] border border-white/10 rounded-xl px-4 py-3 text-sm h-24 resize-none focus:border-green-500/50 outline-none mb-3 placeholder:text-white/25" />
                <div className="flex gap-2 flex-wrap mb-3">
                  {[
                    ['Portfolio risks', 'Analyse my portfolio and identify my top 3 risks with specific recommendations.'],
                    ['Diversify me', 'Am I well diversified? Suggest 3 specific tickers to add and why.'],
                    ['5-year plan', 'Create a realistic 5-year growth plan with $1,000/month additional investment.'],
                    ['Candle patterns', 'Explain Hammer, Doji, Bullish Engulfing and Shooting Star patterns with trading rules.'],
                    ['RSI & MACD', 'Explain how to use RSI, MACD, and Bollinger Bands together for timing entries and exits.'],
                    ['Hidden gems', 'Find 5 under-the-radar small/mid-cap stocks globally with strong fundamentals. Specific tickers only.'],
                  ].map(([label, q]) => (
                    <button key={String(label)} onClick={() => sendCoach(String(q))}
                      className="px-3 py-1.5 text-[11px] bg-[#1f1f2e] text-white/50 border border-white/10 rounded-lg hover:border-white/25 hover:text-white/70 transition-colors">
                      {String(label)}
                    </button>
                  ))}
                </div>
                <button onClick={() => sendCoach()} disabled={coachLoading}
                  className="px-5 py-2 bg-green-500 text-black text-sm font-semibold rounded-xl hover:bg-green-400 disabled:opacity-60">
                  {coachLoading ? 'Thinking…' : 'Ask Claude ↗'}
                </button>
              </div>

              {(coachReply || coachLoading) && (
                <div className="border-l-2 border-violet-500/40 bg-violet-500/5 rounded-r-xl p-5">
                  <div className="text-[10px] text-violet-400 uppercase tracking-wider font-semibold mb-3 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse" />Claude
                  </div>
                  {coachLoading ? (
                    <div className="flex gap-1">{[0,1,2].map(i => <div key={i} className="w-1.5 h-1.5 rounded-full bg-white/20 animate-bounce" style={{animationDelay:`${i*0.15}s`}} />)}</div>
                  ) : (
                    <div className="text-sm text-white/55 leading-relaxed space-y-3">
                      {coachReply.split('\n\n').map((p, i) => <p key={i}>{p}</p>)}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

        </div>
      </div>

      {/* Order modal */}
      {orderStock && <OrderModal stock={orderStock} onClose={() => setOrderStock(null)} showToast={showToast} />}

      {/* Validation / Live Mode Gate */}
      {validationResult && (
        <ValidationScreen
          result={validationResult}
          onConfirmLive={() => {
            store.setMode('live');
            setValidationResult(null);
            showToast('Switched to Live Trading Mode', 'ok');
          }}
          onStayPaper={() => {
            store.setMode('paper');
            setValidationResult(null);
          }}
        />
      )}

      {/* FIX #27: dynamic duration toast */}
      {toast && (
        <div className={`fixed bottom-5 right-5 z-[100] rounded-xl px-4 py-3 text-sm border shadow-xl max-w-xs ${
          toast.type === 'ok' ? 'bg-[#13131f] border-green-500/30 text-green-400'
          : toast.type === 'err' ? 'bg-[#13131f] border-red-500/30 text-red-400'
          : 'bg-[#13131f] border-violet-500/30 text-violet-400'
        }`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  );
}
