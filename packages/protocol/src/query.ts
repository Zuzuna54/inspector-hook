/**
 * Generic pagination and sorting helpers.
 *
 * Split out of the former single index.ts; index.ts re-exports every
 * name here, so imports from @inspector-hook/protocol are unchanged.
 */


/**
 * Pagination options
 */
export interface PaginationOptions {
	offset?: number;
	limit?: number;
}


/**
 * Sort options
 */
export interface SortOptions {
	field: string;
	order: "asc" | "desc";
}


/**
 * Generic paginated result
 */
export interface PaginatedResult<T> {
	items: T[];
	total: number;
	offset: number;
	limit: number;
}
