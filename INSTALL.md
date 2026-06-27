# QuantCEO 安装手册

从零开始，5 分钟部署你的 A 股量化交易系统。

## 环境要求

| 软件 | 版本 | 说明 |
|------|------|------|
| Node.js | 18+ | 推荐 20 LTS |
| PostgreSQL | 15+ | 数据存储 |
| Redis | 7+ | 可选，缓存加速 |
| Python 3 | 3.10+ | 可选，情绪分析需要 |
| Docker | 24+ | 可选，一键部署 |

## 方式一：Docker 一键部署（推荐）

```bash
# 1. 克隆
git clone https://github.com/xionghao1012/quantceo.git
cd quantceo

# 2. 创建环境变量
cp .env.example .env
# 编辑 .env，设置 JWT_SECRET

# 3. 启动
docker compose up -d

# 4. 访问
open http://localhost:4001
```

**启动后自动执行**：
- 创建数据库 + 建表
- 拉取 5307 只 A 股股票列表
- 导入 6 个策略定义

约 2-3 分钟完成首次启动。

## 方式二：手动安装

### 1. 安装依赖

```bash
# macOS
brew install postgresql@15 redis node@20
brew services start postgresql@15

# Ubuntu/Debian
sudo apt install postgresql redis nodejs npm
sudo systemctl start postgresql

# 克隆项目
git clone https://github.com/xionghao1012/quantceo.git
cd quantceo
npm install
```

### 2. 创建数据库

```bash
# 创建数据库
createdb quant_ceo

# 或通过 psql
psql -U postgres -c "CREATE DATABASE quant_ceo"
```

### 3. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env
```

```ini
PORT=4001
PG_HOST=localhost
PG_PORT=5432
PG_DB=quant_ceo
PG_USER=postgres
PG_PASSWORD=your_password
JWT_SECRET=openssl rand -hex 32  # 替换为随机字符串
```

### 4. 初始化数据库

```bash
# 建表
npm run db:init

# 导入股票列表（5307 只 A 股，约 30 秒）
npm run db:seed-all-stocks

# 导入策略定义
npm run db:seed-strategies
```

### 5. 构建 & 启动

```bash
# 构建
npm run build

# 启动服务
node dist/server/index.js

# 访问
open http://localhost:4001
```

## 方式三：开发模式

```bash
npm install
npm run db:init && npm run db:seed-all-stocks && npm run db:seed-strategies
npm run dev
# 前端: http://localhost:5173
# API:  http://localhost:4001
```

## 验证安装

```bash
# 健康检查
curl http://localhost:4001/api/health
# → {"status":"ok"}

# 股票列表
curl http://localhost:4001/api/stocks
# → [{"code":"600519","name":"贵州茅台"...]

# 浏览器访问
open http://localhost:4001
```

## 微服务启动（可选）

OSS 版包含 5 个独立微服务，各自也可单独运行：

```bash
cd market-data       && npm install && npm run dev   # :4003 行情数据
cd scan-engine       && npm install && npm run dev   # :4004 信号扫描
cd indicator-service && npm install && npm run dev   # :4005 技术指标
```

## 常见问题

### PostgreSQL 连接失败

```bash
# 检查 PostgreSQL 运行状态
pg_isready -h localhost

# 检查 pg_hba.conf 允许本地连接
# macOS: /opt/homebrew/var/postgresql@15/pg_hba.conf
# Ubuntu: /etc/postgresql/16/main/pg_hba.conf
# 确保有: local all all trust
```

### 端口被占用

```bash
# 查看端口占用
lsof -i :4001
kill <PID>

# 或修改 .env 中的 PORT
PORT=4007
```

### 股票数据为空

```bash
# 重新拉取全量股票
npm run db:seed-all-stocks
```

### Docker 启动慢

首次启动需要拉取镜像 + 初始化数据，约 2-3 分钟。后续启动约 10 秒。

```bash
# 查看启动日志
docker compose logs -f db-init
```

### 升级 Pro 版

详见 [升级指南](https://github.com/xionghao1012/mattpocock) 获取付费版本。

## 下一步

- [用户手册](docs/USER_GUIDE.md) — 页面导航和使用指南
- [API 文档](docs/API.md) — 接口说明
- [架构文档](docs/ARCHITECTURE.md) — 服务全景
- [部署文档](docs/DEPLOY.md) — 生产部署
