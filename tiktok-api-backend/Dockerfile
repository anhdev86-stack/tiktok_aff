# syntax=docker/dockerfile:1.7
# Build context: thư mục cha (tiktok-api/) — giữ nguyên cho compose hiện tại
# (build-and-push.sh + docker-compose.yml đều set context = parent).
# webmssdk.js TikTok tự inject từ CDN khi page goto affiliate, không cần copy local.
ARG NODE_VERSION=22

# ---------- builder ----------
# Stage này chỉ dùng để compile TypeScript → dist/. Không vào image cuối.
FROM node:${NODE_VERSION}-bookworm-slim AS builder
WORKDIR /app

ENV PUPPETEER_SKIP_DOWNLOAD=1

COPY tiktok-api-backend/package.json tiktok-api-backend/package-lock.json ./
RUN --mount=type=cache,id=npm-builder,target=/root/.npm \
    npm ci --no-audit --no-fund

COPY tiktok-api-backend/tsconfig*.json tiktok-api-backend/nest-cli.json ./
COPY tiktok-api-backend/src ./src
RUN npm run build

# ---------- prod-deps ----------
# Stage riêng cài node_modules production-only → copy sang runtime.
# Tách stage giúp cache layer prod-deps độc lập với devDeps khi src đổi.
FROM node:${NODE_VERSION}-bookworm-slim AS prod-deps
WORKDIR /app

ENV PUPPETEER_SKIP_DOWNLOAD=1

COPY tiktok-api-backend/package.json tiktok-api-backend/package-lock.json ./
RUN --mount=type=cache,id=npm-prod,target=/root/.npm \
    npm ci --omit=dev --no-audit --no-fund && \
    npm cache clean --force

# ---------- runtime ----------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=1 \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Chromium + libs runtime tối thiểu cho Puppeteer headless. tini = init PID 1.
# fonts-liberation + noto-color-emoji để render text/emoji không bị tofu.
# Không cài wget vì không có healthcheck.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      chromium \
      ca-certificates \
      fonts-liberation \
      fonts-noto-color-emoji \
      libasound2 \
      libatk-bridge2.0-0 \
      libatk1.0-0 \
      libcups2 \
      libdbus-1-3 \
      libdrm2 \
      libgbm1 \
      libnspr4 \
      libnss3 \
      libxcomposite1 \
      libxdamage1 \
      libxfixes3 \
      libxkbcommon0 \
      libxrandr2 \
      tini && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

# Copy node_modules production từ stage riêng (không có devDeps + tools build).
COPY --from=prod-deps /app/node_modules ./node_modules
COPY tiktok-api-backend/package.json ./
COPY --from=builder /app/dist ./dist

# Không còn /app/secrets — Service Account upload qua UI, lưu encrypted ở DB.
# Không còn /app/sdk — webmssdk.js load native từ CDN khi browser goto affiliate.
RUN chown -R node:node /app

USER node
EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
