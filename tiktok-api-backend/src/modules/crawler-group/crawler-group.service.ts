import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  CrawlerGroup,
  type CrawlerGroupDocument,
} from './schemas/crawler-group.schema';
import { TiktokAccount } from '../tiktok-account/schemas/tiktok-account.schema';
import { type CreateCrawlerGroupDto } from './dto/create-crawler-group.dto';
import { type UpdateCrawlerGroupDto } from './dto/update-crawler-group.dto';
import { type CrawlerGroupStatusDto } from './dto/crawler-group-status.dto';

/** Fields the GroupWorker (Phase 2) is allowed to update at runtime. */
export type GroupStatusPatch = Partial<
  Pick<
    CrawlerGroup,
    | 'status'
    | 'currentAccountId'
    | 'lastError'
    | 'lastLoopStartedAt'
    | 'lastLoopFinishedAt'
    | 'loopCount'
    | 'enabled'
  >
>;

@Injectable()
export class CrawlerGroupService {
  constructor(
    @InjectModel(CrawlerGroup.name)
    private readonly model: Model<CrawlerGroupDocument>,
    // TiktokAccount model re-exported from TiktokAccountModule via MongooseModule
    @InjectModel(TiktokAccount.name)
    private readonly accountModel: Model<{ groupId: Types.ObjectId | null }>,
  ) {}

  findAll(): Promise<CrawlerGroupDocument[]> {
    return this.model.find().sort({ createdAt: 1 }).exec();
  }

  findAllEnabled(): Promise<CrawlerGroupDocument[]> {
    return this.model.find({ enabled: true }).sort({ createdAt: 1 }).exec();
  }

  async findById(id: string): Promise<CrawlerGroupDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Crawler group not found');
    }
    const doc = await this.model.findById(id).exec();
    if (!doc) throw new NotFoundException('Crawler group not found');
    return doc;
  }

  async create(dto: CreateCrawlerGroupDto): Promise<CrawlerGroupDocument> {
    return this.model.create(dto);
  }

  async update(
    id: string,
    dto: UpdateCrawlerGroupDto,
  ): Promise<CrawlerGroupDocument> {
    const doc = await this.model
      .findByIdAndUpdate(id, { $set: dto }, { new: true })
      .exec();
    if (!doc) throw new NotFoundException('Crawler group not found');
    return doc;
  }

  /**
   * Delete a group. Blocks if any TiktokAccount still belongs to this group.
   * User must reassign accounts first (Phase 2 UI).
   */
  async remove(id: string): Promise<{ deleted: true }> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Crawler group not found');
    }
    const count = await this.accountModel
      .countDocuments({ groupId: new Types.ObjectId(id) })
      .exec();
    if (count > 0) {
      throw new BadRequestException(
        `Hãy chuyển ${count} account sang nhóm khác trước khi xoá nhóm này`,
      );
    }
    const r = await this.model.findByIdAndDelete(id).exec();
    if (!r) throw new NotFoundException('Crawler group not found');
    return { deleted: true };
  }

  async setEnabled(
    id: string,
    enabled: boolean,
  ): Promise<CrawlerGroupDocument> {
    const doc = await this.model
      .findByIdAndUpdate(id, { $set: { enabled } }, { new: true })
      .exec();
    if (!doc) throw new NotFoundException('Crawler group not found');
    return doc;
  }

  /** Atomic increment of loopCount. Called by GroupWorker (Phase 2). */
  async incrementLoopCount(id: string): Promise<void> {
    await this.model.findByIdAndUpdate(id, { $inc: { loopCount: 1 } }).exec();
  }

  /**
   * Patch live status fields. Called by GroupWorker (Phase 2) only.
   * NOT exposed through REST controller.
   */
  async updateStatus(id: string, patch: GroupStatusPatch): Promise<void> {
    await this.model.findByIdAndUpdate(id, { $set: patch }).exec();
  }

  /** Build status DTO from document. */
  toStatusDto(doc: CrawlerGroupDocument): CrawlerGroupStatusDto {
    return {
      groupId: String(doc._id),
      name: doc.name,
      enabled: doc.enabled,
      status: doc.status,
      currentAccountId: doc.currentAccountId
        ? String(doc.currentAccountId)
        : null,
      lastLoopStartedAt: doc.lastLoopStartedAt,
      lastLoopFinishedAt: doc.lastLoopFinishedAt,
      loopCount: doc.loopCount,
      lastError: doc.lastError,
    };
  }
}
