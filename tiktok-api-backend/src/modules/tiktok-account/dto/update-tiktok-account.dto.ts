import {
  IsBoolean,
  IsMongoId,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class UpdateTiktokAccountDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(10)
  cookie?: string;

  @IsOptional()
  @IsString()
  shopId?: string;

  @IsOptional()
  @IsString()
  shopRegion?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  note?: string;

  /**
   * Gán hoặc chuyển account sang nhóm crawler. null = bỏ khỏi nhóm.
   * @IsMongoId chỉ chạy khi value không phải null để cho phép unassign.
   */
  @IsOptional()
  @ValidateIf((o: UpdateTiktokAccountDto) => o.groupId !== null)
  @IsMongoId()
  groupId?: string | null;
}
