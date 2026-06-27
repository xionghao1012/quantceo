import sys, json, traceback
try:
    import akshare
except ImportError:
    print(json.dumps({"error": "akshare not installed"}))
    sys.exit(1)

def fetch_news_em(code: str):
    try:
        df = akshare.stock_news_em(symbol=code)
        if df is None or df.empty:
            return []
        rows = []
        for _, r in df.head(10).iterrows():
            rows.append({
                "type": "news",
                "source": str(r.get("文章来源", "东方财富")),
                "title": str(r.get("新闻标题", "")),
                "summary": str(r.get("新闻内容", ""))[:300],
                "time": str(r.get("发布时间", "")),
                "url": str(r.get("新闻链接", "")),
            })
        return rows
    except:
        return []

def fetch_research_em(code: str):
    try:
        df = akshare.stock_research_report_em(symbol=code)
        if df is None or df.empty:
            return []
        rows = []
        for _, r in df.head(5).iterrows():
            title = str(r.get("报告名称", ""))
            inst = str(r.get("机构", ""))
            rating = str(r.get("东财评级", ""))
            date = str(r.get("日期", ""))[:10]
            rows.append({
                "type": "research",
                "source": f"{inst}",
                "title": title,
                "summary": f"评级:{rating} 机构:{inst}",
                "time": date,
                "url": str(r.get("报告PDF链接", "")),
            })
        return rows
    except:
        return []

def fetch_disclosure(code: str):
    try:
        df = akshare.stock_zh_a_disclosure_report_cninfo(symbol=code)
        if df is None or df.empty:
            return []
        rows = []
        for _, r in df.head(5).iterrows():
            rows.append({
                "type": "disclosure",
                "source": "巨潮资讯",
                "title": str(r.get("公告标题", "")),
                "summary": str(r.get("公告标题", "")),
                "time": str(r.get("公告时间", ""))[:10],
                "url": str(r.get("公告链接", "")),
            })
        return rows
    except:
        return []

if __name__ == "__main__":
    try:
        code = sys.argv[1] if len(sys.argv) > 1 else "600519"
        news = fetch_news_em(code)
        research = fetch_research_em(code)
        disclosure = fetch_disclosure(code)
        result = news + research + disclosure
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
