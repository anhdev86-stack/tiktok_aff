import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateCrawlerGroupDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  spreadsheetId?: string;

  @IsOptional()
  @IsString()
  sheetOverview?: string;

  @IsOptional()
  @IsString()
  sheetTopVideos?: string;

  @IsOptional()
  @IsString()
  sheetTrend?: string;

  /**
   * Array of [categoryId, categoryName] tuples. [] = all categories.
   */
  @IsOptional()
  @IsArray()
  @IsArray({ each: true })
  @Transform(({ value }: { value: unknown }) => {
    if (!Array.isArray(value)) return value;
    return value.map((item: unknown) => {
      if (
        Array.isArray(item) &&
        item.length === 2 &&
        typeof item[0] === 'string' &&
        typeof item[1] === 'string'
      ) {
        return item as [string, string];
      }
      return item;
    });
  })
  categoryList?: Array<[string, string]>;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
