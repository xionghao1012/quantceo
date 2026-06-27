import baostock as bs
import sys
import json

FREQ_MAP = {'m5': '5', 'm15': '15', 'm30': '30', 'm60': '60'}

def to_bs_code(code: str) -> str:
    if code.startswith('sh') or code.startswith('SH'):
        return f"sh.{code[2:]}"
    if code.startswith('sz') or code.startswith('SZ'):
        return f"sz.{code[2:]}"
    if code.startswith('6') or code.startswith('9'):
        return f"sh.{code}"
    if code.startswith('0') or code.startswith('3'):
        return f"sz.{code}"
    return f"sh.{code}"

def fetch_one(bs_code: str, code: str, freq: str, start_date: str, end_date: str) -> list:
    rs = bs.query_history_k_data_plus(
        bs_code,
        "date,time,open,high,low,close,volume,amount",
        start_date=start_date,
        end_date=end_date,
        frequency=freq,
        adjustflag='3'
    )
    rows = []
    while rs.next():
        row = rs.get_row_data()
        if not row[1] or row[1] == '':
            continue
        ts = str(row[1])
        dt = f"{ts[:4]}-{ts[4:6]}-{ts[6:8]}T{ts[8:10]}:{ts[10:12]}:00"
        rows.append({
            'code': code,
            'datetime': dt,
            'open': float(row[2]),
            'high': float(row[3]),
            'low': float(row[4]),
            'close': float(row[5]),
            'volume': int(float(row[6])),
            'amount': float(row[7]),
        })
    return rows

def main():
    req = json.loads(sys.stdin.read())
    action = req.get('action', 'fetch')

    old_stdout = sys.stdout
    sys.stdout = sys.stderr
    bs.login()
    sys.stdout = old_stdout

    try:
        if action == 'fetch':
            period = req['period']
            freq = FREQ_MAP.get(period, '5')
            start_date = req.get('start_date', '20000101')
            end_date = req.get('end_date')
            if end_date is None:
                from datetime import date
                end_date = date.today().strftime('%Y-%m-%d')

            codes = req['codes']
            result = {}
            for c in codes:
                bs_code = to_bs_code(c)
                rows = fetch_one(bs_code, c, freq, start_date, end_date)
                if rows:
                    result[c] = rows
            print(json.dumps({'ok': True, 'data': result}))
        else:
            print(json.dumps({'ok': False, 'error': f'Unknown action: {action}'}))
    except Exception as e:
        print(json.dumps({'ok': False, 'error': str(e)}))
    finally:
        sys.stdout = sys.stderr
        bs.logout()
        sys.stdout = old_stdout

if __name__ == '__main__':
    main()
