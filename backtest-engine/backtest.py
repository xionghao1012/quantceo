import numpy as np
from typing import Optional
from indicators import calc_ma, calc_macd, calc_rsi, calc_bollinger


COMMISSION_RATE = 0.00025
STAMP_TAX = 0.001
SLIPPAGE = 0.001


class LazyIndicators:
    def __init__(self, closes, highs, lows):
        self.closes = closes
        self._mas = {}
        self._macd = None
        self._rsi = None
        self._bollinger = None
        self._needs = set()

    def ensure(self, needed: set):
        self._needs = needed
        for ind in needed:
            if ind.startswith("MA"):
                p = int(ind[2:])
                if p not in self._mas:
                    self._mas[p] = calc_ma(self.closes, p)
        if "rsi" in needed and self._rsi is None:
            self._rsi = calc_rsi(self.closes)
        if any(k in needed for k in ("macd", "macdSignal", "macdHistogram")) and self._macd is None:
            self._macd = calc_macd(self.closes)
        bb_needed = any(k in needed for k in ("bbUpper", "bbMiddle", "bbLower"))
        if bb_needed and self._bollinger is None:
            self._bollinger = calc_bollinger(self.closes)

    def value_at(self, i: int) -> dict:
        v = {"close": self.closes[i] if i < len(self.closes) else np.nan}
        for p, ma in self._mas.items():
            v[f"MA{p}"] = float(ma[i]) if i < len(ma) and not np.isnan(ma[i]) else np.nan
        if self._rsi is not None:
            v["rsi"] = float(self._rsi[i]) if i < len(self._rsi) and not np.isnan(self._rsi[i]) else np.nan
        if self._macd is not None:
            v["macd"] = float(self._macd["macd"][i]) if i < len(self._macd["macd"]) and not np.isnan(self._macd["macd"][i]) else np.nan
            v["macdSignal"] = float(self._macd["signal"][i]) if i < len(self._macd["signal"]) and not np.isnan(self._macd["signal"][i]) else np.nan
            v["macdHistogram"] = float(self._macd["histogram"][i]) if i < len(self._macd["histogram"]) and not np.isnan(self._macd["histogram"][i]) else np.nan
        if self._bollinger is not None:
            v["bbUpper"] = float(self._bollinger["upper"][i]) if i < len(self._bollinger["upper"]) and not np.isnan(self._bollinger["upper"][i]) else np.nan
            v["bbMiddle"] = float(self._bollinger["middle"][i]) if i < len(self._bollinger["middle"]) and not np.isnan(self._bollinger["middle"][i]) else np.nan
            v["bbLower"] = float(self._bollinger["lower"][i]) if i < len(self._bollinger["lower"]) and not np.isnan(self._bollinger["lower"][i]) else np.nan
        return v


def _extract_needed_from_rule(rule: dict) -> set:
    needed = set()
    left = rule.get("left", {})
    right = rule.get("right", {})
    for side in (left, right):
        if isinstance(side, dict):
            t = side.get("type", side.get("kind", ""))
            if t == "indicator":
                ind = side.get("indicator", side.get("name", ""))
                needed.add(ind)
    return needed


def _resolve(val, values: dict) -> float:
    if isinstance(val, (int, float)):
        return float(val)
    if isinstance(val, str):
        return float(values.get(val, np.nan))
    return np.nan


def _evaluate_rule(rule: dict, values: dict, prev_values: dict) -> dict:
    left = rule.get("left", {})
    right = rule.get("right", {})
    op = rule.get("operator", "cross_above")
    lv = _resolve(left, values)
    rv = _resolve(right, values)
    plv = _resolve(left, prev_values)
    prv = _resolve(right, prev_values)

    if op == "cross_above":
        triggered = (plv <= prv) and (lv > rv)
    elif op == "cross_below":
        triggered = (plv >= prv) and (lv < rv)
    elif op == "gt" or op == ">":
        triggered = lv > rv
    elif op == "lt" or op == "<":
        triggered = lv < rv
    elif op == "gte" or op == ">=":
        triggered = lv >= rv
    elif op == "lte" or op == "<=":
        triggered = lv <= rv
    else:
        triggered = False

    return {"triggered": triggered, "signal": rule.get("signal", ""), "left": lv, "right": rv}


def run_signal_backtest(klines: list, rules: list, start_date: Optional[str] = None,
                        end_date: Optional[str] = None, initial_capital: float = 100000) -> dict:
    n = len(klines)
    if n == 0:
        return _empty_result()

    closes = np.array([k["close"] for k in klines], dtype=np.float64)
    highs = np.array([k.get("high", k["close"]) for k in klines], dtype=np.float64)
    lows = np.array([k.get("low", k["close"]) for k in klines], dtype=np.float64)
    dates = [k.get("date", "") for k in klines]

    needed_all = set()
    for r in rules:
        needed_all |= _extract_needed_from_rule(r)

    warmup = 30
    for ind in needed_all:
        if ind.startswith("MA"):
            warmup = max(warmup, int(ind[2:]))
    if "rsi" in needed_all:
        warmup = max(warmup, 14)
    if any(k in needed_all for k in ("macd", "macdSignal", "macdHistogram")):
        warmup = max(warmup, 26)
    if any(k in needed_all for k in ("bbUpper", "bbMiddle", "bbLower")):
        warmup = max(warmup, 20)

    lazy = LazyIndicators(closes, highs, lows)
    lazy.ensure(needed_all)

    start_idx = warmup
    end_idx = n - 1
    if start_date:
        for i in range(len(dates)):
            if dates[i] >= start_date:
                start_idx = max(start_idx, i)
                break
    if end_date:
        for i in range(n - 1, -1, -1):
            if dates[i] <= end_date:
                end_idx = min(n - 1, i)
                break

    capital = initial_capital
    holdings = 0
    entry_price = 0.0
    entry_date = ""
    trades_list = []
    equity = []
    peak = capital
    max_drawdown = 0.0
    wins = 0
    losses = 0

    for i in range(max(warmup, start_idx), min(end_idx + 1, n)):
        k = klines[i]
        values = lazy.value_at(i)
        prev_values = lazy.value_at(max(0, i - 1))

        signals = []
        for r in rules:
            res = _evaluate_rule(r, values, prev_values)
            if res["triggered"] and res["signal"]:
                signals.append(res["signal"])

        close_price = float(k["close"])
        if "BUY" in signals and holdings == 0:
            price = close_price * (1 + SLIPPAGE)
            shares = int(capital / price / 100) * 100
            cost = shares * price
            commission = cost * COMMISSION_RATE
            if cost + commission <= capital:
                holdings = shares
                capital -= (cost + commission)
                entry_price = price
                entry_date = dates[i]
        elif "SELL" in signals and holdings > 0:
            price = close_price * (1 - SLIPPAGE)
            proceeds = holdings * price
            commission = proceeds * COMMISSION_RATE
            tax = proceeds * STAMP_TAX
            cost_basis = holdings * entry_price
            pnl = proceeds - commission - tax - cost_basis
            trades_list.append({
                "entryDate": entry_date, "exitDate": dates[i],
                "direction": "SELL", "entryPrice": entry_price, "exitPrice": price,
                "shares": holdings, "pnl": round(pnl, 2),
                "returnPct": round(pnl / cost_basis * 100, 2) if cost_basis > 0 else 0,
            })
            if pnl > 0:
                wins += 1
            else:
                losses += 1
            capital += proceeds - commission - tax
            holdings = 0

        total_value = capital + holdings * close_price
        equity.append({"date": dates[i], "value": round(total_value, 2)})
        if total_value > peak:
            peak = total_value
        dd = (peak - total_value) / peak * 100 if peak > 0 else 0
        if dd > max_drawdown:
            max_drawdown = dd

    total_return = (equity[-1]["value"] - initial_capital) / initial_capital * 100 if equity else 0
    total_trades = len(trades_list)
    win_rate = wins / total_trades * 100 if total_trades > 0 else 0

    returns = []
    for j in range(1, len(equity)):
        prev = equity[j - 1]["value"]
        if prev != 0:
            r = (equity[j]["value"] - prev) / prev
            if r != 0:
                returns.append(r)
    trading_days = len(equity) - 1
    if returns:
        avg_ret = np.mean(returns)
        std_dev = np.std(returns, ddof=1) if len(returns) > 1 else 0
        sharpe = (avg_ret / std_dev) * np.sqrt(252) if std_dev > 0 else 0
    else:
        sharpe = 0

    annual_return = total_return * (252 / max(trading_days, 1))

    return {
        "totalReturn": round(total_return, 2),
        "annualReturn": round(annual_return, 2),
        "sharpe": round(sharpe, 4),
        "maxDrawdown": round(max_drawdown, 2),
        "winRate": round(win_rate, 2),
        "tradeCount": total_trades,
        "trades": trades_list,
        "equity": equity,
    }


def _empty_result() -> dict:
    return {
        "totalReturn": 0, "annualReturn": 0, "sharpe": 0,
        "maxDrawdown": 0, "winRate": 0, "tradeCount": 0,
        "trades": [], "equity": [],
    }
