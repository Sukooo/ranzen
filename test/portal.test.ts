import { describe, expect, test } from 'bun:test';
import { createPortal, isRanzenError, type FailureCode, type RanzenError } from '../src/index.js';
import { seal } from '../src/protocol/cipher.js';
import { fakeFetch, portalRoutes, reply, type PortalScript, type Route } from './fake-portal.js';

const credentials = { schoolId: 1234, username: 'max.muster', password: 'geheim!pw' };

async function caught(work: Promise<unknown> | (() => unknown)): Promise<RanzenError> {
	try {
		await (typeof work === 'function' ? work() : work);
	} catch (error) {
		if (isRanzenError(error)) return error;
		throw error;
	}
	throw new Error('Expected a RanzenError');
}

async function failure(work: Promise<unknown> | (() => unknown)): Promise<FailureCode> {
	return (await caught(work)).code;
}

function portal(script: PortalScript = {}, ...extra: Route[]) {
	const fake = fakeFetch(...extra, portalRoutes(script));
	return { ...fake, portal: createPortal({ fetch: fake.fetch }) };
}

describe('login', () => {
	test('signs in with six requests and exports only the portal session', async () => {
		const { portal: p, sent } = portal();
		const connection = await p.login(credentials);

		expect(sent.map(({ method, url }) => `${method} ${url}`)).toEqual([
			'GET https://start.schulportal.hessen.de/',
			'POST https://login.schulportal.hessen.de/?i=1234',
			'GET https://connect.schulportal.hessen.de/',
			'GET https://start.schulportal.hessen.de/?t=bridge',
			'POST https://start.schulportal.hessen.de/ajax.php?f=rsaPublicKey',
			expect.stringMatching(
				/^POST https:\/\/start\.schulportal\.hessen\.de\/ajax\.php\?f=rsaHandshake&s=\d+$/
			)
		]);
		expect(new URLSearchParams(sent[1]?.body ?? '').get('user')).toBe('1234.max.muster');
		expect(sent[2]?.cookie).toContain('SPH-Login=gate');
		expect(sent[4]?.cookie).toBe('sid=session-1');
		expect(connection.account).toEqual({ schoolId: 1234, username: 'max.muster' });

		const state = JSON.parse(connection.exportState());
		expect(state.format).toBe('ranzen/connection@1');
		expect(state.cookies.map((c: { name: string }) => c.name)).toEqual(['sid']);
		expect(JSON.stringify(state)).not.toContain('geheim!pw');
	});

	test('maps rejected credentials and lockouts', async () => {
		expect(await failure(portal().portal.login({ ...credentials, password: 'nope' }))).toBe(
			'AUTH_FAILED'
		);
		const locked = await caught(
			portal({ lockText: ' 30 ' }).portal.login({ ...credentials, password: 'nope' })
		);
		expect(locked.failure).toEqual({ code: 'AUTH_LOCKED', lockoutSeconds: 30 });
	});

	test('blames the portal when the login page answers without a form result', async () => {
		const { portal: p } = portal({}, ({ url }) =>
			url.includes('login.') ? reply(404) : undefined
		);
		expect(await failure(p.login(credentials))).toBe('LAYOUT_CHANGED');
	});

	test('reports maintenance from the start page', async () => {
		const notice =
			'Der Bereich der pädagogischen Organisation steht Ihnen aktuell nicht zur Verfügung.';
		const { portal: p, sent } = portal({}, ({ url }) =>
			url === 'https://start.schulportal.hessen.de/' ? reply(200, notice) : undefined
		);
		expect(await failure(p.login(credentials))).toBe('MAINTENANCE');
		expect(sent).toHaveLength(1);
	});

	test('blames the portal, not the credentials or ranzen, when sign-in steps fail with 5xx', async () => {
		for (const failing of ['login.', 'connect.', 'ajax.php']) {
			const { portal: p } = portal({}, ({ url }) =>
				url.includes(failing) ? reply(502) : undefined
			);
			expect(await failure(p.login(credentials))).toBe('MAINTENANCE');
		}
	});

	test('rejects a challenge that does not echo the secret', async () => {
		const wrong = portal({ challenge: (secret) => seal(Buffer.alloc(secret.length), secret) });
		expect(await failure(wrong.portal.login(credentials))).toBe('HANDSHAKE_FAILED');
		const garbage = portal({}, ({ url }) =>
			url.includes('rsaPublicKey') ? reply(200, '<html>nope</html>') : undefined
		);
		expect(await failure(garbage.portal.login(credentials))).toBe('HANDSHAKE_FAILED');
	});

	test('keeps cookies from a redirecting start page out of the session', async () => {
		const { portal: p, sent } = portal({}, ({ url }) =>
			url === 'https://start.schulportal.hessen.de/'
				? reply(302, '', {
						location: 'https://login.schulportal.hessen.de/',
						'set-cookie': 'early=1; Path=/'
					})
				: undefined
		);
		const state = JSON.parse((await p.login(credentials)).exportState());
		expect(state.cookies.map((c: { name: string }) => c.name)).toEqual(['sid']);
		expect(sent).toHaveLength(6);
	});

	test('reports an unusable public key as a handshake failure', async () => {
		const { portal: p } = portal({}, ({ url }) =>
			url.includes('rsaPublicKey')
				? reply(200, JSON.stringify({ publickey: 'not a key' }))
				: undefined
		);
		expect(await failure(p.login(credentials))).toBe('HANDSHAKE_FAILED');
	});

	test('fails with LAYOUT_CHANGED when no session cookie arrives', async () => {
		const { portal: p } = portal({}, ({ url }) =>
			url.endsWith('?t=bridge') ? reply(302, '', { location: '/index.php' }) : undefined
		);
		expect(await failure(p.login(credentials))).toBe('LAYOUT_CHANGED');
	});
});

describe('connection state', () => {
	test('restores without requests and keeps the session alive', async () => {
		const first = portal();
		const state = (await first.portal.login(credentials)).exportState();

		const { fetch, sent } = fakeFetch(() => reply(200, 'ok'));
		const restored = createPortal({ fetch }).restore(state);
		expect(sent).toHaveLength(0);
		expect(restored.exportState()).toBe(state);

		await restored.keepAlive();
		expect(sent).toEqual([
			{
				method: 'POST',
				url: 'https://start.schulportal.hessen.de/ajax_login.php',
				cookie: 'sid=session-1',
				body: 'name=session-1'
			}
		]);
	});

	test('reports ended sessions from the keep-alive', async () => {
		const state = (await portal().portal.login(credentials)).exportState();
		for (const [status, code] of [
			[401, 'SESSION_EXPIRED'],
			[302, 'SESSION_EXPIRED'],
			[404, 'LAYOUT_CHANGED'],
			[500, 'MAINTENANCE']
		] as const) {
			const { fetch } = fakeFetch(() =>
				reply(status, '', { location: 'https://login.schulportal.hessen.de/' })
			);
			expect(await failure(createPortal({ fetch }).restore(state).keepAlive())).toBe(code);
		}
	});

	test('dispose cancels pending work and heartbeats never pile up', async () => {
		const state = (await portal().portal.login(credentials)).exportState();
		const { fetch, sent } = fakeFetch(() => Bun.sleep(15).then(() => reply(200)));
		const connection = createPortal({ fetch, maxConcurrency: 1 }).restore(state);
		connection.keepWarm(1);
		await Bun.sleep(50);
		const pending = connection.keepAlive();
		connection.dispose();
		const count = sent.length;
		expect(count).toBeGreaterThan(0);
		expect(await failure(pending)).toBe('DISPOSED');
		await Bun.sleep(50);
		expect(sent).toHaveLength(count);
	});

	test('keepWarm stops once the session has ended', async () => {
		const state = (await portal().portal.login(credentials)).exportState();
		const { fetch, sent } = fakeFetch(() => reply(401));
		const connection = createPortal({ fetch }).restore(state);
		connection.keepWarm(1);
		await Bun.sleep(50);
		expect(sent).toHaveLength(1);
		connection.dispose();
	});

	test('rejects malformed state', async () => {
		const { portal: p } = portal();
		const state = JSON.parse((await p.login(credentials)).exportState());
		const variants = [
			'not json',
			JSON.stringify({ ...state, format: 'ranzen/connection@0' }),
			JSON.stringify({ ...state, schoolId: '1234' }),
			JSON.stringify({ ...state, secret: 'c2hvcnQ=' }),
			JSON.stringify({ ...state, cookies: [{ name: 'sid', value: 1 }] }),
			JSON.stringify({
				...state,
				cookies: [{ ...state.cookies[0], value: 'session-1; injected=1' }]
			}),
			JSON.stringify({ ...state, cookies: [{ ...state.cookies[0], domain: 'a b' }] })
		];
		for (const text of variants) expect(await failure(() => p.restore(text))).toBe('INVALID_STATE');
		const thrown = await caught(() => p.restore('{"secret":"c2Vj'));
		expect([thrown.code, thrown.cause]).toEqual(['INVALID_STATE', undefined]);
	});

	test('logout disposes even when the request fails', async () => {
		const { portal: p } = portal({}, ({ url }) =>
			url.includes('logout') ? reply(503) : undefined
		);
		const connection = await p.login(credentials);
		expect(await failure(connection.logout())).toBe('MAINTENANCE');
		expect(await failure(() => connection.exportState())).toBe('DISPOSED');
		expect(await failure(connection.keepAlive())).toBe('DISPOSED');
	});

	test('blames the caller for invalid options', async () => {
		expect(await failure(() => createPortal({ maxConcurrency: 0 }))).toBe('INVALID_OPTION');
		expect(await failure(() => createPortal({ timeoutMs: 1.5 }))).toBe('INVALID_OPTION');
		const connection = await portal().portal.login(credentials);
		expect(await failure(() => connection.keepWarm(0))).toBe('INVALID_OPTION');
		connection.dispose();
		for (const wrong of [
			{ ...credentials, schoolId: 0 },
			{ ...credentials, username: '' },
			{ ...credentials, password: undefined as unknown as string }
		]) {
			expect(await failure(portal().portal.login(wrong))).toBe('INVALID_OPTION');
		}
	});
});
