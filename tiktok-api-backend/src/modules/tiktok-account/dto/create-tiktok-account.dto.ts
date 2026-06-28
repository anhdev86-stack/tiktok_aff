import {
  IsBoolean,
  IsMongoId,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class CreateTiktokAccountDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(10)
  cookie!: string;

  @IsString()
  @MinLength(1)
  shopId!: string;

  @IsOptional()
  @IsString()
  shopRegion?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  note?: string;

  /** Gán account vào nhóm crawler. null = chưa gán. */
  @IsOptional()
  @IsMongoId()
  groupId?: string;
}
