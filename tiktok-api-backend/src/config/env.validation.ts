import * as Joi from 'joi';

/**
 * Validate env tại boot. Production phải đặt JWT_SECRET >=32 chars,
 * ENCRYPTION_KEY 64 hex, ADMIN_PASSWORD hoặc ADMIN_PASSWORD_HASH.
 */
export const envSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3000),
  HOST: Joi.string().default('0.0.0.0'),
  GLOBAL_PREFIX: Joi.string().default('api/v1'),
  CORS_ORIGINS: Joi.string().allow('').default(''),
  RATE_LIMIT_GLOBAL_PER_MIN: Joi.number().default(100),
  RATE_LIMIT_LOGIN_PER_MIN: Joi.number().default(5),

  MONGO_URI: Joi.string().required(),
  MONGO_DB: Joi.string().default('tiktok_api'),

  ADMIN_USERNAME: Joi.string().required(),
  ADMIN_PASSWORD: Joi.string().min(8).allow(''),
  ADMIN_PASSWORD_HASH: Joi.string().allow(''),

  JWT_SECRET: Joi.string()
    .min(32)
    .required()
    .invalid(
      'change-me',
      'please-change-me',
      'replace-with-a-long-random-string',
    ),
  JWT_EXPIRES_IN: Joi.string().default('12h'),

  ENCRYPTION_KEY: Joi.string()
    .pattern(/^[0-9a-fA-F]{64}$/)
    .required()
    .messages({
      'string.pattern.base':
        'ENCRYPTION_KEY phải là 64 ký tự hex (32 byte). Dùng `openssl rand -hex 32` để sinh.',
    }),

  PUPPETEER_HEADLESS: Joi.string().valid('true', 'false').default('true'),
  PUPPETEER_EXECUTABLE_PATH: Joi.string().optional().allow(''),
  TIKTOK_DEFAULT_DELAY_MS: Joi.number().default(1000),
  CREATOR_LIST_DEFAULT_SIZE: Joi.number().default(12),
})
  .or('ADMIN_PASSWORD', 'ADMIN_PASSWORD_HASH')
  .messages({
    'object.missing':
      'Phải set ADMIN_PASSWORD hoặc ADMIN_PASSWORD_HASH (production nên dùng hash argon2)',
  });
