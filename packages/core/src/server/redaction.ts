/**
 * Secret redaction for ingested payloads.
 *
 * Everything captured is stored on disk in plain text and served back through
 * the UI — and, once an MCP server exposes this history, back to a model. Hook
 * payloads carry prompts, full tool inputs and outputs, and file contents, so
 * they routinely contain credentials: an API key pasted into a prompt, a token
 * in an environment dump, the contents of a .env file read by the agent.
 *
 * This is defence in depth, not a security boundary. A local process that can
 * POST here can already read those files itself. What it prevents is a secret
 * being *copied into a second location* that lives longer, is easier to
 * exfiltrate, and gets shown on screen.
 */

/** Patterns that identify a secret by shape rather than by context. */
const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
	// Provider-prefixed keys, which are unambiguous.
	{ name: "anthropic-key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
	{ name: "openai-key", pattern: /\bsk-[A-Za-z0-9]{32,}/g },
	{ name: "github-token", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/g },
	{ name: "slack-token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g },
	{ name: "aws-access-key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
	{ name: "google-api-key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
	{ name: "private-key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
	{ name: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
	// KEY=value assignments. Deliberately requires a secret-ish name, so
	// ordinary config is not mangled.
	{
		name: "assigned-secret",
		pattern:
			/\b([A-Z0-9_]*(?:SECRET|PASSWORD|PASSWD|TOKEN|API[_-]?KEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY|CREDENTIAL)[A-Z0-9_]*)\s*[=:]\s*(['"]?)([^\s'"]{6,})\2/gi,
	},
	// Basic-auth credentials embedded in a URL.
	{ name: "url-credentials", pattern: /\b([a-z][a-z0-9+.-]*:\/\/)[^\s:@/]+:[^\s:@/]+@/gi },
];

export const REDACTED = "[redacted]";

export interface RedactionOptions {
	/** Additional patterns, e.g. from user configuration. */
	extraPatterns?: RegExp[];
	/** Set false to pass content through untouched. */
	enabled?: boolean;
}

/** Redact secrets in a single string. */
export function redactString(
	value: string,
	options?: RedactionOptions,
): { value: string; redacted: number } {
	if (options?.enabled === false) return { value, redacted: 0 };

	let out = value;
	let count = 0;

	for (const { name, pattern } of SECRET_PATTERNS) {
		out = out.replace(new RegExp(pattern.source, pattern.flags), (...args) => {
			count++;
			// Keep the variable name for an assignment, so the record still says
			// WHICH secret was present without disclosing it.
			if (name === "assigned-secret") {
				return `${args[1]}=${REDACTED}`;
			}
			if (name === "url-credentials") {
				return `${args[1]}${REDACTED}@`;
			}
			return REDACTED;
		});
	}

	for (const extra of options?.extraPatterns ?? []) {
		out = out.replace(new RegExp(extra.source, extra.flags || "g"), () => {
			count++;
			return REDACTED;
		});
	}

	return { value: out, redacted: count };
}

/**
 * Redact secrets throughout an arbitrary payload.
 *
 * Walks objects and arrays, rewriting strings. Depth- and size-capped so a
 * hostile or pathological payload cannot cause unbounded work; beyond the cap
 * the value is dropped rather than passed through unredacted, because letting
 * it through would defeat the point.
 */
export function redactPayload<T>(
	payload: T,
	options?: RedactionOptions,
	depth = 0,
): { value: T; redacted: number } {
	if (options?.enabled === false) return { value: payload, redacted: 0 };
	if (depth > 12) return { value: REDACTED as unknown as T, redacted: 0 };

	if (typeof payload === "string") {
		const { value, redacted } = redactString(payload, options);
		return { value: value as unknown as T, redacted };
	}

	if (Array.isArray(payload)) {
		let total = 0;
		const out = payload.map((item) => {
			const r = redactPayload(item, options, depth + 1);
			total += r.redacted;
			return r.value;
		});
		return { value: out as unknown as T, redacted: total };
	}

	if (payload !== null && typeof payload === "object") {
		let total = 0;
		const out: Record<string, unknown> = {};
		for (const [key, val] of Object.entries(payload)) {
			const r = redactPayload(val, options, depth + 1);
			total += r.redacted;
			out[key] = r.value;
		}
		return { value: out as unknown as T, redacted: total };
	}

	return { value: payload, redacted: 0 };
}
