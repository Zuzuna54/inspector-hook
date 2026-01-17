/**
 * Diff Engine
 * Computes and formats diffs between file versions
 * Uses a simplified Myers diff algorithm for line-by-line comparison
 */

import { createHash } from "node:crypto";
import type { DiffHunk, DiffLine, DiffResult } from "@inspector-hook/protocol";

export interface DiffOptions {
	contextLines?: number; // Number of context lines around changes (default: 3)
	ignoreWhitespace?: boolean;
}

export class DiffEngine {
	private defaultContextLines = 3;

	/**
	 * Compute diff between two strings
	 */
	computeDiff(before: string, after: string, options?: DiffOptions): DiffResult {
		const contextLines = options?.contextLines ?? this.defaultContextLines;
		const ignoreWhitespace = options?.ignoreWhitespace ?? false;

		const beforeLines = this.splitLines(before);
		const afterLines = this.splitLines(after);

		// Compute the edit script using LCS (Longest Common Subsequence)
		const editScript = this.computeEditScript(
			beforeLines,
			afterLines,
			ignoreWhitespace,
		);

		// Group edits into hunks with context
		const hunks = this.createHunks(
			beforeLines,
			afterLines,
			editScript,
			contextLines,
		);

		// Calculate totals
		let additions = 0;
		let deletions = 0;
		for (const hunk of hunks) {
			additions += hunk.additions;
			deletions += hunk.deletions;
		}

		return {
			beforeContent: before,
			afterContent: after,
			hunks,
			additions,
			deletions,
		};
	}

	/**
	 * Split content into lines, preserving line endings info
	 */
	private splitLines(content: string): string[] {
		if (!content) return [];
		// Split on newlines but keep track of the actual content
		return content.split("\n");
	}

	/**
	 * Compute edit script using LCS algorithm
	 * Returns an array of edit operations
	 */
	private computeEditScript(
		beforeLines: string[],
		afterLines: string[],
		ignoreWhitespace: boolean,
	): EditOperation[] {
		const m = beforeLines.length;
		const n = afterLines.length;

		// Normalize lines if ignoring whitespace
		const normalizeForCompare = (line: string): string => {
			if (ignoreWhitespace) {
				return line.trim().replace(/\s+/g, " ");
			}
			return line;
		};

		// Build LCS matrix
		const lcs: number[][] = Array(m + 1)
			.fill(null)
			.map(() => Array(n + 1).fill(0));

		for (let i = 1; i <= m; i++) {
			for (let j = 1; j <= n; j++) {
				if (
					normalizeForCompare(beforeLines[i - 1]) ===
					normalizeForCompare(afterLines[j - 1])
				) {
					lcs[i][j] = lcs[i - 1][j - 1] + 1;
				} else {
					lcs[i][j] = Math.max(lcs[i - 1][j], lcs[i][j - 1]);
				}
			}
		}

		// Backtrack to get edit script
		const operations: EditOperation[] = [];
		let i = m;
		let j = n;

		while (i > 0 || j > 0) {
			if (
				i > 0 &&
				j > 0 &&
				normalizeForCompare(beforeLines[i - 1]) ===
					normalizeForCompare(afterLines[j - 1])
			) {
				operations.unshift({
					type: "equal",
					beforeIndex: i - 1,
					afterIndex: j - 1,
				});
				i--;
				j--;
			} else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
				operations.unshift({
					type: "insert",
					afterIndex: j - 1,
				});
				j--;
			} else if (i > 0) {
				operations.unshift({
					type: "delete",
					beforeIndex: i - 1,
				});
				i--;
			}
		}

		return operations;
	}

	/**
	 * Create hunks from edit script with context lines
	 */
	private createHunks(
		beforeLines: string[],
		afterLines: string[],
		editScript: EditOperation[],
		contextLines: number,
	): DiffHunk[] {
		if (editScript.length === 0) {
			return [];
		}

		// Find ranges of changes
		const changeRanges: { start: number; end: number }[] = [];
		let inChange = false;
		let changeStart = 0;

		for (let i = 0; i < editScript.length; i++) {
			const op = editScript[i];
			if (op.type !== "equal") {
				if (!inChange) {
					inChange = true;
					changeStart = i;
				}
			} else if (inChange) {
				changeRanges.push({ start: changeStart, end: i - 1 });
				inChange = false;
			}
		}
		if (inChange) {
			changeRanges.push({ start: changeStart, end: editScript.length - 1 });
		}

		// If no changes, return empty
		if (changeRanges.length === 0) {
			return [];
		}

		// Merge nearby ranges (within 2 * contextLines)
		const mergedRanges: { start: number; end: number }[] = [];
		for (const range of changeRanges) {
			if (
				mergedRanges.length === 0 ||
				range.start - mergedRanges[mergedRanges.length - 1].end >
					2 * contextLines
			) {
				mergedRanges.push({ ...range });
			} else {
				mergedRanges[mergedRanges.length - 1].end = range.end;
			}
		}

		// Create hunks from merged ranges
		const hunks: DiffHunk[] = [];

		for (const range of mergedRanges) {
			// Expand range to include context
			const expandedStart = Math.max(0, range.start - contextLines);
			const expandedEnd = Math.min(
				editScript.length - 1,
				range.end + contextLines,
			);

			const lines: DiffLine[] = [];
			let additions = 0;
			let deletions = 0;
			let oldStart = -1;
			let newStart = -1;
			let oldLines = 0;
			let newLines = 0;

			for (let i = expandedStart; i <= expandedEnd; i++) {
				const op = editScript[i];

				if (op.type === "equal") {
					const lineNum = op.beforeIndex! + 1;
					if (oldStart === -1) oldStart = lineNum;
					if (newStart === -1) newStart = op.afterIndex! + 1;
					lines.push({
						type: "context",
						content: beforeLines[op.beforeIndex!],
						lineNumber: lineNum,
					});
					oldLines++;
					newLines++;
				} else if (op.type === "delete") {
					const lineNum = op.beforeIndex! + 1;
					if (oldStart === -1) oldStart = lineNum;
					lines.push({
						type: "removed",
						content: beforeLines[op.beforeIndex!],
						lineNumber: lineNum,
					});
					deletions++;
					oldLines++;
				} else if (op.type === "insert") {
					const lineNum = op.afterIndex! + 1;
					if (newStart === -1) newStart = lineNum;
					lines.push({
						type: "added",
						content: afterLines[op.afterIndex!],
						lineNumber: lineNum,
					});
					additions++;
					newLines++;
				}
			}

			if (oldStart === -1) oldStart = 1;
			if (newStart === -1) newStart = 1;

			hunks.push({
				id: `hunk-${createHash("md5").update(`${oldStart}-${newStart}`).digest("hex").slice(0, 8)}`,
				oldStart,
				oldLines,
				newStart,
				newLines,
				lines,
				additions,
				deletions,
				status: "pending",
			});
		}

		return hunks;
	}

	/**
	 * Format diff as unified diff string
	 */
	formatUnifiedDiff(
		diff: DiffResult,
		options?: { fileName?: string; oldLabel?: string; newLabel?: string },
	): string {
		const fileName = options?.fileName || "file";
		const oldLabel = options?.oldLabel || `a/${fileName}`;
		const newLabel = options?.newLabel || `b/${fileName}`;

		let output = "";
		output += `--- ${oldLabel}\n`;
		output += `+++ ${newLabel}\n`;

		for (const hunk of diff.hunks) {
			output += `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n`;

			for (const line of hunk.lines) {
				const prefix =
					line.type === "added" ? "+" : line.type === "removed" ? "-" : " ";
				output += `${prefix}${line.content}\n`;
			}
		}

		return output;
	}

	/**
	 * Format diff as side-by-side view
	 */
	formatSideBySide(
		diff: DiffResult,
		options?: { lineWidth?: number },
	): { left: string[]; right: string[] } {
		const lineWidth = options?.lineWidth || 80;
		const left: string[] = [];
		const right: string[] = [];

		for (const hunk of diff.hunks) {
			for (const line of hunk.lines) {
				if (line.type === "context") {
					left.push(this.truncate(line.content, lineWidth));
					right.push(this.truncate(line.content, lineWidth));
				} else if (line.type === "removed") {
					left.push(this.truncate(line.content, lineWidth));
					right.push("");
				} else if (line.type === "added") {
					left.push("");
					right.push(this.truncate(line.content, lineWidth));
				}
			}
		}

		return { left, right };
	}

	/**
	 * Get statistics about the diff
	 */
	getStats(diff: DiffResult): {
		additions: number;
		deletions: number;
		totalChanges: number;
		hunksCount: number;
	} {
		return {
			additions: diff.additions,
			deletions: diff.deletions,
			totalChanges: diff.additions + diff.deletions,
			hunksCount: diff.hunks.length,
		};
	}

	/**
	 * Check if two contents are identical
	 */
	areIdentical(before: string, after: string): boolean {
		return before === after;
	}

	/**
	 * Compute hash of content for quick comparison
	 */
	computeHash(content: string): string {
		return createHash("md5").update(content).digest("hex");
	}

	private truncate(str: string, maxLength: number): string {
		if (str.length <= maxLength) return str;
		return str.slice(0, maxLength - 3) + "...";
	}
}

/**
 * Edit operation type
 */
interface EditOperation {
	type: "equal" | "insert" | "delete";
	beforeIndex?: number;
	afterIndex?: number;
}
