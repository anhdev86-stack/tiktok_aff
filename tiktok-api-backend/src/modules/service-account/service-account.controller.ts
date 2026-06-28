import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { type FastifyRequest } from 'fastify';
import { ServiceAccountService } from './service-account.service';
import { CreateServiceAccountDto } from './dto/create-service-account.dto';
import { UpdateServiceAccountDto } from './dto/update-service-account.dto';

@Controller('service-accounts')
export class ServiceAccountController {
  constructor(private readonly svc: ServiceAccountService) {}

  @Post()
  create(
    @Body() dto: CreateServiceAccountDto,
    @Req() req: FastifyRequest & { user?: { username?: string } },
  ) {
    return this.svc.create(dto, req.user?.username);
  }

  @Get()
  findAll() {
    return this.svc.findAll();
  }

  /** Public: trả list email của SA active để UI hiển thị cho user copy đi share sheet */
  @Get('emails')
  emails() {
    return this.svc.findActivePublic().then((list) =>
      list.map((s) => ({
        id: s.id,
        label: s.label,
        clientEmail: s.clientEmail,
        active: s.active,
      })),
    );
  }

  /**
   * Health-check toàn bộ SA: credential còn sống (mint được token) không, và —
   * nếu truyền `?spreadsheetId=` — có quyền vào sheet đó không.
   * Khai báo TRƯỚC `@Get(':id')` để không bị nuốt thành param "health".
   */
  @Get('health')
  health(@Query('spreadsheetId') spreadsheetId?: string) {
    return this.svc.healthCheck({ spreadsheetId });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.svc.findById(id);
  }

  /** Health-check 1 SA theo id (optional `?spreadsheetId=` để probe quyền sheet). */
  @Post(':id/health')
  healthOne(
    @Param('id') id: string,
    @Query('spreadsheetId') spreadsheetId?: string,
  ) {
    return this.svc.healthCheck({ id, spreadsheetId });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateServiceAccountDto) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}
