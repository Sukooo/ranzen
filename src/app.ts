import { RanzenError, fail, layoutChanged } from './errors.js';
import { all, one, parseHtml, text, type Document } from './html.js';
import { PAGES } from './protocol/endpoints.js';
import type { Account, Session } from './session.js';
import type { Exchange } from './transport/http.js';

export interface PageRequest {
	/** Relative to the portal start page, e.g. 'meinunterricht.php'. */
	path: string;
	query?: Record<string, string>;
	form?: Record<string, string>;
	multipart?: FormData;
	/** Marks the request as the portal's own scripts do. */
	ajax?: boolean;
	signal?: AbortSignal | undefined;
}

export interface Page {
	url: URL;
	status: number;
	headers: Headers;
	text: string;
}

export interface Download {
	/** The portal's ASCII-safe name, e.g. "Uebung-1.pdf"; apps usually know the display name. */
	name: string | null;
	type: string | null;
	size: number | null;
	body: ReadableStream<Uint8Array>;
}

/** What an app sees of the connection: checked requests on behalf of one account. */
export interface AppContext {
	readonly account: Account;
	page(request: PageRequest): Promise<Page>;
	document(request: PageRequest): Promise<Document>;
	download(request: PageRequest): Promise<Download>;
	/** Reports a non-fatal mismatch with the portal, e.g. an unknown table column. */
	drift(detail: string): void;
}

/** A page the app could still read, but not completely; a hint that ranzen needs an update. */
export interface Drift {
	app: string;
	detail: string;
}

export interface AppInfo {
	readonly id: string;
	/** The portal page behind the app, as listed in the catalog, e.g. 'meinunterricht.php'. */
	readonly page: string | null;
}

export interface App<Api> extends AppInfo {
	create(context: AppContext): Api;
}

/** Apps are stateless definitions; Connection.open() binds one to a session. */
export function defineApp<Api>(info: AppInfo, create: (context: AppContext) => Api): App<Api> {
	return Object.freeze({ ...info, create });
}

// Live pages break the line inside the title, e.g. "<title>\n\t\tFehler - Schulportal Hessen".
const ERROR_TITLE = /<title>\s*Fehler\b/;

export function createContext(session: Session, drift: (detail: string) => void): AppContext {
	const context: AppContext = {
		get account() {
			return session.account;
		},
		drift,
		async page(request) {
			const exchange = toExchange(request);
			const reply = await session.send(exchange);
			ensureStayed(reply.url, exchange.url);
			ensureOk(reply.status, exchange.url.pathname);
			if (ERROR_TITLE.test(reply.text)) throw portalError(parseHtml(reply.text));
			return { url: reply.url, status: reply.status, headers: reply.headers, text: reply.text };
		},
		async document(request) {
			return parseHtml((await context.page(request)).text);
		},
		async download(request) {
			const exchange = toExchange(request);
			const reply = await session.stream(exchange);
			if (
				reply.url.pathname !== exchange.url.pathname ||
				reply.status < 200 ||
				reply.status >= 300
			) {
				reply.body.cancel().catch(() => {});
				ensureStayed(reply.url, exchange.url);
				// Unlike pages, downloads answer a missing file with the same 404 as a missing script.
				if (reply.status === 404) throw fail('NOT_FOUND', 'The portal has no such file.');
				ensureOk(reply.status, exchange.url.pathname);
			}
			// Real files always carry a disposition; anything else is an error page.
			const disposition = reply.headers.get('content-disposition');
			if (!disposition) {
				const page = await new Response(reply.body).text();
				if (ERROR_TITLE.test(page)) throw portalError(parseHtml(page));
				throw layoutChanged(`a file from ${exchange.url.pathname}, not a page`);
			}
			// fetch decodes compressed bodies, so their length is not the file's.
			const length = reply.headers.has('content-encoding')
				? NaN
				: Number(reply.headers.get('content-length') ?? NaN);
			return {
				name: fileName(disposition),
				type: reply.headers.get('content-type'),
				size: Number.isSafeInteger(length) ? length : null,
				body: reply.body
			};
		}
	};
	return context;
}

function toExchange({ path, query, form, multipart, ajax, signal }: PageRequest): Exchange & {
	url: URL;
} {
	const url = new URL(path, PAGES.start);
	if (url.origin !== new URL(PAGES.start).origin) {
		throw fail('INVALID_OPTION', 'App pages must be relative to the portal start page.');
	}
	return {
		url,
		method: form || multipart ? 'POST' : 'GET',
		...(query && { query }),
		...(form && { form }),
		...(multipart && { multipart }),
		...(ajax && { headers: { 'x-requested-with': 'XMLHttpRequest' } }),
		signal
	};
}

// Without a session, app pages bounce to the start or forward page.
function ensureStayed(reached: URL, requested: URL): void {
	if (reached.pathname !== requested.pathname) {
		throw fail('SESSION_EXPIRED', 'The portal session has ended.');
	}
}

/**
 * The transport already turned 5xx into MAINTENANCE. Unknown records get a 200 error page,
 * so any other 4xx means the portal moved a script ranzen relies on.
 */
export function ensureOk(status: number, path: string): void {
	if (status >= 200 && status < 300) return;
	if (status === 401) throw fail('SESSION_EXPIRED', 'The portal session has ended.');
	if (status === 403) throw fail('FORBIDDEN', `The portal refused ${path}.`);
	throw layoutChanged(`${path} to exist, not HTTP ${status}`);
}

function portalError(document: Document): RanzenError {
	const notice = all('.error-wrapper .jumbotron p:not(.lead)', document)
		.map((paragraph) => text(paragraph))
		.join(' ');
	if (notice.includes('Datenbankauswahl')) {
		return fail('SESSION_EXPIRED', 'The portal session has ended.');
	}
	if (notice.includes('nicht freigeschaltet')) {
		return fail('FORBIDDEN', 'This account cannot use the requested app.');
	}
	if (!notice && !one('.error-wrapper', document)) {
		return layoutChanged('a known error page');
	}
	return new RanzenError({ code: 'PORTAL_ERROR', notice }, 'The portal reported an error.');
}

function fileName(disposition: string): string | null {
	const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
	if (encoded) {
		try {
			return decodeURIComponent(encoded.trim());
		} catch {
			return null;
		}
	}
	return /filename="([^"]*)"/i.exec(disposition)?.[1] ?? null;
}
