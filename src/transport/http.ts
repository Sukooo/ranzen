import { RanzenError, fail, layoutChanged } from '../errors.js';
import { CookieJar } from './cookies.js';
import { Limiter } from './limiter.js';

export type FetchFunction = (url: string, init: RequestInit) => Promise<Response>;

export interface TransportSettings {
	fetch: FetchFunction;
	userAgent: string;
	timeoutMs: number;
	maxConcurrency: number;
	/** Hosts requests may reach over https; defaults to Schulportal's. */
	hosts?: ReadonlySet<string>;
}

export interface Exchange {
	url: string | URL;
	method?: 'GET' | 'POST';
	query?: Record<string, string>;
	form?: Record<string, string>;
	multipart?: FormData;
	headers?: Record<string, string>;
	redirects?: 'follow' | 'manual';
	signal?: AbortSignal | undefined;
}

interface Head {
	status: number;
	url: URL;
	location: URL | null;
	headers: Headers;
}

export interface Reply extends Head {
	text: string;
}

export interface StreamReply extends Head {
	body: ReadableStream<Uint8Array>;
}

// The hosts sign-in and apps use; any other host, subdomain or port is a portal change.
export const PORTAL_HOSTS: ReadonlySet<string> = new Set(
	['start', 'login', 'connect'].map((name) => `${name}.schulportal.hessen.de`)
);
const MAX_REDIRECTS = 10;

export class Transport {
	constructor(
		private readonly settings: TransportSettings,
		readonly jar = new CookieJar(),
		private readonly limiter = new Limiter(settings.maxConcurrency)
	) {}

	// Same fetch and slots, separate cookies.
	fork(): Transport {
		return new Transport(this.settings, new CookieJar(), this.limiter);
	}

	send(exchange: Exchange): Promise<Reply> {
		return this.guard(exchange.signal, async (signal) => {
			const { response, ...head } = await this.walk(exchange, signal);
			return { ...head, text: await readText(response, signal) };
		});
	}

	// The slot frees once headers arrive; timeoutMs then bounds the wait for each body chunk.
	stream(exchange: Exchange): Promise<StreamReply> {
		const caller = exchange.signal;
		return this.guard(caller, async (signal) => {
			const { response, ...head } = await this.walk(exchange, signal);
			const body = response.body ?? new ReadableStream<Uint8Array>({ start: (c) => c.close() });
			return { ...head, body: this.chunked(body, caller) };
		});
	}

	private async guard<T>(
		caller: AbortSignal | undefined,
		work: (signal: AbortSignal) => Promise<T>
	): Promise<T> {
		try {
			return await this.limiter.run(() => this.deadline(caller, work), caller);
		} catch (error) {
			throw this.failure(error, caller);
		}
	}

	// A ref'd timer: Bun's AbortSignal.timeout can stall while a body read is pending.
	private async deadline<T>(
		caller: AbortSignal | undefined,
		work: (signal: AbortSignal) => Promise<T>
	): Promise<T> {
		const { timeoutMs } = this.settings;
		const deadline = new AbortController();
		const timer = setTimeout(
			() => deadline.abort(new DOMException('Timed out', 'TimeoutError')),
			timeoutMs
		);
		const signal = caller ? AbortSignal.any([caller, deadline.signal]) : deadline.signal;
		try {
			return await work(signal);
		} catch (error) {
			if (deadline.signal.aborted && !caller?.aborted) {
				throw fail('TIMEOUT', `Request timed out after ${timeoutMs}ms.`, error);
			}
			throw error;
		} finally {
			clearTimeout(timer);
		}
	}

	private failure(error: unknown, caller: AbortSignal | undefined): RanzenError {
		if (error instanceof RanzenError) return error;
		if (caller?.aborted) return fail('ABORTED', 'Request aborted.', error);
		return fail('NETWORK', 'Request failed.', error);
	}

	// An abort cancels the source at once, even while nobody pulls a buffered stream.
	private chunked(
		body: ReadableStream<Uint8Array>,
		caller: AbortSignal | undefined
	): ReadableStream<Uint8Array> {
		const reader = body.getReader();
		let detach = () => {};
		const stop = (controller: ReadableStreamDefaultController<Uint8Array>, error: unknown) => {
			detach();
			reader.cancel().catch(() => {});
			controller.error(this.failure(error, caller));
		};
		return new ReadableStream<Uint8Array>({
			start: (controller) => {
				if (!caller) return;
				const abort = () => stop(controller, caller.reason);
				if (caller.aborted) return abort();
				caller.addEventListener('abort', abort, { once: true });
				detach = () => caller.removeEventListener('abort', abort);
			},
			pull: async (controller) => {
				try {
					const chunk = await this.deadline(caller, (signal) => abortable(reader.read(), signal));
					if (chunk.done) {
						detach();
						controller.close();
					} else controller.enqueue(chunk.value);
				} catch (error) {
					stop(controller, error);
				}
			},
			cancel: (reason) => {
				detach();
				return reader.cancel(reason);
			}
		});
	}

	private async walk(
		exchange: Exchange,
		signal: AbortSignal
	): Promise<Head & { response: Response }> {
		let url = new URL(exchange.url);
		for (const [key, value] of Object.entries(exchange.query ?? {})) {
			url.searchParams.set(key, value);
		}
		let method = exchange.method ?? 'GET';
		let body: string | FormData | undefined =
			exchange.multipart ?? (exchange.form && new URLSearchParams(exchange.form).toString());

		for (let hop = 0; ; hop++) {
			if (url.protocol !== 'https:' || !(this.settings.hosts ?? PORTAL_HOSTS).has(url.host)) {
				throw layoutChanged('a portal address');
			}
			const headers = new Headers(exchange.headers);
			headers.set('user-agent', this.settings.userAgent);
			const cookie = this.jar.header(url);
			if (cookie) headers.set('cookie', cookie);
			if (typeof body === 'string' && !headers.has('content-type')) {
				headers.set('content-type', 'application/x-www-form-urlencoded');
			}

			const pending = this.settings.fetch(url.href, {
				method,
				headers,
				body: body ?? null,
				redirect: 'manual',
				signal
			});
			const response = await abortable(pending, signal).catch((error: unknown) => {
				pending.then(discard, () => {});
				throw error;
			});
			for (const header of response.headers.getSetCookie()) this.jar.store(header, url);

			const location = response.headers.get('location');
			const target = location ? URL.parse(location, url.href) : null;
			if (location && !target) throw layoutChanged('a valid redirect address');
			if (target && exchange.redirects !== 'manual' && isRedirect(response.status)) {
				discard(response);
				if (hop >= MAX_REDIRECTS) throw layoutChanged(`at most ${MAX_REDIRECTS} redirects`);
				if (response.status !== 307 && response.status !== 308) {
					method = 'GET';
					body = undefined;
				}
				url = target;
				continue;
			}

			// Checked before any protocol step reads the body, so an outage is never blamed on ranzen.
			if (response.status >= 500) {
				discard(response);
				throw fail('MAINTENANCE', `The portal is unavailable (HTTP ${response.status}).`);
			}
			if (response.status === 429) {
				discard(response);
				const retryAfter = response.headers.get('retry-after')?.trim() ?? '';
				throw new RanzenError(
					{
						code: 'RATE_LIMITED',
						retryAfterSeconds: /^\d+$/.test(retryAfter) ? Number(retryAfter) : null
					},
					'The portal is rate limiting requests.'
				);
			}
			return {
				status: response.status,
				url,
				location: target,
				headers: response.headers,
				response
			};
		}
	}
}

// Settles on abort even when an injected fetch or its body stream ignores the signal.
// The work is always observed, so its own late rejection never goes unhandled.
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const abort = () => reject(signal.reason);
		if (signal.aborted) abort();
		else signal.addEventListener('abort', abort, { once: true });
		work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
	});
}

// Reads the body itself, so an abort can cancel it; response.text() would hold the lock.
async function readText(response: Response, signal: AbortSignal): Promise<string> {
	if (!response.body) return '';
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	const parts: string[] = [];
	try {
		for (;;) {
			const { done, value } = await abortable(reader.read(), signal);
			if (done) return parts.join('') + decoder.decode();
			parts.push(decoder.decode(value, { stream: true }));
		}
	} catch (error) {
		reader.cancel().catch(() => {});
		throw error;
	}
}

function discard(response: Response): void {
	response.body?.cancel().catch(() => {});
}

function isRedirect(status: number): boolean {
	return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}
