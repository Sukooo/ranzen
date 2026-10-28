import { argon2i, argon2id } from 'hash-wasm';
import { fail, layoutChanged } from '../errors.js';
import type { Transport } from '../transport/http.js';
import { isRecord, parseJson } from '../util.js';
import { csrfToken } from './parse.js';
import {
	isLoginPage,
	KurswahlSession,
	nextToken,
	schoolUrl,
	type KurswahlAccount
} from './session.js';

export interface KurswahlCredentials {
	/** The school's subdomain, e.g. "musterschule"; see schools(). */
	school: string;
	username: string;
	password: string;
}

interface Argon2Parameters {
	type: 1 | 2;
	time: number;
	mem: number;
	parallelism: number;
	hashLen: number;
}

interface Salt {
	version: number;
	/** The version exactly as received, since the browser echoes it unchanged. */
	raw: unknown;
	salt: string;
	upgradeSalt: string | null;
}

/** Signs in like the login page's script does, hashing the password with Argon2 on this side. */
export async function signIn(
	transport: Transport,
	{ school, username, password }: KurswahlCredentials,
	signal: AbortSignal | undefined
): Promise<KurswahlSession> {
	const base = schoolUrl(school);
	const login = await transport.send({ url: `${base}/login.php`, redirects: 'manual', signal });
	// An unknown subdomain bounces to the main site.
	if (login.location) throw fail('NOT_FOUND', 'Kurswahl Online does not know this school.');
	const versions = argon2Parameters(login.text);
	let token = csrfToken(login.text);

	// The login page's XHR carries the token as a header and may get the next one back.
	const headers: Record<string, string> = { 'x-requested-with': 'XMLHttpRequest' };
	if (token) headers['x-csrf-token'] = token;
	const answer = await transport.send({
		url: `${base}/login.php`,
		method: 'POST',
		form: { ajax: 'argon2', username },
		headers,
		redirects: 'manual',
		signal
	});
	token = nextToken(answer, token);
	const { salts, rotating } = readSalts(parseJson(answer.text, 'the Argon2 salts'));

	const latest = versions.length - 1;
	const hash = (salt: string, version: number) => argon2(password, salt, versions[version]);
	const hashes: unknown[] = await Promise.all(
		salts.map(async ({ version, raw, salt, upgradeSalt }) => {
			const entry: Record<string, unknown> = {
				version: raw,
				hash: version === 0 ? password : await hash(salt, version),
				rotating: false
			};
			if (upgradeSalt) entry.upgrade_hash = await hash(upgradeSalt, latest);
			return entry;
		})
	);
	if (rotating) {
		hashes.push({
			version: latest,
			hash: await hash(rotating, latest),
			upgrade_hash: null,
			rotating: true
		});
	}

	const form = new FormData();
	form.set('username', username);
	form.set('passwort', '');
	form.set('keep_active', 'on');
	form.set('resolution', '1920x1080');
	form.set('realpasswort', JSON.stringify(hashes));
	form.set('_scrollLeft', '0');
	form.set('_scrollTop', '0');
	form.set('_scrollLocation', '/login.php');
	if (token) form.set('_anti_csrf_token', token);
	const result = await transport.send({
		url: `${base}/login.php`,
		method: 'POST',
		multipart: form,
		redirects: 'manual',
		signal
	});
	if (isLoginPage(result.text)) throw fail('AUTH_FAILED', 'Kurswahl Online rejected the login.');
	// The answer is an interstitial whose script continues with post_link("index.php").
	if (result.status !== 200 || !/post_link\(\s*["']index\.php["']/.test(result.text)) {
		throw layoutChanged('the page that follows a Kurswahl login');
	}

	const account: KurswahlAccount = { school, username };
	const session = new KurswahlSession(account, transport, csrfToken(result.text) ?? token);
	await session.page('index.php', {}, signal);
	return session;
}

// kwo.settings("argon2_client_parameters", ["dummy for old schema", {type, time, mem, ...}, ...])
function argon2Parameters(html: string): (Argon2Parameters | null)[] {
	const json = /kwo\.settings\(\s*"argon2_client_parameters"\s*,\s*(\[.*?\])\s*\)\s*;/s.exec(
		html
	)?.[1];
	const list = json === undefined ? null : parseJson(json, 'the Argon2 parameters');
	if (!Array.isArray(list) || list.length < 2) throw layoutChanged('the Argon2 parameters');
	return list.map((entry: unknown) => (isParameters(entry) ? entry : null));
}

// Far above today's cost (time 14, 56 MiB), so a broken page cannot exhaust the host.
const LIMITS = { time: 100, mem: 512 * 1024, parallelism: 16, hashLen: 256 };

function isParameters(value: unknown): value is Argon2Parameters {
	if (!isRecord(value) || (value.type !== 1 && value.type !== 2)) return false;
	return (['time', 'mem', 'parallelism', 'hashLen'] as const).every((key) => {
		const number = value[key];
		return Number.isSafeInteger(number) && Number(number) > 0 && Number(number) <= LIMITS[key];
	});
}

function readSalts(data: unknown): { salts: Salt[]; rotating: string | null } {
	if (!isRecord(data) || !Array.isArray(data.salts) || !data.salts.length) {
		throw layoutChanged('Argon2 salts for the login');
	}
	const salts = data.salts.map((entry: unknown): Salt => {
		const version = isRecord(entry) ? Number(entry.version) : NaN;
		if (!isRecord(entry) || !Number.isSafeInteger(version) || version < 0) {
			throw layoutChanged('Argon2 salts for the login');
		}
		const salt = typeof entry.salt === 'string' ? entry.salt : '';
		if (version !== 0 && !salt) throw layoutChanged('Argon2 salts for the login');
		return {
			version,
			raw: entry.version,
			salt,
			upgradeSalt: typeof entry.upgrade_salt === 'string' ? entry.upgrade_salt : null
		};
	});
	return { salts, rotating: typeof data.rotating_salt === 'string' ? data.rotating_salt : null };
}

// The browser worker passes UTF-8 bytes but the JS string length, so longer UTF-8 input is cut short.
export function argon2(
	password: string,
	salt: string,
	parameters: Argon2Parameters | null | undefined
): Promise<string> {
	if (!parameters) throw layoutChanged('Argon2 parameters for every salt version');
	const bytes = (value: string) => new TextEncoder().encode(value).slice(0, value.length);
	return (parameters.type === 2 ? argon2id : argon2i)({
		password: bytes(password),
		salt: bytes(salt),
		iterations: parameters.time,
		memorySize: parameters.mem,
		parallelism: parameters.parallelism,
		hashLength: parameters.hashLen,
		outputType: 'hex'
	}).catch((error: unknown) => {
		// hash-wasm refuses combinations such as too little memory per lane or a short salt.
		throw layoutChanged('usable Argon2 parameters and salts', error);
	});
}
