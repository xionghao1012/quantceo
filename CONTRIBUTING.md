# 贡献指南

欢迎贡献！本文档帮助你了解如何参与 QuantCEO 项目。

## 项目结构

```
quant-trading/     # 主项目 — 行情 / 回测 / 信号 / 前端
quant-ai/          # AI 微服务 — LLM / 预测 / 情绪 / 精选
quant-sso/         # SSO 认证 — 独立注册登录服务 (独立仓库)
```

## 开发环境

```bash
# 1. 克隆项目
git clone git@github.com:yourname/quant-trading.git
cd quant-trading

# 2. 设置 SSO (可选 — OSS 模式不需要)
git clone git@github.com:yourname/quant-sso.git ../quant-sso
npm install --prefix ../quant-sso && npm run build --prefix ../quant-sso

# 3. 安装依赖
npm install

# 4. 数据库
createdb quant_ceo
npm run db:init
npm run db:seed

# 5. 启动
npm run dev
```

## OSS / Pro 模式

QuantCEO 使用 **单仓库双轨分发** 策略：

- **OSS 模式**：无需 `LICENSE_KEY`，免费使用基础功能
- **Pro 模式**：设置 `LICENSE_KEY` 环境变量，解锁 AI 策略 / 推送等

Pro 功能通过插件系统动态加载（`src/server/plugins/pro.ts`），确保 OSS 仓库不包含商业代码。

## 提交规范

- 使用清晰的中英文 commit message
- 一个 commit 只做一件事
- 不要在 commit 中包含 API 密钥或密码
- `npm run build` 通过后再提交

## 代码风格

- TypeScript strict 模式
- Vue 3 Composition API + `<script setup>`
- 不添加无意义的注释
- 遵循已有文件风格

## 安全

- 不要在代码中硬编码密钥
- 使用环境变量（`.env` 文件已在 `.gitignore`）
- 发现安全漏洞请私下联系维护者

## 测试

```bash
npm test
```

## 问题反馈

- 使用 GitHub Issues 提交 bug 报告
- 新功能请先开 Issue 讨论

## 许可证

MIT — 详见 [LICENSE](LICENSE)
