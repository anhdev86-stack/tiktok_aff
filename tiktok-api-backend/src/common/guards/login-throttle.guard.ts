import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type FastifyRequest } from 'fastify';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * In-memory rate limit cho /auth/login. Mặc định 5 req/phút/IP — khoá brute-force
 * mật khẩu admin. Reset cửa sổ trượt mỗi phút.
 */
@Injectable()
export class LoginThrottleGuard implements CanActivate {
  private readonly buckets = new Map<string, Bucket>();
  private readonly limit: number;
  private readonly windowMs = 60_000;

  constructor(cfg: ConfigService) {
    this.limit = cfg.get<number>('rateLimit.login') ?? 5;
  }

  canActivate(context: ExecutionContext): boolean {
    if (this.limit <= 0) return true;
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const ip = req.ip ?? 'unknown';
    const now = Date.now();
    const b = this.buckets.get(ip);
    if (!b || b.resetAt <= now) {
      this.buckets.set(ip, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    if (b.count >= this.limit) {
      const retryMs = Math.max(0, b.resetAt - now);
      throw new HttpException(
        {
          statusCode: 429,
          error: 'Too Many Requests',
          message: `Quá nhiều lần đăng nhập sai. Thử lại sau ${Math.ceil(retryMs / 1000)}s.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    b.count += 1;
    return true;
  }
}
