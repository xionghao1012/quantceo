import sys, json, time

def fetch_sina_quotes(codes: list[str]) -> list[dict]:
    import urllib.request
    symbols = []
    for c in codes:
        c = c.strip()
        if c.startswith('6') or c.startswith('5'):
            symbols.append(f'sh{c}')
        elif c.startswith('0') or c.startswith('3') or c.startswith('1'):
            symbols.append(f'sz{c}')
        else:
            symbols.append(f'sz{c}')

    url = 'http://hq.sinajs.cn/list=' + ','.join(symbols)
    req = urllib.request.Request(url, headers={
        'Referer': 'http://finance.sina.com.cn',
        'User-Agent': 'Mozilla/5.0',
    })
    try:
        resp = urllib.request.urlopen(req, timeout=10)
        text = resp.read().decode('gbk')
    except Exception as e:
        raise Exception(f'Sina quote error: {e}')

    results = []
    for line in text.strip().split('\n'):
        line = line.strip()
        if '="' not in line:
            continue
        try:
            data = line.split('="')[1].rstrip('";')
            parts = data.split(',')
            if len(parts) < 32:
                continue
            name = parts[0]
            prev_close = float(parts[1]) if parts[1] else 0
            current = float(parts[3]) if parts[3] else 0
            high = float(parts[4]) if parts[4] else 0
            low = float(parts[5]) if parts[5] else 0
            volume = int(parts[8]) if parts[8] else 0  # 手
            amount = float(parts[9]) if parts[9] else 0  # 元
            date = parts[30]
            time_str = parts[31]

            day_change = ((current - prev_close) / prev_close * 100) if prev_close else 0

            # Extract code from line
            code = ''
            if 'hq_str_' in line:
                sym = line.split('hq_str_')[1].split('=')[0]
                code = sym[2:] if sym.startswith('sh') or sym.startswith('sz') else sym

            results.append({
                'code': code,
                'name': name,
                'price': round(current, 2),
                'prev_close': round(prev_close, 2),
                'high': round(high, 2),
                'low': round(low, 2),
                'volume': volume,
                'amount': amount,
                'day_change_pct': round(day_change, 2),
                'time': f'{date} {time_str}',
            })
        except (ValueError, IndexError):
            continue
    return results

if __name__ == '__main__':
    codes = sys.argv[1:] if len(sys.argv) > 1 else ['600519', '002594']
    result = fetch_sina_quotes(codes)
    print(json.dumps(result, ensure_ascii=False))
