import { z } from 'zod';

export const MAX_PAGE_SIZE = 100;

export const pageRequestSchema = z.object({
  page: z.number().int().min(0).default(0),
  pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).default(25),
});

export type PageRequest = z.infer<typeof pageRequestSchema>;

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
