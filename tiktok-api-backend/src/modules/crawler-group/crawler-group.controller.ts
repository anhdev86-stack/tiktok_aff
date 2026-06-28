import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CrawlerGroupService } from './crawler-group.service';
import { CreateCrawlerGroupDto } from './dto/create-crawler-group.dto';
import { UpdateCrawlerGroupDto } from './dto/update-crawler-group.dto';

/**
 * REST CRUD for crawler groups.
 * Start/stop lifecycle endpoints will be added to CrawlerController in Phase 2.
 */
@Controller('crawler-groups')
export class CrawlerGroupController {
  constructor(private readonly svc: CrawlerGroupService) {}

  /** GET /crawler-groups — list all groups */
  @Get()
  findAll() {
    return this.svc.findAll();
  }

  /** POST /crawler-groups — create a new group */
  @Post()
  create(@Body() dto: CreateCrawlerGroupDto) {
    return this.svc.create(dto);
  }

  /** GET /crawler-groups/:id — get a single group */
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.svc.findById(id);
  }

  /** GET /crawler-groups/:id/status — live status snapshot */
  @Get(':id/status')
  async getStatus(@Param('id') id: string) {
    const doc = await this.svc.findById(id);
    return this.svc.toStatusDto(doc);
  }

  /** PATCH /crawler-groups/:id — partial update of config fields */
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCrawlerGroupDto) {
    return this.svc.update(id, dto);
  }

  /** DELETE /crawler-groups/:id — blocked if accounts still assigned */
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}
