'use client';
import { useState, useEffect } from 'react';
import { useTraderStore, getPortfolioValue, type AppMode, type ModeState } from '@/lib/store';

interface ValidationResult {
  passed: boolean; score: number;
  checks: Array<{ id: string; label: string; passed: boolean; value: string; required: string; description: string }>;
  blockers: string[]; warnings: string[]; recommendation: string;
}

interface BrokerStatus {
  broker: string; mode: string;
  account?: { cashBalance: number; buyingPower: number; currency: string; connected: boolean; accountId: string; error?: string };
  configured: { ibkr: boolean; alpaca: boolean };
}

export function ModeSwitcher({ onValidate }: { onValidate: (result: ValidationResult) => void }) {
  const { mode, setMode, paper } = useTraderStore();
  const [validating, setValidating] = useState(false);
  const [brokerStatus, setBrokerStatus] = useState<BrokerStatus | null>(null);
  const [showBrokerInfo, setShowBrokerInfo] = useState(false);
  const paperValue = getPortfolioValue(paper);
  const paperPnl = paperValue - paper.startingCash;
  const paperPnlPct = (paperPnl / paper.startingCash) * 100;

  useEffect(() => {
    fetch('/api/trade').then(r => r.json()).then(setBrokerStatus).catch(() => {});
  }, []);

  const handleSwitchToLive = async () => {
    setValidating(true);
    try {
      const res = await fetch('/api/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactions: paper.transactions,
          history: paper.history,
          startingCash: paper.startingCash,
          currentValue: paperValue,
        }),
      });
      const result: ValidationResult = await res.json();
      onValidate(result);
    } catch (e) {
      onValidate({
        passed: false, score: 0, checks: [], blockers: ['Validation service error'],
        warnings: [], recommendation: 'Please try again.',
      });
    }
    setValidating(false);
  };

  const noBrokerConfigured = brokerStatus && !brokerStatus.configured.ibkr && !brokerStatus.configured.alpaca;

  return (
    <div className="flex items-center gap-3">
      {/* Mode toggle */}
      <div className="flex items-center bg-[#1f1f2e] border border-white/10 rounded-xl p-1 gap-1">
        <button
          onClick={() => setMode('paper')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            mode === 'paper'
              ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
              : 'text-white/40 hover:text-white/70'
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${mode === 'paper' ? 'bg-blue-400 animate-pulse' : 'bg-white/20'}`} />
          Training
        </button>
        <button
          onClick={mode === 'paper' ? handleSwitchToLive : () => setMode('paper')}
          disabled={validating}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            mode === 'live'
              ? 'bg-green-500/20 text-green-400 border border-green-500/30'
              : 'text-white/40 hover:text-white/70 disabled:opacity-50'
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${mode === 'live' ? 'bg-green-400 animate-pulse' : 'bg-white/20'}`} />
          {validating ? 'Checking…' : 'Live'}
        </button>
      </div>

      {/* Paper stats (when in paper mode) */}
      {mode === 'paper' && (
        <div className="hidden sm:flex items-center gap-2 text-xs text-white/40">
          <span>Paper P&L:</span>
          <span className={paperPnl >= 0 ? 'text-green-400' : 'text-red-400'}>
            {paperPnl >= 0 ? '+' : ''}{paperPnlPct.toFixed(1)}%
          </span>
          <span className="text-white/20">·</span>
          <span>{paper.transactions.filter(t => t.type === 'sell').length} trades</span>
        </div>
      )}

      {/* Live mode broker info */}
      {mode === 'live' && (
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            <span className="text-green-400 font-semibold">LIVE</span>
            {brokerStatus?.account?.connected && (
              <span className="text-white/40">· {brokerStatus.broker.toUpperCase()} · ${brokerStatus.account.cashBalance.toLocaleString('en-AU', { maximumFractionDigits: 0 })} available</span>
            )}
          </div>
          <button onClick={() => setShowBrokerInfo(v => !v)} className="text-white/30 hover:text-white/60 transition-colors">
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      )}

      {/* No broker warning */}
      {mode === 'live' && noBrokerConfigured && (
        <div className="text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-2 py-1">
          ⚠ No broker configured
        </div>
      )}
    </div>
  );
}

// ── Full Validation Screen ────────────────────────────────────────────────────
export function ValidationScreen({
  result,
  onConfirmLive,
  onStayPaper,
}: {
  result: ValidationResult;
  onConfirmLive: () => void;
  onStayPaper: () => void;
}) {
  const [brokerStatus, setBrokerStatus] = useState<BrokerStatus | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [showSetup, setShowSetup] = useState(false);

  useEffect(() => {
    fetch('/api/trade').then(r => r.json()).then(setBrokerStatus).catch(() => {});
  }, []);

  const noBroker = brokerStatus && !brokerStatus.configured.ibkr && !brokerStatus.configured.alpaca;
  const canGoLive = result.passed && !noBroker;

  const scoreColor = result.score >= 80 ? '#00d48a' : result.score >= 50 ? '#f59e0b' : '#ff3d5a';
  const circumference = 2 * Math.PI * 36;
  const dashOffset = circumference * (1 - result.score / 100);

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-[#13131f] border border-white/10 rounded-2xl w-full max-w-2xl shadow-2xl my-4">
        <div className="p-6 border-b border-white/5">
          <div className="flex items-start gap-5">
            {/* Score ring */}
            <div className="shrink-0">
              <svg width="88" height="88" viewBox="0 0 88 88">
                <circle cx="44" cy="44" r="36" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
                <circle cx="44" cy="44" r="36" fill="none" stroke={scoreColor} strokeWidth="6"
                  strokeDasharray={circumference} strokeDashoffset={dashOffset}
                  strokeLinecap="round" transform="rotate(-90 44 44)"
                  style={{ transition: 'stroke-dashoffset 0.8s ease' }}
                />
                <text x="44" y="44" textAnchor="middle" dominantBaseline="middle"
                  style={{ fill: scoreColor, fontSize: '18px', fontWeight: '700', fontFamily: 'monospace' }}>
                  {result.score}
                </text>
                <text x="44" y="58" textAnchor="middle" style={{ fill: 'rgba(255,255,255,0.3)', fontSize: '10px', fontFamily: 'sans-serif' }}>
                  / 100
                </text>
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="font-serif text-2xl mb-1">
                {result.passed ? 'Strategy Validated ✓' : 'Not Ready for Live Trading'}
              </h2>
              <p className="text-white/50 text-sm leading-relaxed">{result.recommendation}</p>
            </div>
          </div>
        </div>

        <div className="p-6">
          {/* Validation checks */}
          <div className="space-y-2.5 mb-6">
            {result.checks.map(check => (
              <div key={check.id}
                className={`flex items-start gap-3 p-3 rounded-xl border ${
                  check.passed
                    ? 'bg-green-500/5 border-green-500/15'
                    : 'bg-red-500/5 border-red-500/15'
                }`}>
                <div className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                  check.passed ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                }`}>
                  {check.passed ? '✓' : '✗'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <span className={`text-sm font-medium ${check.passed ? 'text-white/80' : 'text-white/60'}`}>{check.label}</span>
                    <div className="flex items-center gap-2 text-xs font-mono shrink-0">
                      <span className={check.passed ? 'text-green-400' : 'text-red-400'}>{check.value}</span>
                      <span className="text-white/20">req: {check.required}</span>
                    </div>
                  </div>
                  <p className="text-xs text-white/35 mt-0.5">{check.description}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Warnings */}
          {result.warnings.length > 0 && (
            <div className="mb-5">
              {result.warnings.map((w, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-amber-400/80 mb-1.5">
                  <span>⚠</span><span>{w}</span>
                </div>
              ))}
            </div>
          )}

          {/* Broker setup section */}
          {result.passed && (
            <div className={`rounded-xl border p-4 mb-5 ${
              noBroker ? 'bg-amber-500/5 border-amber-500/20' : 'bg-green-500/5 border-green-500/20'
            }`}>
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-semibold text-white/80">
                  {noBroker ? '⚠ Broker Connection Required' : '✓ Broker Connected'}
                </div>
                <button onClick={() => setShowSetup(v => !v)}
                  className="text-xs text-white/40 hover:text-white/70 transition-colors">
                  {showSetup ? 'Hide setup' : 'Show setup'}
                </button>
              </div>

              {noBroker && (
                <p className="text-xs text-amber-400/70 mb-3">
                  To place real trades, you need to configure a broker in your Vercel environment variables.
                </p>
              )}

              {brokerStatus?.account?.connected && (
                <div className="grid grid-cols-3 gap-2 text-xs">
                  {[
                    ['Broker', brokerStatus.broker.toUpperCase()],
                    ['Cash Available', '$' + (brokerStatus.account.cashBalance ?? 0).toLocaleString('en-AU', { maximumFractionDigits: 0 })],
                    ['Buying Power', '$' + (brokerStatus.account.buyingPower ?? 0).toLocaleString('en-AU', { maximumFractionDigits: 0 })],
                  ].map(([l, v]) => (
                    <div key={String(l)} className="bg-[#1f1f2e] rounded-lg p-2 text-center">
                      <div className="text-white/30 mb-0.5">{String(l)}</div>
                      <div className="font-mono text-white/80 font-medium">{String(v)}</div>
                    </div>
                  ))}
                </div>
              )}

              {showSetup && (
                <div className="mt-4 space-y-3">
                  <p className="text-xs text-white/40 leading-relaxed">
                    Add these to your Vercel Environment Variables (Project → Settings → Environment Variables):
                  </p>
                  <div className="space-y-2">
                    <div className="bg-[#0e0e1a] rounded-lg p-3">
                      <div className="text-[10px] text-amber-400 uppercase tracking-wide mb-1.5">Option A: Interactive Brokers (ASX + US + Global)</div>
                      <code className="text-xs text-white/60 block">BROKER=ibkr</code>
                      <code className="text-xs text-white/60 block">IBKR_GATEWAY_URL=https://localhost:5000/v1/api</code>
                      <p className="text-[10px] text-white/30 mt-1.5">Download IBKR Client Portal Gateway from interactivebrokers.com. Supports ASX, NYSE, NASDAQ, options, futures.</p>
                    </div>
                    <div className="bg-[#0e0e1a] rounded-lg p-3">
                      <div className="text-[10px] text-blue-400 uppercase tracking-wide mb-1.5">Option B: Alpaca (US stocks only, free)</div>
                      <code className="text-xs text-white/60 block">BROKER=alpaca</code>
                      <code className="text-xs text-white/60 block">ALPACA_KEY=your_key_here</code>
                      <code className="text-xs text-white/60 block">ALPACA_SECRET=your_secret_here</code>
                      <code className="text-xs text-white/60 block">ALPACA_PAPER=false</code>
                      <p className="text-[10px] text-white/30 mt-1.5">Get keys free at alpaca.markets. Commission-free US trading.</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Confirmation + actions */}
          {canGoLive && (
            <div className="mb-4">
              <label className="block text-xs text-white/40 mb-2 leading-relaxed">
                Type <span className="text-white/70 font-mono">I UNDERSTAND</span> to confirm you accept the risks of live trading with real money:
              </label>
              <input
                value={confirmText} onChange={e => setConfirmText(e.target.value.toUpperCase())}
                placeholder="I UNDERSTAND"
                className="w-full bg-[#1f1f2e] border border-white/10 rounded-lg px-3 py-2 font-mono text-sm focus:border-green-500/50 outline-none placeholder:text-white/20"
              />
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={onStayPaper}
              className="flex-1 py-2.5 bg-white/5 text-white/60 border border-white/10 rounded-xl hover:border-white/25 transition-colors text-sm">
              Continue Training
            </button>
            {canGoLive && (
              <button
                onClick={onConfirmLive}
                disabled={confirmText !== 'I UNDERSTAND'}
                className="flex-1 py-2.5 bg-green-500 text-black font-semibold rounded-xl hover:bg-green-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-sm"
              >
                Switch to Live Trading →
              </button>
            )}
            {result.passed && noBroker && (
              <button
                onClick={() => setShowSetup(true)}
                className="flex-1 py-2.5 bg-amber-500/10 text-amber-400 border border-amber-500/30 rounded-xl hover:bg-amber-500/20 transition-colors text-sm"
              >
                Configure Broker First
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
