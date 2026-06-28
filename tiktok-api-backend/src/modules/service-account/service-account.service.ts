import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ServiceAccount,
  type ServiceAccountDocument,
} from './schemas/service-account.schema';
import { type CreateServiceAccountDto } from './dto/create-service-account.dto';
import { type UpdateServiceAccountDto } from './dto/update-service-account.dto';
import { EncryptionService } from '../../common/crypto/encryption.service';
import {
  probeServiceAccount,
  type SaHealthResult,
} from './service-account.health';

export interface PublicServiceAccount {
  id: string;
  label: string;
  clientEmail: string;
  projectId: string;
  active: boolean;
  cooldownUntil?: Date;
  lastUsedAt?: Date;
  note?: string;
  createdAt?: Date;
}

export interface DecryptedServiceAccount {
  id: string;
  label: string;
  clientEmail: string;
  projectId: string;
  privateKey: string;
}

interface SaJsonShape {
  type?: string;
  client_email?: string;
  private_key?: string;
  project_id?: string;
}

@Injectable()
export class ServiceAccountService {
  private readonly logger = new Logger(ServiceAccountService.name);

  constructor(
    @InjectModel(ServiceAccount.name)
    private readonly model: Model<ServiceAccountDocument>,
    private readonly crypto: EncryptionService,
  ) {}

  async create(
    dto: CreateServiceAccountDto,
    actor?: string,
  ): Promise<PublicServiceAccount> {
    const parsed = this.parseSaJson(dto.sa);
    const exists = await this.model
      .findOne({ clientEmail: parsed.client_email })
      .exec();
    if (exists) {
      throw new BadRequestException(
        `Service account ${parsed.client_email} đã tồn tại`,
      );
    }
    const encryptedPrivateKey = this.crypto.encrypt(parsed.private_key);
    const label = (dto.label?.trim() || parsed.client_email).slice(0, 120);
    const doc = await this.model.create({
      label,
      clientEmail: parsed.client_email,
      projectId: parsed.project_id,
      encryptedPrivateKey,
      active: dto.active ?? true,
      note: dto.note,
      createdBy: actor,
    });
    this.logger.log(
      `SA added: ${parsed.client_email} (label=${label}, by=${actor ?? 'unknown'})`,
    );
    return this.toPublic(doc);
  }

  async findAll(): Promise<PublicServiceAccount[]> {
    const docs = await this.model.find().sort({ createdAt: -1 }).exec();
    return docs.map((d) => this.toPublic(d));
  }

  async findActiveDecrypted(): Promise<DecryptedServiceAccount[]> {
    const now = new Date();
    const docs = await this.model
      .find({
        active: true,
        $or: [
          { cooldownUntil: { $exists: false } },
          { cooldownUntil: null },
          { cooldownUntil: { $lte: now } },
        ],
      })
      .exec();
    return docs.map((d) => ({
      id: String(d._id),
      label: d.label,
      clientEmail: d.clientEmail,
      projectId: d.projectId,
      privateKey: this.crypto.decrypt(d.encryptedPrivateKey),
    }));
  }

  async findActivePublic(): Promise<PublicServiceAccount[]> {
    const docs = await this.model.find({ active: true }).exec();
    return docs.map((d) => this.toPublic(d));
  }

  async findById(id: string): Promise<PublicServiceAccount> {
    const doc = await this.findDoc(id);
    return this.toPublic(doc);
  }

  async update(
    id: string,
    dto: UpdateServiceAccountDto,
  ): Promise<PublicServiceAccount> {
    const doc = await this.findDoc(id);
    if (dto.label !== undefined) doc.label = dto.label;
    if (dto.active !== undefined) doc.active = dto.active;
    if (dto.note !== undefined) doc.note = dto.note;
    await doc.save();
    return this.toPublic(doc);
  }

  async remove(id: string): Promise<{ deleted: true }> {
    const doc = await this.findDoc(id);
    await doc.deleteOne();
    return { deleted: true };
  }

  async markRateLimited(id: string, durationMs = 60_000): Promise<void> {
    await this.model
      .updateOne(
        { _id: new Types.ObjectId(id) },
        { $set: { cooldownUntil: new Date(Date.now() + durationMs) } },
      )
      .exec();
  }

  async markUsed(id: string): Promise<void> {
    await this.model
      .updateOne(
        { _id: new Types.ObjectId(id) },
        { $set: { lastUsedAt: new Date() } },
      )
      .exec();
  }

  /** Decrypt 1 SA theo id — dùng cho test-sheet-access */
  async decryptOne(id: string): Promise<DecryptedServiceAccount> {
    const doc = await this.findDoc(id);
    return {
      id: String(doc._id),
      label: doc.label,
      clientEmail: doc.clientEmail,
      projectId: doc.projectId,
      privateKey: this.crypto.decrypt(doc.encryptedPrivateKey),
    };
  }

  /**
   * Health-check SA: credential còn mint được token không (SA sống?), và —
   * nếu truyền spreadsheetId — có quyền vào sheet đó không.
   *
   * `id` rỗng → check toàn bộ SA (cả inactive) để thấy account nào hỏng.
   * Probe song song; 1 SA lỗi không kéo đổ các SA khác.
   */
  async healthCheck(opts: {
    id?: string;
    spreadsheetId?: string;
  }): Promise<SaHealthResult[]> {
    const docs = opts.id
      ? [await this.findDoc(opts.id)]
      : await this.model.find().sort({ createdAt: -1 }).exec();
    return Promise.all(
      docs.map((d) =>
        probeServiceAccount(
          {
            id: String(d._id),
            clientEmail: d.clientEmail,
            privateKey: this.crypto.decrypt(d.encryptedPrivateKey),
            active: d.active,
          },
          opts.spreadsheetId,
        ),
      ),
    );
  }

  private async findDoc(id: string): Promise<ServiceAccountDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Service account not found');
    }
    const doc = await this.model.findById(id).exec();
    if (!doc) throw new NotFoundException('Service account not found');
    return doc;
  }

  private toPublic(doc: ServiceAccountDocument): PublicServiceAccount {
    return {
      id: String(doc._id),
      label: doc.label,
      clientEmail: doc.clientEmail,
      projectId: doc.projectId,
      active: doc.active,
      cooldownUntil: doc.cooldownUntil,
      lastUsedAt: doc.lastUsedAt,
      note: doc.note,
      createdAt: (doc as unknown as { createdAt?: Date }).createdAt,
    };
  }

  /**
   * Chấp nhận object đã parse hoặc raw JSON string. Validate đúng shape SA của
   * Google Cloud (xem .env.example / README mục 6.1 để biết format).
   */
  private parseSaJson(
    raw: unknown,
  ): Required<
    Pick<SaJsonShape, 'client_email' | 'private_key' | 'project_id'>
  > {
    let obj: SaJsonShape;
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (!trimmed) {
        throw new BadRequestException('SA JSON rỗng');
      }
      try {
        obj = JSON.parse(trimmed) as SaJsonShape;
      } catch {
        throw new BadRequestException(
          'SA JSON không parse được — kiểm tra lại nội dung paste',
        );
      }
    } else if (raw && typeof raw === 'object') {
      obj = raw as SaJsonShape;
    } else {
      throw new BadRequestException('Trường "sa" phải là object hoặc string');
    }

    if (obj.type !== 'service_account') {
      throw new BadRequestException(
        'JSON không phải Service Account (type ≠ "service_account")',
      );
    }
    const email = obj.client_email?.trim();
    const projectId = obj.project_id?.trim();
    const privateKey = obj.private_key;
    if (!email || !privateKey || !projectId) {
      throw new BadRequestException(
        'SA JSON thiếu client_email / private_key / project_id',
      );
    }
    if (
      !privateKey.includes('BEGIN PRIVATE KEY') ||
      !privateKey.includes('END PRIVATE KEY')
    ) {
      throw new BadRequestException(
        'private_key có vẻ không hợp lệ (thiếu BEGIN/END PRIVATE KEY)',
      );
    }
    if (!/@.+\.iam\.gserviceaccount\.com$/.test(email)) {
      throw new BadRequestException(
        'client_email không phải email Service Account hợp lệ',
      );
    }
    return {
      client_email: email,
      private_key: privateKey,
      project_id: projectId,
    };
  }
}
