import {
  Injectable,
  InternalServerErrorException,
  Logger,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

/**
 * AES-256-GCM. Lưu định dạng base64 packed: iv (12B) | tag (16B) | cipher.
 * Khoá lấy từ env `ENCRYPTION_KEY` — phải là hex 64 ký tự (32 byte). Nếu thiếu
 * hoặc sai độ dài, app fail boot.
 */
@Injectable()
export class EncryptionService implements OnModuleInit {
  private readonly logger = new Logger(EncryptionService.name);
  private key!: Buffer;

  constructor(private readonly cfg: ConfigService) {}

  onModuleInit(): void {
    const raw = this.cfg.get<string>('crypto.encryptionKey');
    if (!raw) {
      throw new InternalServerErrorException(
        'ENCRYPTION_KEY missing — set 32-byte (64 hex char) random key',
      );
    }
    if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
      throw new InternalServerErrorException(
        'ENCRYPTION_KEY must be 64 hex chars (32 bytes)',
      );
    }
    this.key = Buffer.from(raw, 'hex');
    this.logger.log('Encryption key loaded (AES-256-GCM)');
  }

  encrypt(plain: string): string {
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv(ALGO, this.key, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, enc]).toString('base64');
  }

  decrypt(packed: string): string {
    const buf = Buffer.from(packed, 'base64');
    if (buf.length < IV_LEN + TAG_LEN) {
      throw new Error('Encrypted blob too short');
    }
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const enc = buf.subarray(IV_LEN + TAG_LEN);
    const decipher = createDecipheriv(ALGO, this.key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return dec.toString('utf8');
  }
}
