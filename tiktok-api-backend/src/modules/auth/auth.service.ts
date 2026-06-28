import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { timingSafeEqual } from 'node:crypto';
import * as argon2 from 'argon2';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly cfg: ConfigService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Verify mật khẩu admin. Ưu tiên `ADMIN_PASSWORD_HASH` (argon2), fallback
   * sang `ADMIN_PASSWORD` plaintext (so sánh constant-time). Production nên
   * set hash để không lưu plaintext trong env.
   */
  private async verifyPassword(input: string): Promise<boolean> {
    const hash = this.cfg.get<string>('admin.passwordHash');
    if (hash) {
      try {
        return await argon2.verify(hash, input);
      } catch {
        return false;
      }
    }
    const plain = this.cfg.get<string>('admin.password');
    if (!plain) return false;
    const a = Buffer.from(plain, 'utf8');
    const b = Buffer.from(input, 'utf8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  async login(dto: LoginDto): Promise<{
    accessToken: string;
    tokenType: 'Bearer';
    expiresIn: string;
    user: { username: string; role: 'admin' };
  }> {
    const adminUser = this.cfg.get<string>('admin.username')!;

    if (
      dto.username !== adminUser ||
      !(await this.verifyPassword(dto.password))
    ) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload = { sub: adminUser, role: 'admin', username: adminUser };
    const expiresIn = this.cfg.get<string>('jwt.expiresIn') as string;
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.cfg.get<string>('jwt.secret'),
      expiresIn: expiresIn as never,
    });

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn,
      user: { username: adminUser, role: 'admin' },
    };
  }
}
