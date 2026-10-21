#!/usr/bin/env bash
# 开发环境 API 守护脚本。
#
# 为什么需要它：tsx watch 只在「文件变化」时重启进程，进程自己崩掉（比如
# 一次 OOM 或一个没被接住的异常）之后就停在那儿不动了，/api/health 直接
# 不响应，只能手动重敲一遍。生产那边靠 docker 的 restart=always 兜底，
# 开发环境没有这层，所以这里套一个最简单的拉起循环。
#
# 用法: npm run dev:server
set -u
cd "$(dirname "$0")/.."

export PG_DB="${PG_DB:-quant_ceo_dev}"
export PORT="${PORT:-3003}"
export PG_HOST="${PG_HOST:-localhost}"
export VITE_API_PORT="${VITE_API_PORT:-3003}"
# 注意：不能无条件 export LICENSE_KEY=""——dotenv 不会覆盖已存在的环境变量，
# 导一个空串等于把 .env 里的 LICENSE_KEY=pro_dev 顶掉，Pro 插件会被关掉
# （表现是每页 404 /api/push/unread-count）。只有外部真的传了才导出。
if [ -n "${LICENSE_KEY:-}" ]; then
  export LICENSE_KEY
fi

# 系统 node 可能是 v18（undici/File 兼容问题，见 AGENTS.md），优先用 nvm 下的 v24+
for d in "$HOME"/.nvm/versions/node/v2[4-9]*; do
  if [ -x "$d/bin/node" ]; then
    export PATH="$d/bin:$PATH"
    echo "[dev-server] node: $(node -v)"
    break
  fi
done

running=1
trap 'running=0; exit 0' INT TERM

while [ "$running" = "1" ]; do
  npx tsx watch src/server/index.ts
  code=$?
  [ "$running" = "1" ] || break
  echo "[dev-server] 进程退出（code=$code），3 秒后拉起"
  sleep 3
done
