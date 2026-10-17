export interface StoredCookie {
	name: string;
	value: string;
	domain: string;
	hostOnly: boolean;
	path: string;
	secure: boolean;
	expires?: number;
}

// Rejects what would change the Cookie header it is sent in, such as ";" or line breaks.
export function isCookiePair(name: string, value: string): boolean {
	return /^[^\s;=\x00-\x1f\x7f]+$/.test(name) && /^[^;\x00-\x1f\x7f]*$/.test(value);
}

// Minimal RFC 6265 jar: enough for Schulportal's few session cookies, no public suffix list.
export class CookieJar {
	private cookies = new Map<string, StoredCookie>();

	constructor(private readonly now: () => number = Date.now) {}

	store(header: string, url: URL): void {
		const [pair = '', ...attributes] = header.split(';');
		const separator = pair.indexOf('=');
		const name = pair.slice(0, separator).trim();
		const value = pair.slice(separator + 1).trim();
		if (separator < 1 || !isCookiePair(name, value)) return;

		const cookie: StoredCookie = {
			name,
			value,
			domain: url.hostname,
			hostOnly: true,
			path: defaultPath(url.pathname),
			secure: false
		};
		let maxAge: number | undefined;
		for (const attribute of attributes) {
			const index = attribute.indexOf('=');
			const key = (index < 0 ? attribute : attribute.slice(0, index)).trim().toLowerCase();
			const value = index < 0 ? '' : attribute.slice(index + 1).trim();
			if (key === 'domain' && value) {
				const domain = value.replace(/^\./, '').toLowerCase();
				if (!domainMatches(url.hostname, domain) || !domain.includes('.')) return;
				cookie.domain = domain;
				cookie.hostOnly = false;
			} else if (key === 'path' && value.startsWith('/')) cookie.path = value;
			else if (key === 'secure') cookie.secure = true;
			else if (key === 'max-age' && /^-?\d+$/.test(value)) maxAge = Number(value);
			else if (key === 'expires') {
				const expires = parseCookieDate(value);
				if (expires !== undefined) cookie.expires = expires;
			}
		}
		if (maxAge !== undefined) cookie.expires = this.now() + maxAge * 1000;

		const key = `${cookie.domain};${cookie.path};${cookie.name}`;
		if (cookie.expires !== undefined && cookie.expires <= this.now()) this.cookies.delete(key);
		else this.cookies.set(key, cookie);
	}

	get(url: URL, name: string): string | undefined {
		return this.matching(url).find((cookie) => cookie.name === name)?.value;
	}

	header(url: URL): string {
		return this.matching(url)
			.map((cookie) => `${cookie.name}=${cookie.value}`)
			.join('; ');
	}

	clear(): void {
		this.cookies.clear();
	}

	snapshot(): StoredCookie[] {
		return this.live().map((cookie) => ({ ...cookie }));
	}

	static restore(cookies: readonly StoredCookie[], now?: () => number): CookieJar {
		const jar = new CookieJar(now);
		for (const cookie of cookies) {
			jar.cookies.set(`${cookie.domain};${cookie.path};${cookie.name}`, { ...cookie });
		}
		return jar;
	}

	private live(): StoredCookie[] {
		const now = this.now();
		return [...this.cookies.values()].filter(
			(cookie) => cookie.expires === undefined || cookie.expires > now
		);
	}

	private matching(url: URL): StoredCookie[] {
		const host = url.hostname;
		return this.live()
			.filter(
				(cookie) =>
					(cookie.hostOnly ? host === cookie.domain : domainMatches(host, cookie.domain)) &&
					pathMatches(url.pathname, cookie.path) &&
					(!cookie.secure || url.protocol === 'https:')
			)
			.sort((a, b) => b.path.length - a.path.length);
	}
}

function domainMatches(host: string, domain: string): boolean {
	return host === domain || host.endsWith(`.${domain}`);
}

function pathMatches(requestPath: string, cookiePath: string): boolean {
	if (requestPath === cookiePath) return true;
	if (!requestPath.startsWith(cookiePath)) return false;
	return cookiePath.endsWith('/') || requestPath[cookiePath.length] === '/';
}

function defaultPath(pathname: string): string {
	const index = pathname.lastIndexOf('/');
	return index > 0 ? pathname.slice(0, index) : '/';
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// RFC 6265 §5.1.1: always UTC, two-digit years map to 1970–2069.
export function parseCookieDate(value: string): number | undefined {
	let time: number[] | undefined;
	let day: number | undefined;
	let month: number | undefined;
	let year: number | undefined;
	for (const token of value.split(/[\x09\x20-\x2f\x3b-\x40\x5b-\x60\x7b-\x7e]+/)) {
		const clock = /^(\d{1,2}):(\d{1,2}):(\d{1,2})(?!\d)/.exec(token);
		if (!time && clock) time = clock.slice(1).map(Number);
		else if (day === undefined && /^\d{1,2}(?!\d)/.test(token)) day = parseInt(token, 10);
		else if (month === undefined && MONTHS.includes(token.slice(0, 3).toLowerCase())) {
			month = MONTHS.indexOf(token.slice(0, 3).toLowerCase());
		} else if (year === undefined && /^\d{2,4}(?!\d)/.test(token)) year = parseInt(token, 10);
	}
	if (!time || day === undefined || month === undefined || year === undefined) return undefined;
	if (year < 100) year += year < 70 ? 2000 : 1900;
	const [hours = 0, minutes = 0, seconds = 0] = time;
	if (year < 1601 || hours > 23 || minutes > 59 || seconds > 59) return undefined;
	const date = Date.UTC(year, month, day, hours, minutes, seconds);
	return new Date(date).getUTCDate() === day ? date : undefined;
}
