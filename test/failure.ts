import { isRanzenError, type FailureCode } from '../src/index.js';
import type { DriftSink } from '../src/util.js';

// The RanzenError code a synchronous call throws, or null if it returns.
export function failureCode(work: () => unknown): FailureCode | null {
	try {
		work();
	} catch (error) {
		if (isRanzenError(error)) return error.code;
		throw error;
	}
	return null;
}

// A drift sink that records what a parser reports.
export function driftLog(): { drift: DriftSink; details: string[] } {
	const details: string[] = [];
	return { drift: (detail) => void details.push(detail), details };
}
