import { Request } from 'express';
import { PaginationParams } from '../types';

/**
 * Extracts pagination parameters from query string with sensible defaults.
 */
export function parsePagination(req: Request): PaginationParams {
  const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
  return { page, limit };
}

/**
 * Computes SQL OFFSET from pagination params.
 */
export function paginationOffset(params: PaginationParams): number {
  return (params.page - 1) * params.limit;
}

/**
 * Builds the standard pagination envelope.
 */
export function buildPaginatedResponse<T>(
  data: T[],
  total: number,
  params: PaginationParams,
) {
  return {
    data,
    pagination: {
      page: params.page,
      limit: params.limit,
      total,
      total_pages: Math.ceil(total / params.limit),
    },
  };
}
