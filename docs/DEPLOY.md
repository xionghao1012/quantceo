# QuantCEO 生产部署指南

## 一、环境要求

| 软件 | 版本 | 说明 |
|------|------|------|
| Node.js | 18+ | 推荐 20 LTS |
| PostgreSQL | 15+ | 数据存储 |
| Redis | 7+ | 可选，缓存加速 |
| Docker | 24+ | 可选，一键部署 |
| Nginx | 最新 | 可选，反向代理 |

## 二、部署方式

### 方式 A：Docker Compose 部署（推荐）

#### 前置条件

将 quant-sso 仓库放在 quant-trading 同级目录：

```
parent/
├── quant-trading/    # 本仓库
└── quant-sso/        # https://github.com/yourname/quant-sso
```

#### 创建 .env 文件

```bash
cat > .env <<EOF
JWT_SECRET=$(openssl rand -hex 32)
LICENSE_KEY=                  # 留空则 OSS 模式
MINIMAX_API_KEY=              # Pro 模式需要
QUANT_SSO_PATH=../quant-sso
EOF
```

#### 启动完整服务栈

```bash
docker compose up -d
# 或含 Redis
docker compose --profile with-redis up -d
```

服务清单：

| 服务 | 端口 | 说明 |
|------|------|------|
| postgres | 5432 | PostgreSQL 15 |
| redis | 6379 | 可选缓存 |
| quant-sso | 3002 | 独立认证服务 |
| quant-ai | 4002 | AI 预测服务 |
| quant-trading | 4001 | 主应用 |

启动顺序（自动编排）：
1. `postgres` 初始化
2. `db-init` 创建数据库 + 建表 + 导入股票 + 策略种子
3. `quant-sso-migrate` 运行 SSO 迁移
4. `quant-sso` 和 `quant-ai` 启动
5. `quant-trading` 最后启动

#### 常用命令

```bash
# 查看日志
docker compose logs -f quant-trading

# 重启单个服务
docker compose restart quant-trading

# 进入容器
docker compose exec quant-trading sh

# 查看数据库
docker compose exec postgres psql -U postgres -d quant_ceo

# 停止
docker compose down
docker compose down -v          # 同时删除数据卷
```

### 方式 B：手动部署

#### 1. 构建

```bash
npm run build
# 输出: dist/server/ + dist/client/
```

#### 2. 配置环境变量

```bash
cat > .env <<EOF
PORT=4001
PG_HOST=localhost
PG_PORT=5432
PG_DB=quant_ceo
PG_USER=postgres
PG_PASSWORD=your_password
JWT_SECRET=$(openssl rand -hex 32)
LICENSE_KEY=                   # 留空则 OSS 模式
MINIMAX_API_KEY=               # Pro 需要
EOF
```

#### 3. 初始化数据库

```bash
npm run db:init                # 建表
npm run db:seed-all-stocks     # 导入 5307 只股票（约 30 秒）
npm run db:seed-strategies     # 导入策略定义
```

#### 4. 启动

```bash
# OSS 模式
node dist/server/index.js

# Pro 模式（需要 quant-sso）
LICENSE_KEY=xxx node dist/server/index.js
```

### 方式 C：微服务独立部署

可独立运行的微服务（需在 monorepo 同级目录下）：

```bash
cd market-data       && npm install && npm run dev   # :4003
cd scan-engine       && npm install && npm run dev   # :4004
cd indicator-service && npm install && npm run dev   # :4005
cd backtest-engine   && pip install -r requirements.txt && uvicorn main:app  # :4006
cd scheduler         && npm install && npm run dev   # （无固定 HTTP 端口）
```

## 三、Nginx 反向代理配置

```nginx
```nginx
upstream quant-trading {
    server 127.0.0.1:4001;
}

upstream quant-sso {
    server 127.0.0.1:3002;
}

upstream quant-ai {
    server 127.0.0.1:4002;
}

server {
    listen 80;
    server_name your-domain.com;

    client_max_body_size 10M;

    location /api/health {
        proxy_pass http://quant-trading;
    }

    location /api/auth/ {
        proxy_pass http://quant-sso/;
    }

    location /api/ai/ {
        proxy_pass http://quant-ai;
    }

    location / {
        proxy_pass http://quant-trading;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /ws/ {
        proxy_pass http://quant-trading;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```
```

## 四、安全加固

### 4.1 JWT 密钥

```bash
# 生成 256 位随机密钥
JWT_SECRET=$(openssl rand -hex 32)
```

### 4.2 PostgreSQL

- 使用强密码
- 限制访问 IP：`pg_hba.conf` 中仅允许应用服务器 IP
- 启用 SSL

### 4.3 环境变量安全

- `.env` 文件不要提交到版本控制（已在 `.gitignore`）
- 生产环境使用密钥管理服务或容器 secret

## 五、监控与维护

### 5.1 健康检查

```bash
curl http://localhost:4001/api/health
# → {"status":"ok"}
```

### 5.2 日志

```bash
# Docker
docker compose logs -f --tail=100 quant-trading

# PM2
pm2 logs quant-trading
```

### 5.3 数据库备份

```bash
# 备份
pg_dump -U postgres quant_ceo > backup_$(date +%Y%m%d).sql

# 恢复
psql -U postgres -d quant_ceo < backup_20240101.sql
```

### 5.4 使用 PM2（推荐生产）

```bash
npm install -g pm2

# 启动
JWT_SECRET=xxx PORT=4001 pm2 start dist/server/index.js --name quant-trading

# 或使用 ecosystem 文件
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'quant-trading',
    script: 'dist/server/index.js',
    env: { PORT: 4001, JWT_SECRET: 'xxx' },
  }]
}
EOF
pm2 start ecosystem.config.js

# 保存配置
pm2 save
pm2 startup
```

## 六、性能调优

| 配置项 | 建议值 | 说明 |
|--------|--------|------|
| NODE_ENV | production | 生产模式 |
| UV_THREADPOOL_SIZE | 4-8 | libuv 线程池大小 |
| PostgreSQL max_connections | 按需 | 默认 100 通常足够 |
| Redis | 启用 | 加速 K 线数据缓存 |

## 七、常见问题

### PostgreSQL 连接失败

```bash
pg_isready -h localhost
# 检查 pg_hba.conf 允许连接
```

### 端口被占用

```bash
lsof -i :4001
# 或修改 PORT 环境变量
```

### Docker 启动慢

首次拉取镜像 + 初始化数据约 2-3 分钟，后续启动约 10 秒。

```bash
docker compose logs -f db-init
```

### OSS 模式不需要 SSO

OSS 模式使用本地用户表，quant-sso 是可选的。Docker Compose 默认会尝试启动 quant-sso，如果本地没有源代码可以参考 `docker-compose.yml` 调整配置。
