import os
import json
import uuid
import asyncio
import math
import time
import resource
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, Response
from pydantic import BaseModel

from db import get_pool, close_pool
from backtest import run_signal_backtest
from strategy_backtest import run_strategy_backtest_all_periods


app = FastAPI(title="QuantCEO Backtest Engine", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

jobs: dict = {}


@app.on_event("shutdown")
async def shutdown():
    await close_pool()


class SignalBacktestRequest(BaseModel):
    klines: list
    rules: list
    startDate: Optional[str] = None
    endDate: Optional[str] = None
    initialCapital: float = 100000


class StrategyBacktestRequest(BaseModel):
    strategyKey: str = "all"
    startDate: Optional[str] = None
    endDate: Optional[str] = None
    topN: int = 5
    initialCapital: float = 1000000


@app.get("/health")
async def health():
    return {"status": "ok", "service": "backtest-engine"}


@app.get("/metrics")
async def metrics():
    usage = resource.getrusage(resource.RUSAGE_SELF)
    lines = [
        f"backtest_jobs_active {len([j for j in jobs.values() if j['status'] == 'running'])}",
        f"backtest_jobs_total {len(jobs)}",
        f"process_uptime_seconds {time.time() - _start_time:.1f}",
        f"process_cpu_user_seconds_total {usage.ru_utime:.2f}",
        f"process_cpu_system_seconds_total {usage.ru_stime:.2f}",
        f"process_max_rss_bytes {usage.ru_maxrss * 1024}",
    ]
    return Response(content="\n".join(lines) + "\n", media_type="text/plain; version=0.0.4")


_start_time = time.time()


@app.post("/api/backtest")
async def run_backtest(req: SignalBacktestRequest):
    try:
        result = run_signal_backtest(
            klines=req.klines,
            rules=req.rules,
            start_date=req.startDate,
            end_date=req.endDate,
            initial_capital=req.initialCapital,
        )
        return {"success": True, "data": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/backtest/strategy")
async def run_strategy_backtest_endpoint(req: StrategyBacktestRequest):
    job_id = str(uuid.uuid4())[:8]
    jobs[job_id] = {
        "status": "pending",
        "progress": 0,
        "step": "initializing",
        "strategy": req.strategyKey,
        "results": None,
        "error": None,
    }

    asyncio.create_task(_run_strategy_job(job_id, req))
    return {"success": True, "jobId": job_id}


async def _run_strategy_job(job_id: str, req: StrategyBacktestRequest):
    try:
        pool = await get_pool()

        async def progress_cb(key, step, pct):
            job = jobs.get(job_id)
            if job:
                job["progress"] = min(pct, 100)
                job["step"] = f"{key}: {step}"

        jobs[job_id]["status"] = "running"
        jobs[job_id]["progress"] = 5
        jobs[job_id]["step"] = "fetching_strategies"

        async with pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT config FROM strategies WHERE config->>'type' = 'scoring_strategy'
            """)

        strategies = []
        for r in rows:
            config = json.loads(r["config"]) if isinstance(r["config"], str) else r["config"]
            if req.strategyKey == "all" or config.get("key") == req.strategyKey:
                strategies.append(config)

        if not strategies:
            jobs[job_id]["status"] = "failed"
            jobs[job_id]["error"] = "No scoring strategies found"
            return

        async with pool.acquire() as conn:
            row = await conn.fetchrow("SELECT MIN(metric_date) AS d FROM daily_metrics")
        start_date = req.startDate or (str(row["d"]) if row and row["d"] else "2025-01-01")
        end_date = req.endDate or datetime.now().strftime("%Y-%m-%d")

        results = {}
        total_strats = len(strategies)

        for si, config in enumerate(strategies):
            key = config["key"]
            label = config.get("label", key)
            score_sql = config.get("scoreSQL", "")
            conditions = [c.get("sql", "") for c in config.get("conditions", [])]

            all_periods = await run_strategy_backtest_all_periods(
                strategy_key=key,
                strategy_label=label,
                score_sql=score_sql,
                conditions=conditions,
                start_date=start_date,
                end_date=end_date,
                initial_capital=req.initialCapital,
                top_n=req.topN,
                progress_callback=progress_cb,
            )
            results[key] = {"label": label, "periods": {}}
            for period, output in all_periods.items():
                results[key]["periods"][period] = output["stats"]
                results[key]["trades"] = output.get("trades", [])
                results[key]["equityCurve"] = output.get("equityCurve", [])

            base_pct = round((si + 1) / total_strats * 95)
            jobs[job_id]["progress"] = base_pct
            jobs[job_id]["step"] = f"{key}: done"

        jobs[job_id]["status"] = "completed"
        jobs[job_id]["progress"] = 100
        jobs[job_id]["step"] = "done"
        jobs[job_id]["results"] = results

    except Exception as e:
        job = jobs.get(job_id)
        if job:
            job["status"] = "failed"
            job["error"] = str(e)


@app.get("/api/backtest/progress/{job_id}")
async def get_progress(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@app.get("/api/backtest/progress/{job_id}/stream")
async def stream_progress(job_id: str):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")

    async def event_stream():
        while True:
            job = jobs.get(job_id)
            if not job:
                break

            data = json.dumps({
                "status": job["status"],
                "progress": job["progress"],
                "step": job["step"],
                "results": job.get("results"),
                "error": job.get("error"),
            })
            yield f"data: {data}\n\n"

            if job["status"] in ("completed", "failed"):
                break
            await asyncio.sleep(0.5)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.get("/api/backtest/strategy/results")
async def get_strategy_results(key: Optional[str] = Query(None)):
    pool = await get_pool()
    async with pool.acquire() as conn:
        if key:
            rows = await conn.fetch("""
                SELECT strategy_key, strategy_label, holding_periods, total_return,
                       annual_return, sharpe, max_drawdown, win_rate, trade_count,
                       avg_hold_days, return_1d, return_3d, return_5d, return_10d,
                       trades, equity_curve, top_n, created_at
                FROM strategy_backtest_runs
                WHERE strategy_key = $1
                ORDER BY created_at DESC
                LIMIT 10
            """, key)
        else:
            rows = await conn.fetch("""
                SELECT DISTINCT ON (strategy_key) strategy_key, strategy_label,
                       holding_periods, total_return, annual_return, sharpe,
                       max_drawdown, win_rate, trade_count, avg_hold_days,
                       return_1d, return_3d, return_5d, return_10d,
                       trades, equity_curve, top_n, created_at
                FROM strategy_backtest_runs
                ORDER BY strategy_key, created_at DESC
            """)

    results = []
    for r in rows:
        holding = r["holding_periods"]
        if isinstance(holding, list):
            holding = holding[0] if holding else 0
        results.append({
            "key": r["strategy_key"],
            "label": r["strategy_label"],
            "holdingDays": holding,
            "stats": {
                "totalReturn": float(r["total_return"]),
                "annualReturn": float(r["annual_return"]),
                "sharpe": float(r["sharpe"]),
                "maxDrawdown": float(r["max_drawdown"]),
                "winRate": float(r["win_rate"]),
                "tradeCount": r["trade_count"],
                "avgHoldDays": float(r["avg_hold_days"]),
                "return1d": float(r["return_1d"]),
                "return3d": float(r["return_3d"]),
                "return5d": float(r["return_5d"]),
                "return10d": float(r["return_10d"]),
            },
            "trades": json.loads(r["trades"]) if isinstance(r["trades"], str) else r["trades"],
            "equityCurve": json.loads(r["equity_curve"]) if isinstance(r["equity_curve"], str) else r["equity_curve"],
            "topN": r["top_n"],
            "updatedAt": str(r["created_at"]) if r["created_at"] else None,
        })
    return {"results": results}


@app.post("/api/internal/strategy-backtest")
async def internal_strategy_backtest():
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT config FROM strategies WHERE config->>'type' = 'scoring_strategy'
        """)

    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT MIN(metric_date) AS d FROM daily_metrics")
    start_date = str(row["d"]) if row and row["d"] else "2025-01-01"
    end_date = datetime.now().strftime("%Y-%m-%d")

    all_results = []
    for r in rows:
        config = json.loads(r["config"]) if isinstance(r["config"], str) else r["config"]
        key = config["key"]
        label = config.get("label", key)
        score_sql = config.get("scoreSQL", "")
        conditions = [c.get("sql", "") for c in config.get("conditions", [])]

        all_periods = await run_strategy_backtest_all_periods(
            strategy_key=key, strategy_label=label,
            score_sql=score_sql, conditions=conditions,
            start_date=start_date, end_date=end_date,
            initial_capital=1000000, top_n=5,
        )

        async with pool.acquire() as conn:
            for period_str, output in all_periods.items():
                period = int(period_str)
                s = output["stats"]
                await conn.execute("""
                    INSERT INTO strategy_backtest_runs (
                        strategy_key, strategy_label, start_date, end_date,
                        trade_direction, holding_periods, initial_capital, top_n, allocation,
                        commission_rate, stamp_tax_rate, slippage,
                        total_return, annual_return, sharpe, max_drawdown,
                        win_rate, trade_count, avg_hold_days,
                        return_1d, return_3d, return_5d, return_10d,
                        trades, equity_curve, triggered_by
                    ) VALUES (
                        $1, $2, $3, $4,
                        'long', $5::integer[], 1000000, 5, 'score_weighted',
                        0.00025, 0.001, 0.001,
                        $6, $7, $8, $9,
                        $10, $11, $12,
                        $13, $14, $15, $16,
                        $17::jsonb, $18::jsonb, 'scheduler-python'
                    )
                    ON CONFLICT (strategy_key, start_date, end_date, top_n)
                    DO UPDATE SET
                        total_return = EXCLUDED.total_return,
                        annual_return = EXCLUDED.annual_return,
                        sharpe = EXCLUDED.sharpe,
                        max_drawdown = EXCLUDED.max_drawdown,
                        win_rate = EXCLUDED.win_rate,
                        trade_count = EXCLUDED.trade_count,
                        avg_hold_days = EXCLUDED.avg_hold_days,
                        return_1d = EXCLUDED.return_1d,
                        return_3d = EXCLUDED.return_3d,
                        return_5d = EXCLUDED.return_5d,
                        return_10d = EXCLUDED.return_10d,
                        trades = EXCLUDED.trades,
                        equity_curve = EXCLUDED.equity_curve,
                        triggered_by = 'scheduler-python',
                        created_at = NOW()
                """,
                    key, label, start_date, end_date,
                    [period],
                    s["totalReturn"], s["annualReturn"], s["sharpe"], s["maxDrawdown"],
                    s["winRate"], s["tradeCount"], s["avgHoldDays"],
                    s["return1d"], s["return3d"], s["return5d"], s["return10d"],
                    json.dumps(output.get("trades", [])), json.dumps(output.get("equityCurve", [])),
                )

        all_results.append({"key": key, "label": label, "periods": len(all_periods)})

    return {"success": True, "results": all_results}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backtest_engine.main:app", host="0.0.0.0", port=4006, reload=True)
