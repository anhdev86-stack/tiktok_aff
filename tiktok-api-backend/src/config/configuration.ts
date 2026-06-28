export const configuration = () => ({
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
  globalPrefix: process.env.GLOBAL_PREFIX || 'api/v1',

  /**
   * CORS origin whitelist — phân tách bằng dấu phẩy. Để trống = chặn hết
   * (production an toàn). Dev có thể set `*` nhưng KHÔNG khuyến nghị
   * production vì cùng JWT bearer.
   */
  corsOrigins: (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  rateLimit: {
    /** Global limit (req/min/IP). 0 = disable. */
    global: Number(process.env.RATE_LIMIT_GLOBAL_PER_MIN || 100),
    /** Login endpoint limit (req/min/IP). */
    login: Number(process.env.RATE_LIMIT_LOGIN_PER_MIN || 5),
  },

  mongo: {
    uri: process.env.MONGO_URI || 'mongodb://localhost:27017/tiktok_api',
    db: process.env.MONGO_DB || 'tiktok_api',
  },

  admin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || '',
    /** Argon2 hash — nếu set thì ưu tiên hơn ADMIN_PASSWORD. */
    passwordHash: process.env.ADMIN_PASSWORD_HASH || '',
  },

  jwt: {
    secret: process.env.JWT_SECRET || '',
    expiresIn: process.env.JWT_EXPIRES_IN || '12h',
  },

  crypto: {
    /** 32-byte hex (64 ký tự) — bắt buộc, dùng cho AES-256-GCM. */
    encryptionKey: process.env.ENCRYPTION_KEY || '',
  },

  tiktok: {
    headless: (process.env.PUPPETEER_HEADLESS ?? 'true') !== 'false',
    defaultDelayMs: Number(process.env.TIKTOK_DEFAULT_DELAY_MS || 1000),
    chromiumPath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  },

  creator: {
    listDefaultSize: Number(process.env.CREATOR_LIST_DEFAULT_SIZE || 12),
  },
});

export type AppConfig = ReturnType<typeof configuration>;
