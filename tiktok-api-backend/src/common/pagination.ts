import type {
  FilterQuery,
  HydratedDocument,
  Model,
  QueryOptions,
  SortOrder,
} from 'mongoose';

/**
 * Shape chuẩn cho mọi endpoint phân trang. FE (`shadcn-admin`) consume đúng
 * field này — đừng tự ý đổi tên (page → pageNum, size → pageSize, …) ở từng
 * service nữa, dùng helper `paginate()` ở dưới để đảm bảo đồng nhất.
 */
export interface Paginated<T> {
  items: T[];
  page: number;
  size: number;
  total: number;
}

export interface PaginationInput {
  page?: number | string;
  size?: number | string;
}

const DEFAULT_PAGE = 1;
const DEFAULT_SIZE = 30;
const MAX_SIZE = 200;

/** Parse + clamp page/size từ query string. Luôn trả số nguyên hợp lệ. */
export function parsePagination(
  input: PaginationInput | undefined,
  defaults: { size?: number; max?: number } = {},
): { page: number; size: number } {
  const def = defaults.size ?? DEFAULT_SIZE;
  const max = defaults.max ?? MAX_SIZE;
  const page = Math.max(1, Math.floor(Number(input?.page) || DEFAULT_PAGE));
  const size = Math.min(
    max,
    Math.max(1, Math.floor(Number(input?.size) || def)),
  );
  return { page, size };
}

/**
 * Chạy `find + countDocuments` song song trên cùng filter và trả về `Paginated`.
 * Dùng cho mọi list endpoint có phân trang.
 *
 * Generic `TRaw` là class schema (vd `ProfileJob`); kết quả trả về là
 * `HydratedDocument<TRaw>` — khớp với `Model<HydratedDocument<TRaw>>` mà
 * NestJS `InjectModel` cung cấp ở các service.
 */
export async function paginate<TRaw>(
  model: Model<HydratedDocument<TRaw>>,
  args: {
    filter?: FilterQuery<TRaw>;
    sort?: Record<string, SortOrder>;
    page: number;
    size: number;
    options?: QueryOptions<TRaw>;
  },
): Promise<Paginated<HydratedDocument<TRaw>>> {
  const filter = (args.filter ?? {}) as FilterQuery<HydratedDocument<TRaw>>;
  const [items, total] = await Promise.all([
    model
      .find(filter, null, args.options as QueryOptions<HydratedDocument<TRaw>>)
      .sort(args.sort ?? { createdAt: -1 })
      .skip((args.page - 1) * args.size)
      .limit(args.size)
      .exec(),
    model.countDocuments(filter).exec(),
  ]);
  return { items, page: args.page, size: args.size, total };
}
