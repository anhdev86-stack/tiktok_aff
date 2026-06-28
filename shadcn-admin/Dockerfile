# syntax=docker/dockerfile:1.6
# ----- 1. Build stage -----
FROM node:22-alpine AS builder

WORKDIR /app

# Bật corepack để có pnpm version-pin theo packageManager (hoặc lockfile)
RUN corepack enable

# Reproducible install: chỉ copy manifest + lockfile, install --frozen-lockfile
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# VITE_API_URL được nướng vào bundle ở thời điểm build.
# Khi deploy Coolify: set build-arg VITE_API_URL=https://your-api.example.com/api/v1
ARG VITE_API_URL=/api/v1
ENV VITE_API_URL=${VITE_API_URL}

COPY . .
RUN pnpm build

# ----- 2. Runtime stage -----
FROM nginx:1.27-alpine AS runtime

# Tạo user non-root cho nginx (image nginx:alpine có sẵn user nginx uid=101)
RUN apk add --no-cache tini

# Xoá default config
RUN rm /etc/nginx/conf.d/default.conf

# Chọn config nginx — default = nginx.conf (prod, không proxy /api/).
# Local: pass --build-arg NGINX_CONF=nginx.local.conf để dùng bản có reverse proxy.
ARG NGINX_CONF=nginx.conf
COPY ${NGINX_CONF} /etc/nginx/conf.d/app.conf

# Copy build artefact và set quyền cho user nginx
COPY --from=builder --chown=nginx:nginx /app/dist /usr/share/nginx/html

# Sửa main nginx.conf để chạy được dưới user non-root (PID file + log)
RUN sed -i -E 's|^pid[[:space:]]+.*;|pid /tmp/nginx.pid;|' /etc/nginx/nginx.conf && \
    sed -i -E 's|^user[[:space:]]+.*;|# user nginx;|' /etc/nginx/nginx.conf && \
    chown -R nginx:nginx /var/cache/nginx /var/log/nginx /etc/nginx /usr/share/nginx/html && \
    chmod -R g+w /var/cache/nginx /var/log/nginx

USER nginx

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["nginx", "-g", "daemon off;"]
