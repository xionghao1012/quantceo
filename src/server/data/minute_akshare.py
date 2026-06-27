import sys
import json
import math
import akshare as ak

PERIOD_MAP = {'m1': '1', 'm5': '5', 'm15': '15', 'm30': '30', 'm60': '60'}

def to_ak_symbol(code: str) -> str:
    if code.startswith('6') or code.startswith('9'):
        return f"sh{code}"
    if code.startswith('0') or code.startswith('3'):
        return f"sz{code}"
    if code.startswith('sh'):
        return f"sh{code[2:]}"
    if code.startswith('sz'):
        return f"sz{code[2:]}"
    return code

def fetch_one(symbol: str, code: str, period: str) -> list:
    freq = PERIOD_MAP.get(period, '5')
    df = ak.stock_zh_a_minute(symbol=symbol, period=freq, adjust='qfq')
    rows = []
    for _, row in df.iterrows():
        open_v = float(row['open'])
        high_v = float(row['high'])
        low_v = float(row['low'])
        close_v = float(row['close'])
        amount_v = float(row['amount'])
        vol_v = float(row['volume'])
        if math.isnan(open_v) or math.isnan(high_v) or math.isnan(low_v) or math.isnan(close_v) or math.isnan(amount_v) or math.isnan(vol_v):
            continue
        vol_v = int(vol_v)
        dt = str(row['day']).replace(' ', 'T')
        rows.append({
            'code': code,
            'datetime': dt,
            'open': open_v,
            'high': high_v,
            'low': low_v,
            'close': close_v,
            'volume': vol_v,
            'amount': amount_v,
        })
    return rows

def main():
    req = json.loads(sys.stdin.read())
    codes = req['codes']
    period = req['period']
    result = {}
    for c in codes:
        try:
            symbol = to_ak_symbol(c)
            rows = fetch_one(symbol, c, period)
            if rows:
                result[c] = rows
        except Exception as e:
            print(str(e), file=sys.stderr)
    print(json.dumps({'ok': True, 'data': result}))

if __name__ == '__main__':
    main()
