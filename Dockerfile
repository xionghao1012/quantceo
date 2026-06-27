FROM node:18-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts postcss.config.js ./
COPY src/ ./src/
RUN npm run build

FROM node:18-slim
RUN apt-get update && apt-get install -y python3 python3-pip && \
    pip3 install akshare --break-system-packages 2>/dev/null || \
    pip3 install akshare && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY src/server/data/*.py ./src/server/data/

EXPOSE 3001
ENV NODE_ENV=production
CMD ["node", "dist/server/index.js"]
