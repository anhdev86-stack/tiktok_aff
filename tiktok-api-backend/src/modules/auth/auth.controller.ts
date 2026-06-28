import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { type FastifyRequest } from 'fastify';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { LoginThrottleGuard } from '../../common/guards/login-throttle.guard';
import { AuditLogService } from '../audit-log/audit-log.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly audit: AuditLogService,
  ) {}

  @Public()
  @UseGuards(LoginThrottleGuard)
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: FastifyRequest) {
    try {
      const r = await this.auth.login(dto);
      void this.audit.record({
        actor: dto.username,
        action: 'auth.login',
        success: true,
        ip: req.ip,
        userAgent: req.headers['user-agent']?.toString(),
      });
      return r;
    } catch (err) {
      void this.audit.record({
        actor: dto.username,
        action: 'auth.login',
        success: false,
        ip: req.ip,
        userAgent: req.headers['user-agent']?.toString(),
      });
      if (err instanceof UnauthorizedException) throw err;
      throw err;
    }
  }

  @Get('me')
  me(@CurrentUser() user: { username?: string; role?: string }) {
    return { user };
  }
}
