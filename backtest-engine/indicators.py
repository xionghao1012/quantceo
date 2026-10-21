import numpy as np
from typing import List


def calc_ma(closes: np.ndarray, period: int) -> np.ndarray:
    if len(closes) < period:
        return np.full_like(closes, np.nan, dtype=np.float64)
    out = np.full_like(closes, np.nan, dtype=np.float64)
    cumsum = np.cumsum(np.insert(closes, 0, 0))
    out[period - 1:] = (cumsum[period:] - cumsum[:-period]) / period
    return out


def calc_ema(closes: np.ndarray, period: int) -> np.ndarray:
    out = np.full_like(closes, np.nan, dtype=np.float64)
    if len(closes) < period:
        return out
    out[period - 1] = np.mean(closes[:period])
    alpha = 2.0 / (period + 1)
    for i in range(period, len(closes)):
        out[i] = closes[i] * alpha + out[i - 1] * (1 - alpha)
    return out


def calc_rsi(closes: np.ndarray, period: int = 14) -> np.ndarray:
    out = np.full_like(closes, np.nan, dtype=np.float64)
    if len(closes) < period + 1:
        return out
    diffs = np.diff(closes)
    gains = np.where(diffs > 0, diffs, 0.0)
    losses = np.where(diffs < 0, -diffs, 0.0)

    avg_gain = np.mean(gains[:period])
    avg_loss = np.mean(losses[:period])

    if avg_loss == 0:
        out[period] = 100.0
    else:
        rs = avg_gain / avg_loss
        out[period] = 100.0 - (100.0 / (1.0 + rs))

    for i in range(period + 1, len(closes)):
        avg_gain = (avg_gain * (period - 1) + gains[i - 1]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i - 1]) / period
        if avg_loss == 0:
            out[i] = 100.0
        else:
            rs = avg_gain / avg_loss
            out[i] = 100.0 - (100.0 / (1.0 + rs))
    return out


def calc_macd(closes: np.ndarray, fast: int = 12, slow: int = 26, signal: int = 9) -> dict:
    ema_fast = calc_ema(closes, fast)
    ema_slow = calc_ema(closes, slow)
    macd_line = ema_fast - ema_slow
    signal_line = calc_ema(macd_line, signal)
    histogram = macd_line - signal_line
    return {"macd": macd_line, "signal": signal_line, "histogram": histogram}


def calc_bollinger(closes: np.ndarray, period: int = 20, num_std: float = 2.0) -> dict:
    middle = calc_ma(closes, period)
    out = {"upper": np.full_like(closes, np.nan, dtype=np.float64),
           "middle": middle,
           "lower": np.full_like(closes, np.nan, dtype=np.float64)}
    for i in range(period - 1, len(closes)):
        window = closes[i - period + 1:i + 1]
        std = np.std(window, ddof=1)
        out["upper"][i] = middle[i] + num_std * std
        out["lower"][i] = middle[i] - num_std * std
    return out


def calc_atr(highs: np.ndarray, lows: np.ndarray, closes: np.ndarray, period: int = 14) -> np.ndarray:
    n = len(closes)
    out = np.full(n, np.nan, dtype=np.float64)
    if n < 2:
        return out
    tr = np.maximum(highs[1:] - lows[1:],
                    np.maximum(np.abs(highs[1:] - closes[:-1]),
                               np.abs(lows[1:] - closes[:-1])))
    if len(tr) < period:
        return out
    out[period] = np.mean(tr[:period])
    for i in range(period + 1, n):
        out[i] = (out[i - 1] * (period - 1) + tr[i - 1]) / period
    return out
