import math
import asyncio
from datetime import date
from typing import Dict, List, Optional
from collections import defaultdict

from db import get_pool

COMMISSION_RATE = 0.00025
STAMP_TAX = 0.001
SLIPPAGE = 0.001


async def _get_metric_dates(pool, start_date: str, end_date: str) -> List[str]:
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT DISTINCT metric_date
            FROM daily_metrics
            WHERE metric_date >= $1 AND metric_date <= $2
            ORDER BY metric_date ASC
        """, start_date, end_date)
    return [r["metric_date"].isoformat() if hasattr(r["metric_date"], "isoformat") else str(r["metric_date"]) for r in rows]


async def _get_top_n_by_score(pool, date: str, score_sql: str, top_n: int) -> List[dict]:
    async with pool.acquire() as conn:
        rows = await conn.fetch(f"""
            SELECT dm.code, dm.name, ({score_sql}) AS score
            FROM daily_metrics dm
            INNER JOIN klines k ON k.code = dm.code AND k.date = dm.metric_date
            WHERE dm.metric_date = $1
            ORDER BY score DESC
            LIMIT $2
        """, date, top_n)
    return [{"code": r["code"], "name": r["name"], "score": float(r["score"] or 0)} for r in rows]


async def _get_klines_for_codes(pool, codes: List[str], start_date: str, end_date: str) -> Dict[str, List[dict]]:
    if not codes:
        return {}
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT code, date, close
            FROM klines
            WHERE code = ANY($1::varchar[])
              AND date >= $2
              AND date <= $3
            ORDER BY date ASC
        """, codes, start_date, end_date)
    result = defaultdict(list)
    for r in rows:
        d = r["date"].isoformat() if hasattr(r["date"], "isoformat") else str(r["date"])
        result[r["code"]].append({"date": d, "close": float(r["close"])})
    return dict(result)


def _find_price(prices: List[dict], target_date: str) -> Optional[float]:
    for p in prices:
        if p["date"] == target_date:
            return p["close"]
    return None


def _find_price_nearest(prices: List[dict], target_date: str) -> float:
    price = _find_price(prices, target_date)
    if price is not None:
        return price
    if prices:
        return prices[-1]["close"]
    return 0.0


async def does_stock_satisfy_conditions(pool, date: str, code: str, conditions: List[str]) -> bool:
    if not conditions:
        return True
    where_clause = " AND ".join(f"({c})" for c in conditions)
    async with pool.acquire() as conn:
        row = await conn.fetchrow(f"""
            SELECT 1 AS ok
            FROM daily_metrics
            WHERE metric_date = $1
              AND code = $2
              AND ({where_clause})
            LIMIT 1
        """, date, code)
    return row is not None


async def run_strategy_backtest(
    strategy_key: str,
    strategy_label: str,
    score_sql: str,
    conditions: List[str],
    start_date: str,
    end_date: str,
    initial_capital: float,
    top_n: int,
    holding_days: int,
    progress_callback=None,
) -> dict:
    pool = await get_pool()
    dates = await _get_metric_dates(pool, start_date, end_date)

    if not dates:
        return {"stats": _empty_stats(), "trades": [], "equityCurve": []}

    cash = initial_capital
    positions = {}  # code -> {code, name, entryDate, entryDayIndex, entryPrice, shares, score}
    all_trades = []
    equity_curve = []
    all_codes = set()

    date_results: Dict[str, List[dict]] = {}
    total_dates = len(dates)

    for di, d in enumerate(dates):
        top = await _get_top_n_by_score(pool, d, score_sql, top_n + len(positions))
        date_results[d] = top
        for s in top:
            all_codes.add(s["code"])
        if progress_callback:
            await progress_callback(strategy_key, "fetching_scores", round((di + 1) / total_dates * 20))
        await asyncio.sleep(0)

    for code in positions:
        all_codes.add(code)

    kline_map = await _get_klines_for_codes(pool, list(all_codes), start_date, end_date)
    if progress_callback:
        await progress_callback(strategy_key, "fetched_klines", 25)

    wins = 0
    losses = 0
    trade_count = 0
    processed = 0

    for i, d in enumerate(dates):
        today_top = date_results.get(d, [])
        top_code_set = {s["code"] for s in today_top}

        positions_to_close = []

        for code, pos in list(positions.items()):
            days_held = i - pos["entryDayIndex"]
            should_sell = days_held >= holding_days
            if not should_sell and conditions:
                still = await does_stock_satisfy_conditions(pool, d, code, conditions)
                if not still:
                    should_sell = True

            if should_sell:
                prices = kline_map.get(code, [])
                exit_price = _find_price(prices, d)
                if exit_price is None:
                    exit_price = _find_price_nearest(prices, d)

                sell_price = exit_price * (1 - SLIPPAGE)
                proceeds = pos["shares"] * sell_price
                comm = proceeds * COMMISSION_RATE
                tax = proceeds * STAMP_TAX
                cost_basis = pos["shares"] * pos["entryPrice"]
                pnl = proceeds - comm - tax - cost_basis
                ret_pct = (pnl / cost_basis * 100) if cost_basis > 0 else 0

                all_trades.append({
                    "entryDate": pos["entryDate"], "exitDate": d,
                    "code": code, "name": pos["name"],
                    "entryPrice": round(pos["entryPrice"], 4), "exitPrice": round(sell_price, 4),
                    "shares": pos["shares"], "pnl": round(pnl, 2),
                    "returnPct": round(ret_pct, 2),
                    "holdingDays": days_held, "score": pos["score"],
                })

                if pnl > 0:
                    wins += 1
                else:
                    losses += 1
                trade_count += 1
                cash += proceeds - comm - tax
                positions_to_close.append(code)

        for code in positions_to_close:
            del positions[code]

        available_slots = top_n - len(positions)
        if available_slots > 0:
            new_candidates = [s for s in today_top if s["code"] not in positions][:available_slots]
            total_score = sum(s["score"] for s in new_candidates)

            for cand in new_candidates:
                prices = kline_map.get(cand["code"], [])
                entry_price_val = _find_price(prices, d)
                if entry_price_val is None:
                    continue

                if total_score > 0:
                    alloc = (cash * cand["score"]) / total_score
                else:
                    alloc = cash / len(new_candidates)

                buy_price = entry_price_val * (1 + SLIPPAGE)
                max_shares = int(alloc / buy_price / 100) * 100
                if max_shares <= 0:
                    continue

                cost = max_shares * buy_price
                comm = cost * COMMISSION_RATE
                if cost + comm > cash:
                    continue

                cash -= cost + comm
                positions[cand["code"]] = {
                    "code": cand["code"], "name": cand["name"],
                    "entryDate": d, "entryDayIndex": i,
                    "entryPrice": buy_price, "shares": max_shares, "score": cand["score"],
                }

        positions_value = 0.0
        for code, pos in positions.items():
            prices = kline_map.get(code, [])
            cur = _find_price_nearest(prices, d) if prices else pos["entryPrice"]
            positions_value += pos["shares"] * cur

        equity_curve.append({"date": d, "value": round(cash + positions_value, 2)})

        processed += 1
        if progress_callback:
            pct = 25 + round(processed / total_dates * 70)
            await progress_callback(strategy_key, "simulating", pct)
        await asyncio.sleep(0)

    last_date = dates[-1]
    for code, pos in list(positions.items()):
        prices = kline_map.get(code, [])
        exit_p = _find_price_nearest(prices, last_date)
        sell_price = exit_p * (1 - SLIPPAGE)
        proceeds = pos["shares"] * sell_price
        comm = proceeds * COMMISSION_RATE
        tax = proceeds * STAMP_TAX
        cost_basis = pos["shares"] * pos["entryPrice"]
        pnl = proceeds - comm - tax - cost_basis
        ret_pct = (pnl / cost_basis * 100) if cost_basis > 0 else 0

        all_trades.append({
            "entryDate": pos["entryDate"], "exitDate": last_date,
            "code": code, "name": pos["name"],
            "entryPrice": round(pos["entryPrice"], 4), "exitPrice": round(sell_price, 4),
            "shares": pos["shares"], "pnl": round(pnl, 2),
            "returnPct": round(ret_pct, 2),
            "holdingDays": len(dates) - 1 - pos["entryDayIndex"], "score": pos["score"],
        })
        if pnl > 0:
            wins += 1
        else:
            losses += 1
        trade_count += 1
        cash += proceeds - comm - tax

    final_equity = cash
    total_return = ((final_equity - initial_capital) / initial_capital * 100) if initial_capital > 0 else 0
    trading_days = len(equity_curve) - 1
    annual_return = total_return * (252 / max(trading_days, 1)) if trading_days > 0 else 0

    returns = []
    for j in range(1, len(equity_curve)):
        prev = equity_curve[j - 1]["value"]
        if prev != 0:
            r = (equity_curve[j]["value"] - prev) / prev
            if r != 0:
                returns.append(r)

    if returns:
        import numpy as np
        avg_ret = float(np.mean(returns))
        std_dev = float(np.std(returns, ddof=1)) if len(returns) > 1 else 0.0
        sharpe = (avg_ret / std_dev) * math.sqrt(252) if std_dev > 0 else 0.0
    else:
        sharpe = 0.0

    peak = initial_capital
    max_dd = 0.0
    for e in equity_curve:
        if e["value"] > peak:
            peak = e["value"]
        dd = ((peak - e["value"]) / peak * 100) if peak > 0 else 0
        if dd > max_dd:
            max_dd = dd

    win_rate = (wins / trade_count * 100) if trade_count > 0 else 0
    avg_hold = sum(t["holdingDays"] for t in all_trades) / len(all_trades) if all_trades else 0

    def _avg_ret_for_period(period: int) -> float:
        filtered = [t for t in all_trades if t["holdingDays"] >= period]
        if not filtered:
            return 0.0
        return sum(t["returnPct"] for t in filtered) / len(filtered)

    stats = {
        "totalReturn": round(total_return, 2),
        "annualReturn": round(annual_return, 2),
        "sharpe": round(sharpe, 4),
        "maxDrawdown": round(max_dd, 2),
        "winRate": round(win_rate, 2),
        "tradeCount": trade_count,
        "avgHoldDays": round(avg_hold, 2),
        "return1d": round(_avg_ret_for_period(1), 2),
        "return3d": round(_avg_ret_for_period(3), 2),
        "return5d": round(_avg_ret_for_period(5), 2),
        "return10d": round(_avg_ret_for_period(10), 2),
    }

    return {"stats": stats, "trades": all_trades, "equityCurve": equity_curve}


async def run_strategy_backtest_all_periods(
    strategy_key: str,
    strategy_label: str,
    score_sql: str,
    conditions: List[str],
    start_date: str,
    end_date: str,
    initial_capital: float,
    top_n: int,
    progress_callback=None,
) -> dict:
    periods = [1, 3, 5, 10]
    results = {}
    for days in periods:
        results[str(days)] = await run_strategy_backtest(
            strategy_key=strategy_key,
            strategy_label=strategy_label,
            score_sql=score_sql,
            conditions=conditions,
            start_date=start_date,
            end_date=end_date,
            initial_capital=initial_capital,
            top_n=top_n,
            holding_days=days,
            progress_callback=progress_callback,
        )
    return results


def _empty_stats() -> dict:
    return {
        "totalReturn": 0, "annualReturn": 0, "sharpe": 0,
        "maxDrawdown": 0, "winRate": 0, "tradeCount": 0,
        "avgHoldDays": 0, "return1d": 0, "return3d": 0, "return5d": 0, "return10d": 0,
    }
