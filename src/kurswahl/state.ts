import { fail } from '../errors.js';
import { copyCookie, isCookie } from '../state.js';
import type { StoredCookie } from '../transport/cookies.js';
import { isRecord } from '../util.js';
import { isDatabase, isToken } from './parse.js';
import type { KurswahlAccount } from './session.js';

const FORMAT = 'ranzen/kurswahl@1';

export interface KurswahlState {
	account: KurswahlAccount;
	token: string | null;
	database: string | null;
	cookies: StoredCookie[];
}

export function writeKurswahlState({ account, token, database, cookies }: KurswahlState): string {
	const { school, username } = account;
	return JSON.stringify({ format: FORMAT, school, username, token, database, cookies });
}

export function readKurswahlState(text: string): KurswahlState {
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		throw fail('INVALID_STATE', 'Connection state is not valid JSON.');
	}
	if (!isRecord(data) || data.format !== FORMAT) {
		throw fail('INVALID_STATE', 'Connection state has an unknown format.');
	}
	const { school, username, token, database, cookies } = data;
	if (typeof school !== 'string' || !isSchool(school)) {
		throw fail('INVALID_STATE', 'Connection state has an invalid school.');
	}
	if (typeof username !== 'string' || !username) {
		throw fail('INVALID_STATE', 'Connection state has an invalid username.');
	}
	if (!isNullOr(token, isToken) || !isNullOr(database, isDatabase)) {
		throw fail('INVALID_STATE', 'Connection state has an invalid token or database.');
	}
	if (!Array.isArray(cookies) || !cookies.every(isCookie)) {
		throw fail('INVALID_STATE', 'Connection state has invalid cookies.');
	}
	return { account: { school, username }, token, database, cookies: cookies.map(copyCookie) };
}

/** A Kurswahl subdomain, so a school key can never point a request at another host. */
export function isSchool(value: string): boolean {
	return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value) && value !== 'www';
}

// The same checks the parser applies, so every exported state restores.
function isNullOr(value: unknown, valid: (text: string) => boolean): value is string | null {
	return value === null || (typeof value === 'string' && valid(value));
}
