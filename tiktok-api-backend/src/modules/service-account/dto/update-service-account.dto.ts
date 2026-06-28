import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateServiceAccountDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  label?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  note?: string;
}
