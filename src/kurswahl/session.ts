import { ensureOk } from '../app.js';
import { fail, isRanzenError, layoutChanged } from '../errors.js';
import type { Reply, Transport } from '../transport/http.js';
import { Limiter } from '../transport/limiter.js';
import { csrfToken, isToken } from './parse.js';

export interface KurswahlAccount {
	/** The school's subdomain, e.g. "musterschule". */
	readonly school: string;
	readonly username: string;
}

export const WWW = 'https://www.kurswahl-online.de';

export function schoolUrl(school: string): string {
	return `https://${school}.kurswahl-online.de`;
}

// Package-internal: one request at a time, since every reply hands out the next CSRF token.
export class KurswahlSession {
	readonly #life = new AbortController();
	readonly #queue = new Limiter(1);

	constructor(
		readonly account: KurswahlAccount,
		readonly transport: Transport,
		public token: string | null,
		public database: string | null = null
	) {}

	get disposed(): boolean {
		return this.#life.signal.aborted;
	}

	ensureOpen(): void {
		if (this.disposed) throw fail('DISPOSED', 'The connection was disposed.');
	}

	dispose(): void {
		this.#life.abort();
		this.transport.jar.clear();
	}

	/** A page the way post_link() opens it: a multipart POST carrying the current token. */
	page(path: string, fields: Record<string, string>, signal?: AbortSignal): Promise<Reply> {
		return this.#run(signal, async (bound) => {
			const form = new FormData();
			for (const [name, value] of Object.entries(fields)) form.set(name, value);
			form.set('_scrollLeft', '0');
			form.set('_scrollTop', '0');
			form.set('_scrollLocation', `/${path}`);
			if (this.token) form.set('_anti_csrf_token', this.token);
			const reply = await this.transport.send({
				url: `${schoolUrl(this.account.school)}/${path}`,
				method: 'POST',
				multipart: form,
				redirects: 'manual',
				signal: bound
			});
			this.#check(reply, path);
			// Every page hands out the token for the next request; going on with a stale one would fail later.
			const token = csrfToken(reply.text);
			if (!token) throw layoutChanged('an anti-CSRF token on the page');
			this.token = token;
			return reply;
		});
	}

	/** An XHR call; the token travels as a header, and a new one may come back the same way. */
	ajax(path: string, form: Record<string, string>, signal?: AbortSignal): Promise<Reply> {
		return this.#run(signal, async (bound) => {
			const headers: Record<string, string> = { 'x-requested-with': 'XMLHttpRequest' };
			if (this.token) headers['x-csrf-token'] = this.token;
			const reply = await this.transport.send({
				url: `${schoolUrl(this.account.school)}/${path}`,
				method: 'POST',
				form,
				headers,
				redirects: 'manual',
				signal: bound
			});
			this.#check(reply, path);
			this.token = nextToken(reply, this.token);
			return reply;
		});
	}

	/** Leaves through the logout link, after any request still running. */
	leave(signal?: AbortSignal): Promise<void> {
		return this.#run(signal, async (bound) => {
			const url = `${schoolUrl(this.account.school)}/login.php`;
			const reply = await this.transport.send({ url, redirects: 'manual', signal: bound });
			// A refused logout may leave the session alive, so it must not pass for success.
			if (!reply.location) ensureOk(reply.status, 'login.php');
		});
	}

	// Kurswahl flags an ended session with X-LOGIN-FORM on XHR and a redirect to login.php on pages.
	#check(reply: Reply, path: string): void {
		const toLogin = reply.location && /\/login\.php$|^\/?$/.test(reply.location.pathname);
		if (reply.headers.get('x-login-form') === 'true' || toLogin || isLoginPage(reply.text)) {
			throw fail('SESSION_EXPIRED', 'The Kurswahl session has ended.');
		}
		if (reply.location) throw layoutChanged(`${path} to answer without a redirect`);
		ensureOk(reply.status, path);
	}

	async #run<T>(
		signal: AbortSignal | undefined,
		work: (signal: AbortSignal) => Promise<T>
	): Promise<T> {
		this.ensureOpen();
		const life = this.#life.signal;
		const bound = signal ? AbortSignal.any([signal, life]) : life;
		try {
			return await this.#queue.run(() => work(bound), bound);
		} catch (error) {
			if (isRanzenError(error) || !bound.aborted) throw error;
			throw fail('ABORTED', 'Request aborted.', error);
		} finally {
			this.ensureOpen();
		}
	}
}

/** A token handed back in the XHR header, kept only if exported state would accept it. */
export function nextToken(reply: Reply, current: string | null): string | null {
	const token = reply.headers.get('x-csrf-token');
	return token && isToken(token) ? token : current;
}

/** The sign-in form, which Kurswahl serves in place of any page once the session is gone. */
export function isLoginPage(html: string): boolean {
	return /<input\b[^>]*\bname\s*=\s*["']?realpasswort\b/i.test(html);
}
