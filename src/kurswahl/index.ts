import type { Drift } from '../app.js';
import type { SignalOption } from '../connection.js';
import { fail, layoutChanged } from '../errors.js';
import { CookieJar } from '../transport/cookies.js';
import { Transport, type FetchFunction, type TransportSettings } from '../transport/http.js';
import { isRecord, parseJson, positive } from '../util.js';
import { KurswahlConnection } from './connection.js';
import { KurswahlSession, WWW } from './session.js';
import { signIn, type KurswahlCredentials } from './sign-in.js';
import { isSchool, readKurswahlState } from './state.js';
import type { School } from './types.js';

export { KurswahlConnection, type TimetableOptions } from './connection.js';
export type { KurswahlAccount } from './session.js';
export type { KurswahlCredentials } from './sign-in.js';
export type * from './types.js';

// Kurswahl Online sends any client it does not take for a browser to its main site.
const BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0';

export interface KurswahlOptions {
	/** Replaces the global fetch, e.g. for a proxy or tests. */
	fetch?: FetchFunction;
	/** Must look like a browser's, or Kurswahl Online refuses; defaults to a current Firefox. */
	userAgent?: string;
	/** Milliseconds per request, including the wait for each body chunk; defaults to 15000. */
	timeoutMs?: number;
	/** Called once per connection for each kind of drift; log it to learn that ranzen needs an update. */
	onDrift?: (drift: Drift) => void;
}

export interface Kurswahl {
	/** Every school on Kurswahl Online; no sign-in needed. */
	schools(options?: SignalOption): Promise<School[]>;
	/** Signs in like the login page does, Argon2 hashing included (about a second of CPU). */
	login(credentials: KurswahlCredentials, options?: SignalOption): Promise<KurswahlConnection>;
	/** Validates and rebuilds a connection from exportState() without any request. */
	restore(state: string): KurswahlConnection;
}

/** A Kurswahl Online client, independent of any Schulportal connection; creating it makes no request. */
export function createKurswahl(options: KurswahlOptions = {}): Kurswahl {
	const base = {
		fetch: options.fetch ?? ((url: string, init: RequestInit) => fetch(url, init)),
		userAgent: options.userAgent ?? BROWSER,
		timeoutMs: positive(options.timeoutMs ?? 15_000, 'timeoutMs'),
		maxConcurrency: 1
	};
	// One host per transport, so a signed-in session never reaches the main site or another school.
	const settings = (school: string | null): TransportSettings => ({
		...base,
		hosts: new Set([school ? `${school}.kurswahl-online.de` : new URL(WWW).host])
	});

	return {
		async schools({ signal } = {}) {
			const reply = await new Transport(settings(null)).send({
				url: `${WWW}/ajax.php`,
				query: { type: 'schulen' },
				signal
			});
			const data = parseJson(reply.text, 'the school list');
			if (!isRecord(data) || Array.isArray(data))
				throw layoutChanged('the school list as an object');
			return Object.entries(data).flatMap(([id, name]) =>
				isSchool(id) && typeof name === 'string' ? [{ id, name: name.trim() }] : []
			);
		},
		async login(credentials, { signal } = {}) {
			for (const field of ['school', 'username', 'password'] as const) {
				if (typeof credentials[field] !== 'string' || !credentials[field]) {
					throw fail('INVALID_OPTION', `${field} must be a non-empty string.`);
				}
			}
			if (!isSchool(credentials.school)) {
				throw fail('INVALID_OPTION', 'school must be a Kurswahl subdomain such as "musterschule".');
			}
			const session = await signIn(
				new Transport(settings(credentials.school)),
				credentials,
				signal
			);
			return new KurswahlConnection(session, options.onDrift);
		},
		restore(state) {
			const { account, token, database, cookies } = readKurswahlState(state);
			const transport = new Transport(settings(account.school), CookieJar.restore(cookies));
			return new KurswahlConnection(
				new KurswahlSession(account, transport, token, database),
				options.onDrift
			);
		}
	};
}
