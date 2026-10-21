FROM node:18-slim AS builder
WORKDIR /app
RUN npm config set registry https://registry.npmmirror.com
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts postcss.config.js ./
COPY src/ ./src/
RUN npm run build

FROM node:18-slim
RUN sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || \
    sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list 2>/dev/null
RUN apt-get update && apt-get install -y python3 python3-pip && \
    pip3 config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple && \
    pip3 install akshare --break-system-packages 2>/dev/null || \
    pip3 install akshare && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY src/server/data/*.py ./src/server/data/

EXPOSE 4001
ENV NODE_ENV=production
CMD ["node", "dist/server/index.js"]
