# tiktok-api-backend

NestJS (Fastify) + MongoDB backend wrapping the `api-test/src/aff-full-profile.js`
flow as a REST API. Mỗi tài khoản TikTok liên kết với 1 Google Spreadsheet và
backend tự động ghi data vào 3 worksheet con: **Tổng quan**, **Video nổi bật**,
**Xu hướng** (upsert theo key column, không overwrite toàn sheet).

## 1. Mô hình bảo mật (đọc trước khi deploy)

Image này được thiết kế để **public** — không có endpoint, cookie, hay Service
Account nào nằm trong image. Người chạy phải tự cấu hình:

| Lớp | Cơ chế |
|-----|--------|
| Mạng | Mongo + API bind `127.0.0.1` only. Public phải qua reverse proxy có TLS. |
| DB | Mongo bật `--auth`, root user/pass set qua env. URI có credential. |
| Mật khẩu admin | Khuyến cáo `ADMIN_PASSWORD_HASH` (argon2) thay vì plaintext. |
| JWT | `JWT_SECRET` bắt buộc >=32 ký tự, chặn các default phổ biến. |
| Brute-force login | `LoginThrottleGuard` 5 req/phút/IP + `@fastify/rate-limit` global. |
| Service Account | KHÔNG còn dùng file. Admin upload JSON → backend mã hoá AES-256-GCM bằng `ENCRYPTION_KEY` rồi lưu DB. |
| CORS | Whitelist domain qua `CORS_ORIGINS`. Mặc định chặn tất cả nếu để trống. |
| Helmet | HSTS, frameguard deny, no-referrer, xss filter, no-sniff. |
| Audit log | Tất cả thao tác login / SA / TikTok account ghi vào `audit_logs`. |
| Validation | `whitelist + forbidNonWhitelisted + forbidUnknownValues` trên toàn bộ DTO. |
| Error filter | Non-HttpException trả generic `Internal server error`, không leak stack. |

> **Đặc biệt quan trọng**: `ENCRYPTION_KEY` (32 bytes hex) là root-of-trust cho
> mọi private key SA đã upload. Mất key = mất toàn bộ SA, phải upload lại.

## 2. Sinh secret

```bash
# ENCRYPTION_KEY (64 ký tự hex):
openssl rand -hex 32

# JWT_SECRET (>=32 ký tự, base64):
openssl rand -base64 48

# ADMIN_PASSWORD_HASH (argon2):
node -e "require('argon2').hash(process.argv[1]).then(console.log)" 'your-strong-password'
```

## 3. Cài đặt local (không Docker)

```bash
cd tiktok-api-backend
cp .env.example .env       # điền secret vào
npm install
npm run start:dev
```

Yêu cầu Mongo chạy ở `mongodb://localhost:27017` (hoặc đổi `MONGO_URI`).

Kiểm tra chất lượng:

```bash
npm run typecheck   # tsc --noEmit (strict)
npm run lint
npm run lint:fix
```

## 4. Chạy bằng Docker (khuyên dùng)

```bash
cd tiktok-api-backend
cp .env.example .env       # điền MONGO_ROOT_PASSWORD, JWT_SECRET, ENCRYPTION_KEY...
docker compose up -d --build
```

Mặc định API mở ở `http://127.0.0.1:3000/api/v1` (chỉ host truy cập được).
Public ra Internet thì đặt sau nginx/caddy/traefik với TLS termination.

### 4.1 Deploy trên Coolify

1. **Resource → Docker Compose** → trỏ vào `tiktok-api-backend/docker-compose.yml`.
2. **Environment Variables** — điền các biến bắt buộc, Coolify sẽ inject lúc up:
   - `MONGO_ROOT_PASSWORD` (mật khẩu Mongo root, mạnh)
   - `JWT_SECRET` (>=32 ký tự, sinh bằng `openssl rand -base64 48`)
   - `ENCRYPTION_KEY` (64 ký tự hex, sinh bằng `openssl rand -hex 32`)
   - `ADMIN_USERNAME` + `ADMIN_PASSWORD_HASH` (argon2 hash, **không** dùng plaintext)
   - `CORS_ORIGINS` = domain frontend (vd: `https://admin.example.com`)
3. **Domain** — gắn domain riêng cho service `api`, Coolify tự cấp Let's Encrypt.
   Reverse proxy của Coolify sẽ termination TLS rồi forward tới `127.0.0.1:3000`.
4. **Persistent volume** — Coolify auto giữ volume `mongo_data` khi rebuild.
5. **Backup** — backup `ENCRYPTION_KEY` ra **bên ngoài** Coolify (KMS / vault).
   Không backup chung cùng DB; nếu mất key, toàn bộ SA đã upload **không** decrypt
   lại được.
6. Sau khi up:
   - Login với admin → vào trang **Service Accounts** → paste JSON SA, save.
   - Add 1 TikTok account, share Google Sheet (Editor) cho các email SA hiển thị
     trong UI → confirm → tạo account → bấm test-sheet-access để probe quyền.
   - Tracker creator + trigger profile job như bình thường.

## 5. Auth

```http
POST /api/v1/auth/login
Content-Type: application/json

{ "username": "admin", "password": "<plaintext>" }
```

→ Trả `accessToken`. Mọi endpoint khác cần `Authorization: Bearer <accessToken>`.
Login bị giới hạn 5 lần/phút/IP — sai quá quota trả 429.

## 6. Service Account: upload + rotation (workflow mới)

### 6.1 Upload SA

UI có 1 textarea — user paste nguyên file JSON SA Google tải về (shape mặc
định của Google Cloud, có `type`, `project_id`, `private_key`,
`client_email`, …). Frontend gọi `JSON.parse` rồi POST nguyên object qua
field `sa`, hoặc gửi raw string — backend nhận cả 2 dạng.

Body **dạng object** (khuyến cáo):

```http
POST /api/v1/service-accounts
Authorization: Bearer ...
Content-Type: application/json

{
  "label": "sa-1",                  // tuỳ chọn — bỏ trống thì dùng client_email
  "note": "tài khoản chính",        // tuỳ chọn
  "active": true,                    // mặc định true
  "sa": {
    "type": "service_account",
    "project_id": "hct-order-return",
    "private_key_id": "abc123...",
    "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEv...\n-----END PRIVATE KEY-----\n",
    "client_email": "tiktok-order-return@hct-order-return.iam.gserviceaccount.com",
    "client_id": "...",
    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
    "token_uri": "https://oauth2.googleapis.com/token",
    "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
    "client_x509_cert_url": "...",
    "universe_domain": "googleapis.com"
  }
}
```

Body **dạng string** (frontend không parse, gửi nguyên xi):

```json
{ "sa": "{\n  \"type\": \"service_account\", ...}" }
```

Backend validate:
- `type === "service_account"`
- `client_email` matched `*@*.iam.gserviceaccount.com`
- `private_key` chứa cả `BEGIN PRIVATE KEY` lẫn `END PRIVATE KEY`
- `project_id` không rỗng

Sau đó mã hoá `private_key` bằng AES-256-GCM (`ENCRYPTION_KEY`) rồi lưu
collection `service_accounts`. Response trả `id`, `label`, `clientEmail`,
`projectId`, `active` — **không bao giờ** trả lại `private_key`.

### 6.2 Liệt kê SA + lấy email để share sheet

```http
GET /api/v1/service-accounts            # full info
GET /api/v1/service-accounts/emails     # gọn — dùng cho UI hiển thị danh sách email
```

`/emails` trả `[{ id, label, clientEmail, active }]` — UI dùng list này để
hướng dẫn user share Google Sheet (Editor) cho từng email trước khi save
TikTok account.

### 6.3 Bật/tắt + xoá

```http
PATCH  /api/v1/service-accounts/:id   { "active": false }
DELETE /api/v1/service-accounts/:id
```

### 6.4 Rotation

Khi gọi Google Sheets, backend lấy danh sách SA active từ DB, round-robin.
Gặp 429 → mark `cooldownUntil = now+60s` cho SA đó và retry sang SA kế tiếp.
Pool được query lại mỗi lần `pick()` nên admin tắt/bật SA có hiệu lực ngay
lập tức.

## 7. Đăng ký 1 tài khoản TikTok (kèm cảnh báo share sheet)

UI flow:

1. Gọi `GET /service-accounts/emails` → hiển thị list email.
2. Hỏi user: *"Đã share `<spreadsheetId>` (Editor) cho các email sau? Đã bật full quyền cho folder/file?"* — bắt confirm.
3. Sau khi user confirm:

```http
POST /api/v1/tiktok-accounts
Authorization: Bearer ...
Content-Type: application/json

{
  "name": "shop-a",
  "cookie": "msToken=...; sessionid=...; tt_csrf_token=...; ...",
  "shopId": "7495155952483076181",
  "shopRegion": "VN",
  "spreadsheetId": "1AbCdEfGhIjKlMnOpQrStUvWxYz..."
}
```

4. (Khuyến cáo) Sau khi tạo, gọi endpoint dưới để probe quyền truy cập sheet:

```http
POST /api/v1/tiktok-accounts/:id/test-sheet-access
Authorization: Bearer ...
```

→ Trả về `{ spreadsheetId, allOk: bool, results: [{ saId, clientEmail, ok, error? }] }`.
Nếu có SA fail → UI cảnh báo user share thêm cho SA đó trước khi chạy job.

## 8. Tìm creator + chọn để fetch

```http
GET /api/v1/creators/search?tiktokAccountId=<id>&query=tên+creator&page=1&size=12
Authorization: Bearer ...
```

Mỗi `items[i]` chứa các field hiển thị thẳng UI:

| Field | Ý nghĩa | Hiển thị |
|-------|---------|----------|
| `handle`, `nickname`, `avatar`, `selectionRegion` | Cột "Nhà sáng tạo" | tên + region |
| `categories` | Niches | tag |
| `follower_cnt` | Followers | "1,2M" |
| `topGender` | `{ key:'male'|'female', value:0.62 }` | icon ♂/♀ + % |
| `topAgeRanges` | `["25-34","18-24"]` | "25-34, 18-24" |
| `topVideo` | `{ videoId, thumbUrl, durationSec, playCnt, likeCnt, commentCnt }` | Cột "Video" |
| `gmvRange`, `gmvMedian` | Cột "GMV" | "1Mđ+" |
| `unitsSold`, `unitsSoldRange` | Cột "Số món bán ra" | "25,4K" |
| `avgViewCnt` | Lượt xem video TB | "3,9K" |
| `engagementPercent` | Tỷ lệ tương tác (%) | "0,30%" |
| `tracked` | Đã track trong DB hay chưa | checkbox |

Track:

```http
POST /api/v1/creators/track
{ "tiktokAccountId": "<id>", "items": [{ "oecuid": "...", "handle": "...", "nickname": "..." }] }

GET    /api/v1/creators/tracked?tiktokAccountId=<id>&page=1&size=20&q=keyword
DELETE /api/v1/creators/tracked/:tiktokAccountId/:oecuid
```

## 9. Trigger lấy full profile (= aff-full-profile.js)

```http
POST /api/v1/profile-jobs
{
  "tiktokAccountId": "<id>",
  "creatorIds": ["7295194437420009482", "..."],
  "profileTypes": [1, 2, 3, 4, 5],
  "delayMs": 3000
}

GET /api/v1/profile-jobs/:id
```

Job lifecycle:
1. Launch headless Chromium, inject SDK, set cookies.
2. Với mỗi creator × profile_type, ký URL bằng `frontierSign` rồi POST.
3. Flatten 3 sheet: `overview`, `top_videos`, `trend`.
4. **Upsert** theo key column (Overview: `oec_id`; Top videos: `creator_oec_id`+`kind`+`video_id`; Trend: `creator_oec_id`+`metric`+`date`+`time_selector`+`filter`).
5. Mark `lastFetchedAt`, `lastJobId` cho creator.

## 10. Audit log

```http
GET /api/v1/audit-logs?page=1&size=50&action=auth.login
```

Mỗi record: `{ actor, action, targetType?, targetId?, success, ip, userAgent, meta?, createdAt }`.
Các action được ghi: `auth.login`, `service-account.create/update/delete`,
`tiktok-account.create/update/delete`.

## 11. Endpoint tóm tắt

| Method | Path | Public |
|--------|------|--------|
| GET    | `/api/v1/health`                                       | yes |
| POST   | `/api/v1/auth/login`                                   | yes |
| GET    | `/api/v1/auth/me`                                      | no  |
| POST   | `/api/v1/service-accounts`                             | no  |
| GET    | `/api/v1/service-accounts`                             | no  |
| GET    | `/api/v1/service-accounts/emails`                      | no  |
| PATCH  | `/api/v1/service-accounts/:id`                         | no  |
| DELETE | `/api/v1/service-accounts/:id`                         | no  |
| POST   | `/api/v1/tiktok-accounts`                              | no  |
| GET    | `/api/v1/tiktok-accounts`                              | no  |
| GET    | `/api/v1/tiktok-accounts/:id`                          | no  |
| PATCH  | `/api/v1/tiktok-accounts/:id`                          | no  |
| DELETE | `/api/v1/tiktok-accounts/:id`                          | no  |
| POST   | `/api/v1/tiktok-accounts/:id/test-sheet-access`        | no  |
| GET    | `/api/v1/creators/search`                              | no  |
| POST   | `/api/v1/creators/track`                               | no  |
| GET    | `/api/v1/creators/tracked`                             | no  |
| DELETE | `/api/v1/creators/tracked/:tiktokAccountId/:oecuid`    | no  |
| POST   | `/api/v1/profile-jobs`                                 | no  |
| GET    | `/api/v1/profile-jobs`                                 | no  |
| GET    | `/api/v1/profile-jobs/:id`                             | no  |
| GET    | `/api/v1/audit-logs`                                   | no  |

## 12. Environment variables

| Key | Mặc định | Mô tả |
|-----|----------|-------|
| `PORT` | `3000` | Cổng Fastify |
| `HOST` | `0.0.0.0` | Bind host (trong container). Docker map ra `127.0.0.1`. |
| `MONGO_ROOT_USERNAME` / `MONGO_ROOT_PASSWORD` | `root` / — | Mongo auth root |
| `MONGO_URI` | — | DSN, phải có credential + `authSource=admin` |
| `MONGO_DB` | `tiktok_api` | DB name |
| `JWT_SECRET` | — | Bắt buộc, >=32 ký tự, không trùng default phổ biến |
| `JWT_EXPIRES_IN` | `12h` | TTL access token |
| `ADMIN_USERNAME` | `admin` | Username admin |
| `ADMIN_PASSWORD` | — | Plaintext (nếu không dùng hash) |
| `ADMIN_PASSWORD_HASH` | — | argon2 hash (khuyến cáo dùng cái này) |
| `ENCRYPTION_KEY` | — | **Bắt buộc**, 64 ký tự hex (32 bytes) |
| `CORS_ORIGINS` | — | CSV. Trống = chặn. `*` = mở (chỉ dev). |
| `RATE_LIMIT_GLOBAL` | `100` | Req/phút global. `0` = tắt. |
| `RATE_LIMIT_LOGIN` | `5` | Req/phút /auth/login. `0` = tắt. |
| `PUPPETEER_HEADLESS` | `true` | Headless Chromium |
| `PUPPETEER_EXECUTABLE_PATH` | (auto) | Path Chromium |
| `SDK_DIR` | `./sdk` | Thư mục chứa 2 SDK TikTok |
| `TIKTOK_DEFAULT_SHOP_ID` / `TIKTOK_DEFAULT_SHOP_REGION` | — / `VN` | Default khi tạo TikTok account |
| `TIKTOK_DEFAULT_DELAY_MS` | `3000` | Delay giữa mỗi call profile |
| `CREATOR_LIST_DEFAULT_SIZE` | `12` | Page size mặc định cho creator list |

## 13. Lưu ý production

- File SDK (`secsdk-lastest.umd.js`, `webmssdk.js`) copy từ `../api-test/` vào
  image lúc build. TikTok update SDK → replace 2 file đó rồi rebuild image.
- Cookie msToken hết hạn → endpoint trả status code khác 0 trong `progress[]`;
  update lại field `cookie` qua `PATCH /tiktok-accounts/:id`.
- SA share quyền **Editor** cho mọi spreadsheet đang dùng. Probe bằng
  `POST /tiktok-accounts/:id/test-sheet-access` trước khi chạy job.
- Sheet upsert đọc full sheet trước khi ghi → sheet > 50k row nên tách job
  theo batch creator.
- Backup `ENCRYPTION_KEY` riêng (KMS / vault). Backup DB **không** giải mã
  được private_key SA nếu mất key.
