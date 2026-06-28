import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument } from 'mongoose';

export type ServiceAccountDocument = HydratedDocument<ServiceAccount>;

@Schema({ collection: 'service_accounts', timestamps: true })
export class ServiceAccount {
  /** Label tự đặt cho UI (vd "SA-prod-1") */
  @Prop({ required: true, trim: true })
  label!: string;

  @Prop({ required: true, unique: true, index: true })
  clientEmail!: string;

  @Prop({ required: true })
  projectId!: string;

  /**
   * AES-256-GCM ciphertext (base64). KHÔNG bao giờ trả ra response.
   * Decrypt bằng EncryptionService trước khi tạo google-auth JWT.
   */
  @Prop({ required: true })
  encryptedPrivateKey!: string;

  /** Cho phép vô hiệu hoá tạm SA mà không cần xoá */
  @Prop({ default: true })
  active!: boolean;

  /** Khi 429 → set ts cooldown để rotator skip */
  @Prop()
  cooldownUntil?: Date;

  @Prop()
  lastUsedAt?: Date;

  /** Audit nhẹ */
  @Prop()
  createdBy?: string;

  @Prop()
  note?: string;
}

export const ServiceAccountSchema =
  SchemaFactory.createForClass(ServiceAccount);
