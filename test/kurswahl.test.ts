import { describe, expect, test } from 'bun:test';
import { argon2id } from 'hash-wasm';
import { createKurswahl } from '../src/kurswahl/index.js';
import { csrfToken, parseTimetable } from '../src/kurswahl/parse.js';
import { argon2 } from '../src/kurswahl/sign-in.js';
import type { FetchFunction } from '../src/transport/http.js';
import type { FailureCode } from '../src/index.js';
import { driftLog, failureCode } from './failure.js';

const rejects = (work: Promise<unknown>, code: FailureCode) =>
	expect(work).rejects.toMatchObject({ code });

const BASE = 'https://demo.kurswahl-online.de';
const ARGS = {
	salt: 'saltsalt',
	iterations: 1,
	memorySize: 64,
	parallelism: 1,
	hashLength: 16,
	outputType: 'hex'
} as const;
const PARAMS = { type: 2, time: 1, mem: 64, parallelism: 1, hashLen: 16 } as const;

const page = (token: string, body: string) =>
	`<html><head><meta name="anti_csrf_token" content="${token}"></head><body>${body}</body></html>`;

const entry = (tooltip: string, label: string, shown: string, lk = false) =>
	`<div class="kurs${lk ? ' lk' : ''}" tooltip="${tooltip.replaceAll('<', '&lt;').replaceAll('>', '&gt;')}">${label}<span>${shown}</span></div>`;

const TIMETABLE = `
<form><input type="hidden" name="db_name" value="demo_stundenplan_1">
<select name="woche">
	<option value="0">Allgemeiner Plan</option>
	<option value="18_08_2025">18.08.2025 - 22.08.2025</option>
	<option value="25_08_2025" selected>25.08.2025 - 29.08.2025</option>
</select></form>
<table class="stundenplan">
	<tr><th></th><th>Montag</th><th>Dienstag</th></tr>
	<tr><td>1. 07:45 - 08:30</td>
		<td>${entry('<b>Leiste 1: LK 1:  MATHEMATIK bei Muster, Frau<br>Raum: 101</b><br>Realkurs: 7', '1: LK 1:  M-LK (Mu)', '101', true)}</td>
		<td></td></tr>
	<tr><td>2. 08:30 - 09:15</td>
		<td>${entry('<b>Leiste 3: GK Chemie bei Beispiel, Herr<br>Raum: 202, Woche: A</b><br>Realkurs: 9', '3: CH (Bsp)', '202 [A]')}${entry('<b>Leiste 4: Kunst bei Probe<br>Raum: 203, Woche: B</b><br>Realkurs: 11', '4: KU-GK (Pr)', '203 [B]')}</td>
		<td>${entry('<b>Leiste 1: LK 1:  MATHEMATIK bei Muster, Frau<br>Raum: 102</b><br>Realkurs: 7', '1: LK 1:  M-LK (Mu)', '102', true)}</td></tr>
</table>
<table><tr><td>Letzte Änderung Stundenplan (Kurszuteilung):</td><td>27.08.25  12:12:51 (25.08.25  09:02:04)</td></tr></table>`;

// As verified live: the general plan selects option "0"; the default view selects nothing and
// shows only the current week's rotation.
const GENERAL = TIMETABLE.replace(' selected', '').replace('value="0"', 'value="0" selected');
const DATED = TIMETABLE.replace(/<div[^>]*Realkurs: 11[^>]*>.*?<\/div>/s, '');
const CURRENT = DATED.replace(' selected', '');

describe('parseTimetable', () => {
	test('reads courses, teachers, rotations and weeks', () => {
		const { drift, details } = driftLog();
		const timetable = parseTimetable(page('t', TIMETABLE), drift);

		expect(details).toEqual([]);
		expect(timetable.database).toBe('demo_stundenplan_1');
		expect(timetable.week).toEqual({ id: '25_08_2025', start: '2025-08-25', end: '2025-08-29' });
		expect(timetable.weeks).toHaveLength(2);
		expect(timetable.periods).toEqual([
			{ period: 1, start: '07:45', end: '08:30' },
			{ period: 2, start: '08:30', end: '09:15' }
		]);
		expect(timetable.courses).toEqual([
			{
				id: '7',
				block: 1,
				code: 'M-LK',
				title: 'MATHEMATIK',
				level: 'LK',
				teacher: { code: 'Mu', lastName: 'Muster', salutation: 'Frau' }
			},
			{
				id: '9',
				block: 3,
				code: 'CH',
				title: 'Chemie',
				level: 'GK',
				teacher: { code: 'Bsp', lastName: 'Beispiel', salutation: 'Herr' }
			},
			{
				id: '11',
				block: 4,
				code: 'KU-GK',
				title: 'Kunst',
				level: 'GK',
				teacher: { code: 'Pr', lastName: 'Probe', salutation: null }
			}
		]);
		expect(timetable.lessons).toEqual([
			{ course: '7', day: 1, period: 1, room: '101', rotation: null },
			{ course: '9', day: 1, period: 2, room: '202', rotation: 'A' },
			{ course: '11', day: 1, period: 2, room: '203', rotation: 'B' },
			{ course: '7', day: 2, period: 2, room: '102', rotation: null }
		]);
		expect(timetable.updatedAt).toBe('2025-08-27T12:12:51');
		expect(timetable.assignedAt).toBe('2025-08-25T09:02:04');
	});

	test('fails loudly on cells it cannot read', () => {
		const broken = TIMETABLE.replace('Realkurs: 9', 'Kurs: 9');
		expect(failureCode(() => parseTimetable(page('t', broken), () => {}))).toBe('LAYOUT_CHANGED');
	});

	test('never reads an unreadable selected week as the general plan', () => {
		const odd = TIMETABLE.replace(
			'<option value="25_08_2025" selected>',
			'<option value="KW35" selected>'
		);
		expect(failureCode(() => parseTimetable(page('t', odd), () => {}))).toBe('LAYOUT_CHANGED');
	});

	test('accepts the tokens that exported state accepts', () => {
		expect(csrfToken(page('abc+/=', ''))).toBe('abc+/=');
		expect(csrfToken(page('a b', ''))).toBeNull();
	});
});

describe('argon2', () => {
	test('cuts UTF-8 input to the string length, as the browser worker does', async () => {
		// "äx" is two characters but three UTF-8 bytes; the browser hashes only "ä".
		const expected = await argon2id({ ...ARGS, password: 'ä' });
		expect(await argon2('äx', 'saltsalt', PARAMS)).toBe(expected);
		// A lone "ä" keeps only its first byte, cutting the UTF-8 sequence in half.
		const half = await argon2id({ ...ARGS, password: new Uint8Array([0xc3]) });
		expect(await argon2('ä', 'saltsalt', PARAMS)).toBe(half);
	});

	test('reports parameters hash-wasm cannot use as a layout change', async () => {
		await rejects(argon2('x', 'saltsalt', { ...PARAMS, mem: 1 }), 'LAYOUT_CHANGED');
		await rejects(argon2('x', 'short', PARAMS), 'LAYOUT_CHANGED');
	});
});

interface Request {
	method: string;
	path: string;
	fields: Record<string, string>;
	headers: Headers;
}

// A scripted Kurswahl school: tokens advance by one on every page, as the portal's do.
function fakeSchool(
	password = 'geheim',
	salts: Record<string, unknown>[] = [{ version: '1', salt: 'saltsalt' }]
) {
	const requests: Request[] = [];
	let token = 0;
	let signedIn = false;
	let stuck = false;
	let refusal: number | null = null;
	let current = CURRENT;
	let headerToken: string | null = null;
	const next = (body: string) => new Response(page(`tok${++token}`, body));
	const fetch: FetchFunction = async (url, init) => {
		const { host, pathname } = new URL(url);
		const body = init.body;
		const fields: Record<string, string> = {};
		if (body instanceof FormData) body.forEach((value, name) => (fields[name] = String(value)));
		else if (typeof body === 'string') new URLSearchParams(body).forEach((v, k) => (fields[k] = v));
		const headers = new Headers(init.headers);
		requests.push({ method: init.method ?? 'GET', path: pathname, fields, headers });

		if (host !== 'demo.kurswahl-online.de')
			return new Response('', {
				status: 302,
				headers: { location: 'https://www.kurswahl-online.de/' }
			});
		if (pathname === '/login.php' && fields.ajax === 'argon2') {
			return Response.json({
				salts,
				rotating_salt: 'rotation'
			});
		}
		if (pathname === '/login.php' && init.method === 'POST') {
			const hashes = JSON.parse(fields.realpasswort ?? '[]') as {
				hash: string;
				rotating: boolean;
			}[];
			const rotating = hashes.find((entry) => entry.rotating);
			if (rotating?.hash !== (await argon2(password, 'rotation', PARAMS))) {
				return next(
					"<div class=\"red textblock\">Falscher Benutzername</div><input type='hidden' name='realpasswort' value=''>"
				);
			}
			signedIn = true;
			return next('<script>post_link("index.php", {});</script>');
		}
		if (pathname === '/login.php') {
			if (signedIn && refusal) return new Response('', { status: refusal });
			signedIn = false;
			const settings = JSON.stringify(['dummy for old schema', PARAMS]);
			return next(
				`<script>kwo.settings("argon2_client_parameters", ${settings});</script><input name="realpasswort">`
			);
		}
		if (!signedIn) {
			return init.method === 'POST' && headers.has('x-csrf-token')
				? new Response('', { headers: { 'x-login-form': 'true' } })
				: next('<input type="hidden" name="realpasswort" value="">');
		}
		if (pathname === '/index.php' && fields.ajax === 'keepalive') {
			const handed = headerToken ?? `tok${++token}`;
			return new Response('ok', { headers: { 'x-csrf-token': handed } });
		}
		if (pathname === '/index.php') return next('Start');
		if (pathname === '/stundenplan.php' && refusal) return new Response('', { status: refusal });
		if (pathname === '/stundenplan.php') {
			// A portal made to ignore the request falls back to its default view.
			if (fields.woche === undefined || (fields.woche === '0' && stuck)) return next(current);
			return next(fields.woche === '0' ? GENERAL : DATED);
		}
		throw new Error(`Unexpected ${pathname}`);
	};
	return {
		fetch,
		requests,
		expire: () => (signedIn = false),
		ignoreGeneralPlan: () => (stuck = true),
		refuse: (status: number) => (refusal = status),
		showByDefault: (html: string) => (current = html),
		handOutHeaderToken: (value: string) => (headerToken = value)
	};
}

describe('Kurswahl client', () => {
	test('signs in, reads a week and chains the CSRF token', async () => {
		const school = fakeSchool();
		const kurswahl = createKurswahl({ fetch: school.fetch });
		const connection = await kurswahl.login({
			school: 'demo',
			username: 'max',
			password: 'geheim'
		});

		const timetable = await connection.timetable({ week: '2025-08-25' });
		// A dated week shows only its own rotation.
		expect(timetable.lessons.map((lesson) => lesson.rotation)).toEqual([null, 'A', null]);

		const [sent] = school.requests.filter((r) => r.fields.woche);
		expect(sent?.fields).toMatchObject({ woche: '25_08_2025', db_name: 'demo_stundenplan_1' });
		// Each page posts the token the page before it handed out.
		const pages = school.requests.filter((r) => r.path !== '/login.php');
		expect(pages.map((r) => r.fields._anti_csrf_token)).toEqual(['tok2', 'tok3', 'tok4']);

		await connection.keepAlive();
		expect(school.requests.at(-1)?.headers.get('x-csrf-token')).toBe('tok5');
		connection.dispose();
	});

	test('sends the rotating salt hash along with the stored one', async () => {
		const school = fakeSchool();
		await createKurswahl({ fetch: school.fetch }).login({
			school: 'demo',
			username: 'max',
			password: 'geheim'
		});
		const login = school.requests.find((r) => r.fields.realpasswort);
		expect(JSON.parse(login?.fields.realpasswort ?? '')).toEqual([
			{ version: '1', hash: await argon2('geheim', 'saltsalt', PARAMS), rotating: false },
			{
				version: 1,
				hash: await argon2('geheim', 'rotation', PARAMS),
				upgrade_hash: null,
				rotating: true
			}
		]);
	});

	test('hashes legacy and upgradeable salts the way the login page does', async () => {
		const school = fakeSchool('geheim', [
			{ version: 0 },
			{ version: '1', salt: 'saltsalt', upgrade_salt: 'upgradesalt' }
		]);
		await createKurswahl({ fetch: school.fetch }).login({
			school: 'demo',
			username: 'max',
			password: 'geheim'
		});
		const login = school.requests.find((r) => r.fields.realpasswort);
		expect(JSON.parse(login?.fields.realpasswort ?? '')).toEqual([
			{ version: 0, hash: 'geheim', rotating: false },
			{
				version: '1',
				hash: await argon2('geheim', 'saltsalt', PARAMS),
				upgrade_hash: await argon2('geheim', 'upgradesalt', PARAMS),
				rotating: false
			},
			{
				version: 1,
				hash: await argon2('geheim', 'rotation', PARAMS),
				upgrade_hash: null,
				rotating: true
			}
		]);
		// The salts XHR carries the login page's token, as the browser's does.
		const salts = school.requests.find((r) => r.fields.ajax === 'argon2');
		expect(salts?.headers.get('x-csrf-token')).toBe('tok1');
	});

	test('maps refusals like the Schulportal client does', async () => {
		const school = fakeSchool();
		const connection = await createKurswahl({ fetch: school.fetch }).login({
			school: 'demo',
			username: 'max',
			password: 'geheim'
		});
		school.refuse(403);
		await rejects(connection.timetable(), 'FORBIDDEN');
		school.refuse(401);
		await rejects(connection.timetable(), 'SESSION_EXPIRED');
		connection.dispose();
	});

	test('reports a wrong password and an unknown school', async () => {
		const kurswahl = createKurswahl({ fetch: fakeSchool().fetch });
		await rejects(
			kurswahl.login({ school: 'demo', username: 'max', password: 'falsch' }),
			'AUTH_FAILED'
		);
		await rejects(kurswahl.login({ school: 'other', username: 'max', password: 'x' }), 'NOT_FOUND');
		await rejects(
			kurswahl.login({ school: 'evil.com/', username: 'max', password: 'x' }),
			'INVALID_OPTION'
		);
	});

	test('rejects a week the portal does not offer', async () => {
		const school = fakeSchool();
		const connection = await createKurswahl({ fetch: school.fetch }).login({
			school: 'demo',
			username: 'max',
			password: 'geheim'
		});
		await rejects(connection.timetable({ week: '2025-09-01' }), 'NOT_FOUND');
		await rejects(connection.timetable({ week: '1.9.2025' }), 'INVALID_OPTION');
		connection.dispose();
	});

	test('reads the general plan with both rotations, and never passes off one week as it', async () => {
		const school = fakeSchool();
		const connection = await createKurswahl({ fetch: school.fetch }).login({
			school: 'demo',
			username: 'max',
			password: 'geheim'
		});
		const plan = await connection.timetable();
		expect(plan.week).toBeNull();
		expect(plan.lessons.map((lesson) => lesson.rotation)).toEqual([null, 'A', 'B', null]);

		// One week holds a single rotation, so lessons would go missing.
		school.ignoreGeneralPlan();
		await rejects(connection.timetable(), 'LAYOUT_CHANGED');
		connection.dispose();
	});

	test("reads this week's rotation from the default view", async () => {
		const school = fakeSchool();
		const connection = await createKurswahl({ fetch: school.fetch }).login({
			school: 'demo',
			username: 'max',
			password: 'geheim'
		});
		expect(await connection.currentRotation()).toBe('A');
		// It learns the database, so a later timetable() skips the first visit.
		expect(JSON.parse(connection.exportState()).database).toBe('demo_stundenplan_1');
		// The default view never carries the week field, so the portal shows the current week.
		expect(school.requests.at(-1)?.fields.woche).toBeUndefined();
		// Asking for the general plan does not change what the default view shows.
		await connection.timetable();
		expect(await connection.currentRotation()).toBe('A');

		// A week without A/B lessons has no rotation to tell.
		school.showByDefault(CURRENT.replace(/<div[^>]*Realkurs: 9[^>]*>.*?<\/div>/s, ''));
		expect(await connection.currentRotation()).toBeNull();
		// Both rotations, a dated week or the general plan are not the current week.
		for (const view of [TIMETABLE.replace(' selected', ''), TIMETABLE, GENERAL]) {
			school.showByDefault(view);
			await rejects(connection.currentRotation(), 'LAYOUT_CHANGED');
		}
		connection.dispose();
	});

	test('keeps only header tokens that exported state can restore', async () => {
		const school = fakeSchool();
		const kurswahl = createKurswahl({ fetch: school.fetch });
		const connection = await kurswahl.login({
			school: 'demo',
			username: 'max',
			password: 'geheim'
		});
		const before = JSON.parse(connection.exportState()).token;
		for (const bad of ['abc def', 'x'.repeat(513)]) {
			school.handOutHeaderToken(bad);
			await connection.keepAlive();
			expect(() => kurswahl.restore(connection.exportState())).not.toThrow();
			expect(JSON.parse(connection.exportState()).token).toBe(before);
		}
		connection.dispose();
	});

	test('restores a session from its state and notices when it ended', async () => {
		const school = fakeSchool();
		const kurswahl = createKurswahl({ fetch: school.fetch });
		const first = await kurswahl.login({ school: 'demo', username: 'max', password: 'geheim' });
		await first.timetable();
		const state = first.exportState();
		first.dispose();
		expect(state).not.toContain('geheim');

		const restored = kurswahl.restore(state);
		expect(restored.account).toEqual({ school: 'demo', username: 'max' });
		await restored.keepAlive();
		// The stored database lets the restored connection skip the first visit.
		const before = school.requests.length;
		await restored.timetable();
		expect(school.requests.length - before).toBe(1);

		school.expire();
		await rejects(restored.timetable(), 'SESSION_EXPIRED');
		await rejects(restored.keepAlive(), 'SESSION_EXPIRED');
		restored.dispose();
	});

	test('logs out, and does not report a refused logout as done', async () => {
		const school = fakeSchool();
		const kurswahl = createKurswahl({ fetch: school.fetch });
		const first = await kurswahl.login({ school: 'demo', username: 'max', password: 'geheim' });
		const state = first.exportState();
		await first.logout();
		await rejects(kurswahl.restore(state).timetable(), 'SESSION_EXPIRED');

		const second = await kurswahl.login({ school: 'demo', username: 'max', password: 'geheim' });
		school.refuse(403);
		await rejects(second.logout(), 'FORBIDDEN');
		// Disposed either way, so nothing keeps using a session in an unknown state.
		await rejects(second.timetable(), 'DISPOSED');
	});

	test('refuses state that is not its own', () => {
		const kurswahl = createKurswahl({ fetch: fakeSchool().fetch });
		const valid = {
			format: 'ranzen/kurswahl@1',
			school: 'demo',
			username: 'max',
			token: null,
			database: null,
			cookies: []
		};
		expect(() => kurswahl.restore(JSON.stringify(valid))).not.toThrow();
		expect(() => kurswahl.restore(JSON.stringify({ ...valid, token: 'abc+/=' }))).not.toThrow();
		for (const bad of [
			{ format: 'ranzen/state@1' },
			{ school: 'evil.com' },
			{ token: 'a b' },
			{ cookies: [{}] }
		]) {
			expect(failureCode(() => kurswahl.restore(JSON.stringify({ ...valid, ...bad })))).toBe(
				'INVALID_STATE'
			);
		}
	});
});
