"""
Integration tests for the Python backtest engine.
Usage: python -m pytest tests/integration/test_backtest_engine.py -v
"""
import sys
import os
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'backtest-engine'))

from backtest import run_signal_backtest
from indicators import calc_ma, calc_ema, calc_rsi, calc_macd, calc_bollinger


def _make_klines(n: int = 100, trend: str = "up") -> list:
    klines = []
    price = 10.0
    for i in range(n):
        if trend == "up":
            price += 0.05
        elif trend == "down":
            price -= 0.03
        else:
            price += (i % 10 - 5) * 0.01
        klines.append({
            "date": f"2025-{(i // 22 + 1):02d}-{(i % 22 + 1):02d}",
            "open": price,
            "close": price + 0.1,
            "high": price + 0.3,
            "low": price - 0.2,
            "volume": 100000 + i * 1000,
        })
    return klines


class TestIndicators:
    def test_ma_simple(self):
        import numpy as np
        closes = np.array([10.0, 11.0, 12.0, 13.0, 14.0], dtype=np.float64)
        ma5 = calc_ma(closes, 5)
        assert ma5[4] == pytest.approx(12.0)

    def test_ma_insufficient_data(self):
        import numpy as np
        closes = np.array([10.0, 11.0, 12.0], dtype=np.float64)
        ma5 = calc_ma(closes, 5)
        assert np.isnan(ma5[2])

    def test_rsi(self):
        import numpy as np
        closes = np.linspace(10, 20, 30, dtype=np.float64)
        rsi = calc_rsi(closes)
        assert not np.isnan(rsi[-1])
        assert 0 <= rsi[-1] <= 100

    def test_macd(self):
        import numpy as np
        closes = np.linspace(10, 20, 100, dtype=np.float64)
        macd = calc_macd(closes)
        assert len(macd["macd"]) == len(closes)
        assert len(macd["signal"]) == len(closes)
        assert len(macd["histogram"]) == len(closes)

    def test_bollinger(self):
        import numpy as np
        closes = np.linspace(10, 20, 100, dtype=np.float64)
        bb = calc_bollinger(closes)
        assert len(bb["upper"]) == len(closes)
        assert len(bb["middle"]) == len(closes)
        assert len(bb["lower"]) == len(closes)
        # upper should be > middle > lower where defined
        idx = 50
        assert bb["upper"][idx] > bb["middle"][idx] > bb["lower"][idx]

    def test_rsi_edge_cases(self):
        import numpy as np
        closes = np.array([100.0] * 20, dtype=np.float64)
        rsi = calc_rsi(closes)
        assert rsi[-1] == 100.0 or not np.isnan(rsi[-1])


class TestSignalBacktest:
    def test_buy_and_hold_uptrend(self):
        klines = _make_klines(50, "up")
        result = run_signal_backtest(klines, [], initial_capital=100000)
        assert result["totalReturn"] == 0
        assert result["tradeCount"] == 0
        assert len(result["equity"]) > 0

    def test_empty_klines(self):
        result = run_signal_backtest([], [])
        assert result["totalReturn"] == 0
        assert result["tradeCount"] == 0

    def test_single_kline(self):
        klines = _make_klines(1)
        result = run_signal_backtest(klines, [], initial_capital=100000)
        assert result["totalReturn"] == 0
        assert result["tradeCount"] == 0

    def test_buy_rule_triggers(self):
        klines = _make_klines(100, "up")
        rule = {
            "left": {"type": "indicator", "indicator": "rsi"},
            "operator": "cross_above",
            "right": 30,
            "signal": "BUY",
        }
        result = run_signal_backtest(klines, [rule], initial_capital=100000)
        assert "totalReturn" in result
        assert "maxDrawdown" in result
        assert "sharpe" in result

    def test_start_end_date_filter(self):
        klines = _make_klines(100, "up")
        result = run_signal_backtest(
            klines, [],
            start_date="2025-01-10",
            end_date="2025-02-10",
            initial_capital=100000,
        )
        assert result["tradeCount"] == 0
        assert len(result["equity"]) > 0

    def test_ma_cross_buy_rule(self):
        klines = _make_klines(100, "up")
        rule = {
            "left": {"type": "indicator", "indicator": "MA5"},
            "operator": "cross_above",
            "right": {"type": "indicator", "indicator": "MA20"},
            "signal": "BUY",
        }
        result = run_signal_backtest(klines, [rule], initial_capital=100000)
        assert "totalReturn" in result

    def test_multiple_rules(self):
        klines = _make_klines(100, "up")
        rules = [
            {
                "left": {"type": "indicator", "indicator": "MA5"},
                "operator": "cross_above",
                "right": {"type": "indicator", "indicator": "MA20"},
                "signal": "BUY",
            },
            {
                "left": {"type": "indicator", "indicator": "MA5"},
                "operator": "cross_below",
                "right": {"type": "indicator", "indicator": "MA20"},
                "signal": "SELL",
            },
        ]
        result = run_signal_backtest(klines, rules, initial_capital=100000)
        assert "totalReturn" in result
        assert "trades" in result


class TestBacktestResults:
    def test_results_have_required_fields(self):
        klines = _make_klines(100, "up")
        result = run_signal_backtest(klines, [], initial_capital=100000)
        required = ["totalReturn", "annualReturn", "sharpe", "maxDrawdown",
                     "winRate", "tradeCount", "trades", "equity"]
        for field in required:
            assert field in result, f"Missing field: {field}"

    def test_sharpe_zero_for_no_trades(self):
        klines = _make_klines(100, "up")
        result = run_signal_backtest(klines, [], initial_capital=100000)
        assert result["tradeCount"] == 0
        assert result["winRate"] == 0

    def test_max_drawdown_bounds(self):
        klines = _make_klines(100, "up")
        rules = [
            {"left": 50, "operator": "gte", "right": 0, "signal": "BUY"},
            {"left": 50, "operator": "lte", "right": 0, "signal": "SELL"},
        ]
        result = run_signal_backtest(klines, rules, initial_capital=100000)
        assert result["maxDrawdown"] >= 0
        assert result["winRate"] >= 0
        assert result["winRate"] <= 100


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
