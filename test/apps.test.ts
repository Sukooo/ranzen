import { beforeAll, describe, expect, test } from 'bun:test';
import { catalog } from '../src/apps/catalog/index.js';
import { lessons } from '../src/apps/lessons/index.js';
import { profile } from '../src/apps/profile/index.js';
import { substitutions } from '../src/apps/substitutions/index.js';
import {
	createPortal,
	defineApp,
	isRanzenError,
	type Drift,
	type PortalOptions,
	type RanzenError
} from '../src/index.js';
import { fakeFetch, portalRoutes, reply, type Route } from './fake-portal.js';

const START = 'https://start.schulportal.hessen.de/';
let state: string;

beforeAll(async () => {
	const { fetch } = fakeFetch(portalRoutes());
	state = (
		await createPortal({ fetch }).login({ schoolId: 1234, username: 'max', password: 'geheim!pw' })
	).exportState();
});

const chunk = new TextEncoder().encode('<html>');

function connectWith(options: PortalOptions, ...routes: Route[]) {
	const fake = fakeFetch(...routes);
	return { ...fake, connection: createPortal({ ...options, fetch: fake.fetch }).restore(state) };
}

function connect(...routes: Route[]) {
	return connectWith({}, ...routes);
}

async function caught(work: Promise<unknown>): Promise<RanzenError> {
	try {
		await work;
	} catch (error) {
		if (isRanzenError(error)) return error;
		throw error;
	}
	throw new Error('Expected a RanzenError');
}

function errorPage(notice: string) {
	return `<html><head><title>
		Fehler - Schulportal Hessen</title></head><body>
		<div class="error-wrapper"><div class="jumbotron"><p class="lead">Fehler</p><p>${notice}</p></div></div>`;
}

// Hands tests the raw context, the way any third-party app sees it.
const raw = defineApp({ id: 'raw', page: null }, (context) => context);

describe('open', () => {
	test('binds apps lazily and once per connection', () => {
		const { connection, sent } = connect();
		expect(connection.open(lessons)).toBe(connection.open(lessons));
		expect(connection.open(profile)).not.toBe(connect().connection.open(profile));
		expect(sent).toHaveLength(0);
	});

	test('reports drift once per kind with the app, even if the hook throws', async () => {
		const seen: Drift[] = [];
		const onDrift = (drift: Drift) => {
			seen.push(drift);
			throw new Error('log down');
		};
		const { connection } = connectWith({ onDrift }, () =>
			reply(200, '<html><div id="content"><table></table></div></html>')
		);
		const api = connection.open(profile);
		await api.get();
		await api.get();
		expect(seen).toEqual([{ app: 'profile', detail: 'The navbar shows no known role icon.' }]);
	});

	test('refuses disposed connections', () => {
		const { connection } = connect();
		connection.dispose();
		expect(() => connection.open(lessons)).toThrow('disposed');
	});
});

describe('app context', () => {
	test('keeps queries and page content out of errors', async () => {
		const { connection } = connect(({ url }) =>
			url.includes('nachrichten') ? reply(404) : reply(200, '{"name":"Max Muster"')
		);
		const missing = await caught(
			connection.open(raw).page({ path: 'nachrichten.php?an=max.muster' })
		);
		expect(missing.message).not.toContain('max.muster');
		const broken = await caught(connection.open(catalog).list());
		expect([broken.code, broken.cause]).toEqual(['LAYOUT_CHANGED', undefined]);
	});

	test('classifies portal error pages', async () => {
		const cases: [() => Response, RanzenError['code']][] = [
			[() => reply(302, '', { location: '/index.php' }), 'SESSION_EXPIRED'],
			[() => reply(200, errorPage('Datenbankauswahl nicht möglich')), 'SESSION_EXPIRED'],
			[
				() => reply(200, errorPage('Die Funktion ist für diesen Account nicht freigeschaltet.')),
				'FORBIDDEN'
			],
			[() => reply(404, '<html>Nicht gefunden</html>'), 'LAYOUT_CHANGED'],
			[() => reply(403, ''), 'FORBIDDEN'],
			[() => reply(401, ''), 'SESSION_EXPIRED'],
			[() => reply(500, '<html>Interner Fehler</html>'), 'MAINTENANCE'],
			[
				() => reply(200, '<html><head><title>\nFehler</title></head><body>?</body></html>'),
				'LAYOUT_CHANGED'
			]
		];
		for (const [respond, code] of cases) {
			const { connection } = connect(({ url }) =>
				url.includes('meinunterricht') ? respond() : reply(200, '<html></html>')
			);
			expect((await caught(connection.open(raw).page({ path: 'meinunterricht.php' }))).code).toBe(
				code
			);
		}
	});

	test('passes other portal notices on', async () => {
		const { connection } = connect(() => reply(200, errorPage('Der Kurs ist archiviert.')));
		const error = await caught(connection.open(raw).page({ path: 'meinunterricht.php' }));
		expect(error.failure).toEqual({ code: 'PORTAL_ERROR', notice: 'Der Kurs ist archiviert.' });
	});

	test('keeps requests on the portal', async () => {
		const { connection } = connect();
		const error = await caught(connection.open(raw).page({ path: 'https://example.com/' }));
		expect([error.code, error.fault]).toEqual(['INVALID_OPTION', 'caller']);
	});

	test('streams downloads with their file name', async () => {
		const { connection, sent } = connect(({ url }) =>
			url.includes('b=zip')
				? reply(200, 'zip', {
						'content-disposition': "inline; filename*=UTF-8''%C3%9Cbung%201.zip",
						'content-length': '3'
					})
				: reply(200, 'pdf', { 'content-disposition': 'attachment; filename="Blatt 1.pdf"' })
		);
		const api = connection.open(lessons);
		const file = await api.download({ course: '101', entry: '55', file: 'Blatt 1.pdf' });
		expect(file.name).toBe('Blatt 1.pdf');
		expect(await new Response(file.body).text()).toBe('pdf');
		const zip = await api.downloadAll({ course: '101', entry: '55' });
		expect([zip.name, zip.size]).toEqual(['Übung 1.zip', 3]);
		await zip.body.cancel();
		expect(new URL(sent[0]!.url).searchParams.get('f')).toBe('Blatt 1.pdf');
	});

	test('reads error pages served instead of files', async () => {
		const expired = connect(() => reply(200, errorPage('Datenbankauswahl nicht möglich')));
		const target = { course: '101', entry: '55', file: 'a.pdf' };
		expect((await caught(expired.connection.open(lessons).download(target))).code).toBe(
			'SESSION_EXPIRED'
		);
		const missing = connect(() => reply(404, '<html></html>'));
		expect((await caught(missing.connection.open(lessons).download(target))).code).toBe(
			'NOT_FOUND'
		);
	});

	test('keeps the cause when an error page stalls or is aborted', async () => {
		const target = { course: '101', entry: '55', file: 'a.pdf' };
		const stalled = () => new Response(new ReadableStream({ start: (c) => c.enqueue(chunk) }));
		const slow = connectWith({ timeoutMs: 30 }, stalled);
		expect((await caught(slow.connection.open(lessons).download(target))).code).toBe('TIMEOUT');

		const controller = new AbortController();
		const pending = connect(stalled).connection.open(lessons).download(target, controller);
		setTimeout(() => controller.abort(), 10);
		expect((await caught(pending)).code).toBe('ABORTED');
	});

	test('stops streaming once aborted', async () => {
		const controller = new AbortController();
		const endless = new ReadableStream({ pull: (stream) => stream.enqueue(chunk) });
		const { connection } = connect(
			() => new Response(endless, { headers: { 'content-disposition': 'attachment' } })
		);
		const file = await connection
			.open(lessons)
			.download({ course: '1', entry: '1', file: 'a.txt' }, controller);
		const reader = file.body.getReader();
		await reader.read();
		controller.abort();
		const drain = async () => {
			for (;;) await reader.read();
		};
		expect((await caught(drain())).code).toBe('ABORTED');
	});
});

describe('app requests', () => {
	test('marks homework done and reports refusals', async () => {
		const { connection, sent } = connect(({ body }) =>
			reply(200, body?.includes('entry=55') ? '1' : '0')
		);
		const api = connection.open(lessons);
		await api.setHomeworkDone({ course: '101', entry: '55', done: true });
		expect(sent[0]?.method).toBe('POST');
		expect(Object.fromEntries(new URLSearchParams(sent[0]?.body ?? ''))).toEqual({
			a: 'sus_homeworkDone',
			id: '101',
			entry: '55',
			b: 'done'
		});
		const error = await caught(api.setHomeworkDone({ course: '101', entry: '56', done: false }));
		expect(error.code).toBe('PORTAL_ERROR');
	});

	test('loads the full substitution plan per day', async () => {
		const plan = `<div class="panel" id="tag19_10_2026"></div><div class="panel" id="tag20_10_2026"></div>`;
		const { connection, sent } = connect(({ method, body }) => {
			if (method === 'GET') return reply(200, plan);
			const day = new URLSearchParams(body ?? '').get('tag');
			return reply(200, JSON.stringify([{ Tag: day, Stunde: '1', Raum: '101' }]));
		});
		const days = await connection.open(substitutions).plan({ full: true });
		expect(days.map((day) => day.substitutions[0]?.date)).toEqual(['2026-10-19', '2026-10-20']);
		expect(sent.slice(1).map(({ url }) => url)).toEqual([
			`${START}vertretungsplan.php?a=my`,
			`${START}vertretungsplan.php?a=my`
		]);
	});

	test('checks which apps the school offers', async () => {
		const { connection } = connect(() =>
			reply(
				200,
				JSON.stringify({
					error: '0',
					entrys: [{ Name: 'Mein Unterricht', link: 'meinunterricht.php' }]
				})
			)
		);
		const apps = connection.open(catalog);
		expect(await apps.offers(lessons)).toBe(true);
		expect(await apps.offers(substitutions)).toBe(false);
		expect(await apps.offers(profile)).toBe(true);
	});
});
