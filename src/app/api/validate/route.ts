import { NextRequest, NextResponse } from 'next/server';

// Minimum thresholds to unlock Live Mode
const REQUIREMENTS = {
  minTrades: 20,              // at least 20 completed trades
  minDays: 14,                // at least 14 days of trading
  minWinRate: 45,             // at least 45% win rate
  minReturnPct: 0,            // not losing money overall
  maxDrawdownPct: 25,         // max drawdown under 25%
  minSharpeProxy: 0.3,        // basic return/volatility ratio
};

interface ValidationInput {
  transactions: Array<{
    id: string; type: 'buy' | 'sell'; ticker: string;
    shares: number; price: number; total: number; ts: number; source: string;
  }>;
  history: Array<{ ts: number; value: number }>;
  startingCash: number;
  currentValue: number;
}

interface ValidationResult {
  passed: boolean;
  score: number; // 0-100
  checks: Array<{
    id: string;
    label: string;
    passed: boolean;
    value: string;
    required: string;
    description: string;
  }>;
  blockers: string[];
  warnings: string[];
  recommendation: string;
}

export async function POST(req: NextRequest) {
  try {
    const body: ValidationInput = await req.json();
    const { transactions, history, startingCash, currentValue } = body;

    const checks: ValidationResult['checks'] = [];
    const blockers: string[] = [];
    const warnings: string[] = [];

    // ── 1. Trade count ────────────────────────────────────────────────────────
    const sells = transactions.filter(t => t.type === 'sell' && t.source === 'manual');
    const tradeCount = sells.length;
    const tradePassed = tradeCount >= REQUIREMENTS.minTrades;
    checks.push({
      id: 'trade_count', label: 'Minimum Trade History',
      passed: tradePassed,
      value: `${tradeCount} trades`,
      required: `≥ ${REQUIREMENTS.minTrades} trades`,
      description: 'You need enough trade history to assess your strategy reliably.',
    });
    if (!tradePassed) blockers.push(`Complete ${REQUIREMENTS.minTrades - tradeCount} more trades`);

    // ── 2. Time in market ─────────────────────────────────────────────────────
    const firstTs = transactions[0]?.ts ?? Date.now();
    const daysTradingMs = Date.now() - firstTs;
    const daysTrading = Math.floor(daysTradingMs / (24 * 60 * 60 * 1000));
    const daysPassed = daysTrading >= REQUIREMENTS.minDays;
    checks.push({
      id: 'days_trading', label: 'Time in Market',
      passed: daysPassed,
      value: `${daysTrading} days`,
      required: `≥ ${REQUIREMENTS.minDays} days`,
      description: 'Strategy needs to be tested across multiple market conditions.',
    });
    if (!daysPassed) blockers.push(`Trade for ${REQUIREMENTS.minDays - daysTrading} more days`);

    // ── 3. Win rate ───────────────────────────────────────────────────────────
    let wins = 0;
    for (const sell of sells) {
      const buys = transactions.filter(t => t.type === 'buy' && t.ticker === sell.ticker && t.ts < sell.ts);
      if (buys.length > 0) {
        const avgBuy = buys.reduce((s, b) => s + b.price, 0) / buys.length;
        if (sell.price > avgBuy) wins++;
      }
    }
    const winRate = sells.length > 0 ? (wins / sells.length) * 100 : 0;
    const winPassed = winRate >= REQUIREMENTS.minWinRate;
    checks.push({
      id: 'win_rate', label: 'Win Rate',
      passed: winPassed,
      value: `${winRate.toFixed(1)}%`,
      required: `≥ ${REQUIREMENTS.minWinRate}%`,
      description: 'Percentage of closed trades that were profitable.',
    });
    if (!winPassed) warnings.push(`Win rate ${winRate.toFixed(1)}% is below ${REQUIREMENTS.minWinRate}% threshold`);

    // ── 4. Overall return ─────────────────────────────────────────────────────
    const returnPct = ((currentValue - startingCash) / startingCash) * 100;
    const returnPassed = returnPct >= REQUIREMENTS.minReturnPct;
    checks.push({
      id: 'return', label: 'Overall Return',
      passed: returnPassed,
      value: `${returnPct >= 0 ? '+' : ''}${returnPct.toFixed(2)}%`,
      required: `≥ ${REQUIREMENTS.minReturnPct}%`,
      description: 'Your paper portfolio must not be losing money overall.',
    });
    if (!returnPassed) blockers.push(`Portfolio is down ${Math.abs(returnPct).toFixed(1)}% — strategy needs improvement`);

    // ── 5. Max drawdown ───────────────────────────────────────────────────────
    let peak = startingCash;
    let maxDrawdown = 0;
    for (const point of history) {
      if (point.value > peak) peak = point.value;
      const dd = peak > 0 ? ((peak - point.value) / peak) * 100 : 0;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }
    const drawdownPassed = maxDrawdown <= REQUIREMENTS.maxDrawdownPct;
    checks.push({
      id: 'drawdown', label: 'Max Drawdown',
      passed: drawdownPassed,
      value: `${maxDrawdown.toFixed(1)}%`,
      required: `≤ ${REQUIREMENTS.maxDrawdownPct}%`,
      description: 'Largest peak-to-trough loss. High drawdown means your risk management needs work.',
    });
    if (!drawdownPassed) blockers.push(`Max drawdown of ${maxDrawdown.toFixed(1)}% exceeds ${REQUIREMENTS.maxDrawdownPct}% limit`);

    // ── 6. Consistency (basic Sharpe proxy) ───────────────────────────────────
    const dailyReturns: number[] = [];
    for (let i = 1; i < history.length; i++) {
      const prev = history[i - 1].value;
      if (prev > 0) dailyReturns.push((history[i].value - prev) / prev);
    }
    let sharpeProxy = 0;
    if (dailyReturns.length > 5) {
      const mean = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length;
      const variance = dailyReturns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / dailyReturns.length;
      const stdDev = Math.sqrt(variance);
      sharpeProxy = stdDev > 0 ? mean / stdDev : 0;
    }
    const sharpePassed = sharpeProxy >= REQUIREMENTS.minSharpeProxy;
    checks.push({
      id: 'consistency', label: 'Return Consistency',
      passed: sharpePassed,
      value: sharpeProxy.toFixed(2),
      required: `≥ ${REQUIREMENTS.minSharpeProxy}`,
      description: 'Risk-adjusted return ratio. Higher = more consistent gains relative to volatility.',
    });
    if (!sharpePassed && dailyReturns.length > 5) {
      warnings.push('Returns are inconsistent — focus on reducing volatility');
    }

    // ── 7. Risk management usage ──────────────────────────────────────────────
    const stopTrades = transactions.filter(t => t.source === 'stop').length;
    const hasStopLossHabit = stopTrades > 0 || sells.length < 5; // forgive if early
    checks.push({
      id: 'risk_mgmt', label: 'Stop-Loss Usage',
      passed: hasStopLossHabit,
      value: `${stopTrades} stop-loss exits`,
      required: 'Active risk management',
      description: 'Using stop-losses consistently is critical before trading real money.',
    });
    if (!hasStopLossHabit) warnings.push('No stop-loss exits recorded — set stop-losses on all trades');

    // ── Score ─────────────────────────────────────────────────────────────────
    const passedCount = checks.filter(c => c.passed).length;
    const score = Math.round((passedCount / checks.length) * 100);
    const hardBlockersPassed = !checks.filter(c => c.id === 'trade_count' || c.id === 'days_trading' || c.id === 'return' || c.id === 'drawdown').some(c => !c.passed);

    // ── Recommendation ────────────────────────────────────────────────────────
    let recommendation = '';
    if (blockers.length === 0 && score >= 80) {
      recommendation = `Strong performance — your strategy shows ${winRate.toFixed(0)}% win rate over ${daysTrading} days. You are ready to consider live trading. Start with a small allocation (5–10% of intended capital) to validate execution fills and slippage.`;
    } else if (score >= 60) {
      recommendation = `Good progress with ${passedCount}/${checks.length} checks passed. Address the remaining issues before going live, particularly: ${blockers.slice(0, 2).join(', ') || 'see warnings above'}.`;
    } else {
      recommendation = `More paper trading needed. You have ${tradeCount} trades over ${daysTrading} days — aim for at least ${REQUIREMENTS.minTrades} trades over ${REQUIREMENTS.minDays}+ days with consistent profitability before risking real capital.`;
    }

    const result: ValidationResult = {
      passed: hardBlockersPassed && blockers.length === 0,
      score,
      checks,
      blockers,
      warnings,
      recommendation,
    };

    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
