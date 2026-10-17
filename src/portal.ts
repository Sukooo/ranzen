import type { Drift } from './app.js';
import { fail } from './errors.js';
import { Connection, type SignalOption } from './connection.js';
import { handshake, signIn, type Credentials } from './protocol/sign-in.js';
import { Session } from './session.js';
import { readState } from './state.js';
import { CookieJar } from './transport/cookies.js';
import { Transport, type FetchFunction, type TransportSettings } from './transport/http.js';
import { positive } from './util.js';

export interface PortalOptions {
	/** Replaces the global fetch, e.g. for a proxy or tests. */
	fetch?: FetchFunction;
	/** Sent with every request; defaults to "ranzen". */
	userAgent?: string;
	/** Milliseconds per request, including the wait for each body chunk; defaults to 15000. */
	timeoutMs?: number;
	/** Parallel requests per connection; extra calls wait for a slot. Defaults to 4. */
	maxConcurrency?: number;
	/** Called once per connection for each kind of drift; log it to learn that ranzen needs an update. */
	onDrift?: (drift: Drift) => void;
}

export interface Portal {
	/** Signs in like the browser does: login, then the encryption handshake. */
	login(credentials: Credentials, options?: SignalOption): Promise<Connection>;
	/** Validates and rebuilds a connection from exportState() without any request. */
	restore(state: string): Connection;
}

/** Settings shared by every connection it creates; creating a portal makes no request. */
export function createPortal(options: PortalOptions = {}): Portal {
	const settings: TransportSettings = {
		fetch: options.fetch ?? ((url, init) => fetch(url, init)),
		userAgent: options.userAgent ?? 'ranzen',
		timeoutMs: positive(options.timeoutMs ?? 15_000, 'timeoutMs'),
		maxConcurrency: positive(options.maxConcurrency ?? 4, 'maxConcurrency')
	};

	return {
		async login(credentials, { signal } = {}) {
			positive(credentials.schoolId, 'schoolId');
			for (const field of ['username', 'password'] as const) {
				if (typeof credentials[field] !== 'string' || !credentials[field]) {
					throw fail('INVALID_OPTION', `${field} must be a non-empty string.`);
				}
			}
			const transport = new Transport(settings);
			await signIn(transport, credentials, signal);
			const secret = await handshake(transport, signal);
			const account = { schoolId: credentials.schoolId, username: credentials.username };
			return new Connection(new Session(account, transport, secret), options.onDrift);
		},
		restore(state) {
			const { account, secret, cookies } = readState(state);
			return new Connection(
				new Session(account, new Transport(settings, CookieJar.restore(cookies)), secret),
				options.onDrift
			);
		}
	};
}
