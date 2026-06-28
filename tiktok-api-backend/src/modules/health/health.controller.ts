import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';

@Controller('health')
export class HealthController {
  @Public()
  @Get()
  health() {
    return {
      ok: true,
      service: 'tiktok-api-backend',
      ts: new Date().toISOString(),
    };
  }
}
