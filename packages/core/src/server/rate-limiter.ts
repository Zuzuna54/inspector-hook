/**
 * Sliding-window rate limiter for the ingest endpoint.
 *
 * The endpoint had no limit at all. Any local process could flood it until the
 * disk filled — each accepted log is appended to a JSONL file, and each
 * fabricated session or change becomes its own JSON document with no cap.
 *
 * A sliding window rather than a fixed one: a fixed window lets a caller send
 * two full quotas back to back across a boundary.
 */
export interface RateLimiterOptions {
	/** Requests allowed per window. */
	limit: number;
	/** Window length in milliseconds. */
	windowMs: number;
}

export interface RateLimitResult {
	allowed: boolean;
	/** Requests still available in the current window. */
	remaining: number;
	/** Epoch ms at which the window frees up. */
	resetAt: number;
}

export class RateLimiter {
	private hits: Map<string, number[]> = new Map();
	private readonly limit: number;
	private readonly windowMs: number;

	constructor(options: RateLimiterOptions) {
		this.limit = Math.max(1, options.limit);
		this.windowMs = Math.max(1, options.windowMs);
	}

	/**
	 * Record a request and say whether it is allowed.
	 *
	 * A rejected request is NOT recorded. Otherwise a caller already over the
	 * limit would keep pushing its own window forward and stay locked out
	 * indefinitely rather than recovering after windowMs.
	 */
	check(key: string, now: number = Date.now()): RateLimitResult {
		const cutoff = now - this.windowMs;
		const recent = (this.hits.get(key) ?? []).filter((t) => t > cutoff);

		if (recent.length >= this.limit) {
			this.hits.set(key, recent);
			return {
				allowed: false,
				remaining: 0,
				// The oldest hit in the window is what has to expire.
				resetAt: recent[0] + this.windowMs,
			};
		}

		recent.push(now);
		this.hits.set(key, recent);
		return {
			allowed: true,
			remaining: this.limit - recent.length,
			resetAt: recent[0] + this.windowMs,
		};
	}

	/**
	 * Drop keys with no recent activity.
	 *
	 * Without this the map grows once per distinct key forever — which is its own
	 * unbounded-memory bug, in the thing meant to prevent one.
	 */
	prune(now: number = Date.now()): void {
		const cutoff = now - this.windowMs;
		for (const [key, times] of this.hits) {
			const recent = times.filter((t) => t > cutoff);
			if (recent.length === 0) this.hits.delete(key);
			else this.hits.set(key, recent);
		}
	}

	/** Number of keys currently tracked. Exposed for tests. */
	get trackedKeys(): number {
		return this.hits.size;
	}
}
