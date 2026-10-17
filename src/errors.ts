export type Failure =
	| { code: 'AUTH_LOCKED'; lockoutSeconds: number | null }
	| { code: 'RATE_LIMITED'; retryAfterSeconds: number | null }
	/** The portal's own error page; notice is its raw German text and may name people, so review it before logging. */
	| { code: 'PORTAL_ERROR'; notice: string }
	/** What ranzen looked for and did not find, free of personal data, e.g. "#mappen on the lessons page". */
	| { code: 'LAYOUT_CHANGED'; expected: string }
	| {
			code:
				| 'AUTH_FAILED'
				| 'SESSION_EXPIRED'
				| 'FORBIDDEN'
				| 'NOT_FOUND'
				| 'MAINTENANCE'
				| 'NETWORK'
				| 'TIMEOUT'
				| 'ABORTED'
				| 'HANDSHAKE_FAILED'
				| 'DECRYPT_FAILED'
				| 'INVALID_STATE'
				| 'INVALID_OPTION'
				| 'DISPOSED';
	  };

export type FailureCode = Failure['code'];

/**
 * Who has to act: ranzen no longer matches the portal, the portal is down or refusing,
 * the network failed, the account is not allowed, or the caller asked for something wrong or gone.
 */
export type Fault = 'ranzen' | 'portal' | 'network' | 'account' | 'caller';

const FAULTS: Record<FailureCode, Fault> = {
	LAYOUT_CHANGED: 'ranzen',
	HANDSHAKE_FAILED: 'ranzen',
	DECRYPT_FAILED: 'ranzen',
	PORTAL_ERROR: 'portal',
	MAINTENANCE: 'portal',
	RATE_LIMITED: 'portal',
	NETWORK: 'network',
	TIMEOUT: 'network',
	AUTH_FAILED: 'account',
	AUTH_LOCKED: 'account',
	SESSION_EXPIRED: 'account',
	FORBIDDEN: 'account',
	ABORTED: 'caller',
	INVALID_STATE: 'caller',
	INVALID_OPTION: 'caller',
	NOT_FOUND: 'caller',
	DISPOSED: 'caller'
};

const RETRYABLE = new Set<FailureCode>(['MAINTENANCE', 'RATE_LIMITED', 'NETWORK', 'TIMEOUT']);

/**
 * Every failure ranzen reports; switch on code, or on fault to decide who has to act.
 * For NETWORK, TIMEOUT and ABORTED, cause is the underlying fetch or abort error.
 */
export class RanzenError extends Error {
	override readonly name = 'RanzenError';
	/** The code plus details some failures carry, e.g. lockoutSeconds. */
	readonly failure: Failure;

	constructor(failure: Failure, message: string, options?: ErrorOptions) {
		super(message, options);
		this.failure = failure;
	}

	get code(): FailureCode {
		return this.failure.code;
	}

	get fault(): Fault {
		return FAULTS[this.failure.code];
	}

	/** The failure is temporary; it does not make repeating a write safe. */
	get retryable(): boolean {
		return RETRYABLE.has(this.failure.code);
	}
}

export function isRanzenError(error: unknown): error is RanzenError {
	return error instanceof RanzenError;
}

/** Anything ranzen throws that is not a RanzenError is a ranzen bug, so ranzen has to act. */
export function faultOf(error: unknown): Fault {
	return isRanzenError(error) ? error.fault : 'ranzen';
}

export function fail(
	code: Exclude<FailureCode, 'AUTH_LOCKED' | 'RATE_LIMITED' | 'PORTAL_ERROR' | 'LAYOUT_CHANGED'>,
	message: string,
	cause?: unknown
): RanzenError {
	return new RanzenError({ code }, message, cause === undefined ? undefined : { cause });
}

/** The portal changed in a way ranzen cannot read; a ranzen bug to report, not a portal outage. */
export function layoutChanged(expected: string, cause?: unknown): RanzenError {
	return new RanzenError(
		{ code: 'LAYOUT_CHANGED', expected },
		`ranzen no longer matches the portal: expected ${expected}.`,
		cause === undefined ? undefined : { cause }
	);
}
