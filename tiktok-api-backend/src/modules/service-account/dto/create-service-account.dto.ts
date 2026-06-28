import { IsBoolean, IsDefined, IsOptional, IsString } from 'class-validator';

/**
 * Body khi admin upload 1 Service Account.
 *
 * `sa` chấp nhận 2 dạng để UI linh hoạt:
 *  - **object**: paste vào textarea → frontend `JSON.parse` → POST nguyên object.
 *  - **string**: gửi raw JSON nguyên xi (frontend không parse).
 *
 * Backend validate `type === 'service_account'` và đầy đủ field bắt buộc
 * (`client_email`, `private_key`, `project_id`) trong service.
 */
export class CreateServiceAccountDto {
  @IsOptional()
  @IsString()
  label?: string;

  @IsDefined()
  sa!: Record<string, unknown> | string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
