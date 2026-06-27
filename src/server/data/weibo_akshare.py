import sys, json
try:
    import akshare
except ImportError:
    print(json.dumps({"error": "akshare not installed"}))
    sys.exit(1)

if __name__ == "__main__":
    try:
        period = sys.argv[1] if len(sys.argv) > 1 else "CNHOUR12"
        df = akshare.stock_js_weibo_report(time_period=period)
        if df is None or df.empty:
            print(json.dumps([]))
        else:
            data = []
            for _, r in df.iterrows():
                data.append({
                    "name": str(r["name"]),
                    "rate": float(r["rate"]) if r["rate"] else 0.0,
                })
            print(json.dumps(data, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
