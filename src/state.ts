import { fail } from './errors.js';
import { isSecret } from './protocol/cipher.js';
import type { Account } from './session.js';
import { isCookiePair, type StoredCookie } from './transport/cookies.js';

const FORMAT = 'ranzen/connection@1';

export interface ConnectionState {
	account: Account;
	secret: Uint8Array;
	cookies: StoredCookie[];
}

export function writeState({ account, secret, cookies }: ConnectionState): string {
	return JSON.stringify({
		format: FORMAT,
		schoolId: account.schoolId,
		username: account.username,
		secret: Buffer.from(secret).toString('base64'),
		cookies
	});
}

export function readState(text: string): ConnectionState {
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		throw fail('INVALID_STATE', 'Connection state is not valid JSON.');
	}
	if (!isRecord(data) || data.format !== FORMAT) {
		throw fail('INVALID_STATE', 'Connection state has an unknown format.');
	}
	const { schoolId, username, secret, cookies } = data;
	if (!Number.isSafeInteger(schoolId) || typeof schoolId !== 'number' || schoolId <= 0) {
		throw fail('INVALID_STATE', 'Connection state has an invalid school.');
	}
	if (typeof username !== 'string' || !username) {
		throw fail('INVALID_STATE', 'Connection state has an invalid username.');
	}
	const key = typeof secret === 'string' ? Buffer.from(secret, 'base64') : Buffer.alloc(0);
	if (!isSecret(key)) throw fail('INVALID_STATE', 'Connection state has an invalid secret.');
	if (!Array.isArray(cookies) || !cookies.every(isCookie)) {
		throw fail('INVALID_STATE', 'Connection state has invalid cookies.');
	}
	return {
		account: { schoolId, username },
		secret: key,
		cookies: cookies.map(({ name, value, domain, hostOnly, path, secure, expires }) =>
			expires === undefined
				? { name, value, domain, hostOnly, path, secure }
				: { name, value, domain, hostOnly, path, secure, expires }
		)
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCookie(value: unknown): value is StoredCookie {
	return (
		isRecord(value) &&
		typeof value.name === 'string' &&
		typeof value.value === 'string' &&
		isCookiePair(value.name, value.value) &&
		typeof value.domain === 'string' &&
		/^[a-z0-9.-]+$/.test(value.domain) &&
		typeof value.hostOnly === 'boolean' &&
		typeof value.path === 'string' &&
		value.path.startsWith('/') &&
		typeof value.secure === 'boolean' &&
		(value.expires === undefined || Number.isFinite(value.expires))
	);
}
