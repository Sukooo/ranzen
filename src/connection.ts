import { createContext, ensureOk, type App, type Drift } from './app.js';
import { fail, isRanzenError } from './errors.js';
import { PAGES } from './protocol/endpoints.js';
import type { Account, Session } from './session.js';
import { writeState } from './state.js';
import { positive } from './util.js';

export interface SignalOption {
	signal?: AbortSignal | undefined;
}

/** One signed-in portal session. Open apps on it, save it with exportState(), end it with logout(). */
export class Connection {
	readonly #session: Session;
	#heartbeat: ReturnType<typeof setInterval> | undefined;
	#beating = false;
	readonly #apps = new Map<App<unknown>, unknown>();
	readonly #onDrift: ((drift: Drift) => void) | undefined;
	readonly #drifted = new Set<string>();

	constructor(session: Session, onDrift?: (drift: Drift) => void) {
		this.#session = session;
		this.#onDrift = onDrift;
	}

	/** Binds an app to this connection without any request; the same app yields the same API. */
	open<Api>(app: App<Api>): Api {
		this.#session.ensureOpen();
		if (!this.#apps.has(app)) {
			const context = createContext(this.#session, (detail) =>
				this.#drift({ app: app.id, detail })
			);
			this.#apps.set(app, app.create(context));
		}
		return this.#apps.get(app) as Api;
	}

	// Once per kind and connection, so a page read in a loop does not flood the hook.
	#drift(drift: Drift): void {
		const key = `${drift.app}
${drift.detail}`;
		if (!this.#onDrift || this.#drifted.has(key)) return;
		this.#drifted.add(key);
		try {
			this.#onDrift(drift);
		} catch {
			// A failing log hook must not fail a read that succeeded.
		}
	}

	get account(): Account {
		return this.#session.account;
	}

	/** Cookies, cipher secret and identity; never the password. Store it encrypted. */
	exportState(): string {
		this.#session.ensureOpen();
		const { account, secret, transport } = this.#session;
		return writeState({ account, secret, cookies: transport.jar.snapshot() });
	}

	/**
	 * Extends the session. Throws SESSION_EXPIRED when the portal refuses, but the portal often
	 * answers an ended session like a live one, so only app calls prove that the session is alive.
	 */
	async keepAlive({ signal }: SignalOption = {}): Promise<void> {
		this.#session.ensureOpen();
		const sid = this.#session.transport.jar.get(new URL(PAGES.start), 'sid');
		if (!sid) throw fail('SESSION_EXPIRED', 'The connection has no portal session.');
		const { status } = await this.#session.send({
			url: PAGES.keepAlive,
			method: 'POST',
			form: { name: sid },
			headers: { 'x-requested-with': 'XMLHttpRequest' },
			redirects: 'manual',
			signal
		});
		if ((status >= 300 && status < 400) || status === 401 || status === 403) {
			throw fail('SESSION_EXPIRED', 'The portal session has ended.');
		}
		ensureOk(status, 'the keep-alive');
	}

	/** Pings the portal on an interval so long jobs keep the session; stops on dispose() or a lasting failure such as SESSION_EXPIRED. */
	keepWarm(intervalMs = 60_000): void {
		this.#session.ensureOpen();
		positive(intervalMs, 'intervalMs');
		clearInterval(this.#heartbeat);
		this.#heartbeat = setInterval(() => {
			if (this.#beating) return;
			this.#beating = true;
			this.keepAlive()
				.catch((error: unknown) => {
					if (!isRanzenError(error) || !error.retryable) clearInterval(this.#heartbeat);
				})
				.finally(() => (this.#beating = false));
		}, intervalMs);
		this.#heartbeat.unref();
	}

	/** Stops keepWarm() and cancels pending requests; the portal session stays valid for restore(). */
	dispose(): void {
		clearInterval(this.#heartbeat);
		this.#heartbeat = undefined;
		this.#session.dispose();
	}

	/** Ends the session on the portal, then disposes. */
	async logout({ signal }: SignalOption = {}): Promise<void> {
		try {
			await this.#session.send({ url: PAGES.logout, signal });
		} finally {
			this.dispose();
		}
	}
}
