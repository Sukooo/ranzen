import { describe, expect, test } from 'bun:test';
import { CookieJar, parseCookieDate } from '../src/transport/cookies.js';

const start = new URL('https://start.schulportal.hessen.de/meinunterricht.php');
const login = new URL('https://login.schulportal.hessen.de/');

describe('CookieJar', () => {
	test('shares domain cookies across subdomains but keeps host-only cookies local', () => {
		const jar = new CookieJar();
		jar.store('shared=1; Domain=.schulportal.hessen.de; Path=/', login);
		jar.store('local=2; Path=/', login);

		expect(jar.header(start)).toBe('shared=1');
		expect(jar.header(login)).toBe('shared=1; local=2');
	});

	test('rejects domains the response host does not belong to', () => {
		const jar = new CookieJar();
		jar.store('evil=1; Domain=example.com', start);
		jar.store('tld=1; Domain=de', start);
		expect(jar.header(new URL('https://example.com/'))).toBe('');
		expect(jar.header(start)).toBe('');
	});

	test('ignores names that could not be sent back verbatim', () => {
		const jar = new CookieJar();
		jar.store('bad name=1', start);
		jar.store('=2', start);
		jar.store('ok=a=b', start);
		expect(jar.header(start)).toBe('ok=a=b');
	});

	test('matches paths on segment boundaries and sends longer paths first', () => {
		const jar = new CookieJar();
		jar.store('root=1; Path=/', start);
		jar.store('deep=2; Path=/app', start);

		expect(jar.header(new URL('https://start.schulportal.hessen.de/app/x'))).toBe('deep=2; root=1');
		expect(jar.header(new URL('https://start.schulportal.hessen.de/apple'))).toBe('root=1');
	});

	test('defaults the path to the request directory', () => {
		const jar = new CookieJar();
		jar.store('dir=1', new URL('https://start.schulportal.hessen.de/a/b.php'));
		expect(jar.get(new URL('https://start.schulportal.hessen.de/a/c.php'), 'dir')).toBe('1');
		expect(jar.get(start, 'dir')).toBeUndefined();
	});

	test('only sends secure cookies over https', () => {
		const jar = new CookieJar();
		jar.store('token=1; Secure; Path=/', start);
		expect(jar.header(new URL('http://start.schulportal.hessen.de/'))).toBe('');
		expect(jar.header(start)).toBe('token=1');
	});

	test('expires cookies by Max-Age before Expires and deletes them on past dates', () => {
		let now = Date.UTC(2026, 0, 1);
		const jar = new CookieJar(() => now);
		jar.store('sid=1; Max-Age=60; Expires=Thu, 01 Jan 2099 00:00:00 GMT', start);
		jar.store('old=1; Expires=Thu, 01 Jan 2099 00:00:00 GMT', start);
		expect(jar.header(start)).toBe('sid=1; old=1');

		now += 61_000;
		expect(jar.get(start, 'sid')).toBeUndefined();

		jar.store('old=1; Max-Age=0', start);
		expect(jar.header(start)).toBe('');
	});

	test('replaces cookies with the same name, domain, and path in place', () => {
		const jar = new CookieJar();
		jar.store('a=1; Path=/', start);
		jar.store('b=2; Path=/', start);
		jar.store('a=3; Path=/; HttpOnly=1', start);
		expect(jar.header(start)).toBe('a=3; b=2');
	});

	test('round-trips live cookies through a snapshot', () => {
		let now = Date.UTC(2026, 0, 1);
		const jar = new CookieJar(() => now);
		jar.store('sid=1; Path=/; HttpOnly', start);
		jar.store('short=1; Max-Age=10', start);
		now += 20_000;

		const snapshot = jar.snapshot();
		expect(snapshot).toEqual([
			{
				name: 'sid',
				value: '1',
				domain: 'start.schulportal.hessen.de',
				hostOnly: true,
				path: '/',
				secure: false
			}
		]);
		expect(CookieJar.restore(snapshot).get(start, 'sid')).toBe('1');
	});

	test('parses cookie dates as UTC in every legacy format', () => {
		const newYear = Date.UTC(2027, 0, 1);
		expect(parseCookieDate('Fri, 01 Jan 2027 00:00:00 GMT')).toBe(newYear);
		expect(parseCookieDate('Friday, 01-Jan-27 00:00:00 GMT')).toBe(newYear);
		expect(parseCookieDate('Fri Jan  1 00:00:00 2027')).toBe(newYear);
		expect(parseCookieDate('Thu, 01 Jan 69 00:00:00 GMT')).toBe(Date.UTC(2069, 0, 1));
		expect(parseCookieDate('Thu, 01 Jan 70 00:00:00 GMT')).toBe(Date.UTC(1970, 0, 1));
		expect(parseCookieDate('Mon, 31 Feb 2027 00:00:00 GMT')).toBeUndefined();
		expect(parseCookieDate('morgen')).toBeUndefined();
	});
});
