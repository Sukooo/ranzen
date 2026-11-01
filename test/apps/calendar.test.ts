import { beforeAll, describe, expect, test } from 'bun:test';
import { calendar } from '../../src/apps/calendar/index.js';
import { parseCategories, parseEventDetails, parseEvents } from '../../src/apps/calendar/parse.js';
import { createPortal, isRanzenError, type Drift, type RanzenError } from '../../src/index.js';
import { fakeFetch, portalRoutes, reply, type Route } from '../fake-portal.js';
import { driftLog, failureCode } from '../failure.js';

const PAGE = 'https://start.schulportal.hessen.de/kalender.php';

const EVENT = {
	Id: '4711',
	title: 'Elternabend',
	description: 'Raum&lt;br /&gt;\nbitte p&amp;uuml;nktlich',
	Ort: 'Aula',
	Anfang: '2026-10-19 18:00:00',
	Ende: '2026-10-19 19:30:00',
	allDay: false,
	category: 3,
	Lerngruppe: { Name: 'Q1 Mathematik' },
	Verantwortlich: '815',
	LetzteAenderung: '2026-10-16 11:58:40',
	FremdUID: '',
	Institution: '1234',
	Neu: 'ja',
	Oeffentlich: 'nein',
	Privat: 'nein',
	Geheim: 'nein'
};

const events = (...list: unknown[]) => JSON.stringify(list);

describe('events', () => {
	test('reads a timed event', () => {
		const { drift, details } = driftLog();
		expect(parseEvents(events(EVENT), drift)).toEqual([
			{
				id: '4711',
				title: 'Elternabend',
				description: 'Raum\nbitte pünktlich',
				location: 'Aula',
				categoryId: '3',
				group: 'Q1 Mathematik',
				allDay: false,
				startDate: '2026-10-19',
				endDate: '2026-10-19',
				startTime: '18:00',
				endTime: '19:30',
				updatedAt: '2026-10-16T11:58:40',
				isNew: true,
				isPublic: false,
				isPrivate: false,
				isSecret: false
			}
		]);
		expect(details).toEqual([]);
	});

	test('keeps the wall clock across a DST change', () => {
		const [event] = parseEvents(
			events({ ...EVENT, Anfang: '2026-10-25 02:30:00', Ende: '2026-10-25 03:15:00' })
		);
		expect([event?.startTime, event?.endTime]).toEqual(['02:30', '03:15']);
	});

	test('reads all-day and multi-day events with an inclusive end', () => {
		const day = (Id: string, Anfang: string, Ende: string, allDay = true) => ({
			...EVENT,
			Id,
			Anfang,
			Ende,
			allDay
		});
		const list = parseEvents(
			events(
				day('1', '2026-10-19 00:00:00', '2026-10-19 00:00:00'),
				day('2', '2026-10-19 00:00:00', '2026-10-20 00:00:00'),
				day('3', '2026-10-19 00:00:00', '2026-10-23 23:59:00'),
				day('4', '2026-10-19 00:00:00', '2026-11-01 00:00:00'),
				day('5', '2026-10-19 08:00:00', '2026-10-21 12:00:00', false),
				day('6', '2026-10-19 20:00:00', '2026-10-20 00:00:00', false),
				day('7', '2026-12-31 00:00:00', '2027-01-01 00:00:00')
			)
		);
		expect(
			list.map(({ id, startDate, endDate, startTime, endTime }) => [
				id,
				startDate,
				endDate,
				startTime,
				endTime
			])
		).toEqual([
			['1', '2026-10-19', '2026-10-19', null, null],
			// The portal ends all-day events at 23:59; midnight of a later day is exclusive.
			['2', '2026-10-19', '2026-10-19', null, null],
			['3', '2026-10-19', '2026-10-23', null, null],
			['4', '2026-10-19', '2026-10-31', null, null],
			// Timed events keep their end as written.
			['5', '2026-10-19', '2026-10-21', '08:00', '12:00'],
			['6', '2026-10-19', '2026-10-20', '20:00', '00:00'],
			['7', '2026-12-31', '2026-12-31', null, null]
		]);
	});

	test('collapses an end before the start to the start', () => {
		const list = parseEvents(
			events(
				{ ...EVENT, Id: '1', Anfang: '2026-10-19 10:00:00', Ende: '2026-10-18 09:00:00' },
				{ ...EVENT, Id: '2', Anfang: '2026-10-19 10:00:00', Ende: '2026-10-19 09:00:00' },
				{
					...EVENT,
					Id: '3',
					allDay: true,
					Anfang: '2026-10-19 00:00:00',
					Ende: '2026-10-17 00:00:00'
				}
			)
		);
		expect(list.map(({ endDate, endTime }) => [endDate, endTime])).toEqual([
			['2026-10-19', '10:00'],
			['2026-10-19', '10:00'],
			['2026-10-19', null]
		]);
	});

	test('reads encoded and marked-up text as plain text', () => {
		const [event, marked, quoted, mixed] = parseEvents(
			events(
				{
					...EVENT,
					Id: '1',
					title: 'Tom &amp;amp; Jerry',
					description:
						'Erste Zeile&lt;br /&gt;\r\nZweite&lt;br&gt;&lt;br&gt;Absatz &lt;b&gt;fett&lt;/b&gt;'
				},
				{ ...EVENT, Id: '2', description: '<p>Erste</p><p>Zweite<br>Zeile &amp; mehr</p>' },
				{ ...EVENT, Id: '3', description: 'a &lt;b und c &gt; d', Ort: '  ' },
				{ ...EVENT, Id: '4', description: '<p>Raum&lt;br /&gt;bitte p&amp;uuml;nktlich</p>' }
			)
		);
		expect([event?.title, event?.description]).toEqual([
			'Tom & Jerry',
			// Only encoded breaks become markup; other encoded tags stay visible text.
			'Erste Zeile\nZweite\n\nAbsatz <b>fett</b>'
		]);
		expect(marked?.description).toBe('Erste\nZweite\nZeile & mehr');
		expect([quoted?.description, quoted?.location]).toEqual(['a <b und c > d', null]);
		expect(mixed?.description).toBe('Raum\nbitte pünktlich');
	});

	test('leaves missing optional fields empty', () => {
		const { drift, details } = driftLog();
		const [event] = parseEvents(
			events({
				Id: 12,
				title: 'Ferien',
				Anfang: '2026-10-19 00:00:00',
				Ende: '2026-10-31 00:00:00',
				allDay: true,
				description: '',
				Ort: null,
				category: '',
				Lerngruppe: [],
				LetzteAenderung: null
			}),
			drift
		);
		expect(event).toEqual({
			id: '12',
			title: 'Ferien',
			description: null,
			location: null,
			categoryId: null,
			group: null,
			allDay: true,
			startDate: '2026-10-19',
			endDate: '2026-10-30',
			startTime: null,
			endTime: null,
			updatedAt: null,
			isNew: false,
			isPublic: false,
			isPrivate: false,
			isSecret: false
		});
		expect(details).toEqual([]);
	});

	test('keeps the first of duplicate ids', () => {
		const list = parseEvents(
			events(EVENT, { ...EVENT, title: 'Doppelt' }, { ...EVENT, Id: 4711 }, { ...EVENT, Id: '9' })
		);
		expect(list.map(({ id, title }) => [id, title])).toEqual([
			['4711', 'Elternabend'],
			['9', 'Elternabend']
		]);
	});

	test('skips malformed events and reports them without their content', () => {
		const { drift, details } = driftLog();
		const list = parseEvents(
			events(
				null,
				'Max Muster',
				{ ...EVENT, Id: '' },
				{ ...EVENT, Id: { geheim: 'Max Muster' } },
				{ ...EVENT, title: '&lt;br&gt;' },
				{ ...EVENT, Anfang: '19.10.2026 18:00' },
				{ ...EVENT, Ende: '2026-02-30 10:00:00' },
				{ ...EVENT, Ende: undefined },
				{ ...EVENT, Id: '2', allDay: 'true', Neu: 'vielleicht', LetzteAenderung: 'gestern' },
				EVENT
			),
			drift
		);
		expect(list.map(({ id, allDay, isNew, updatedAt }) => [id, allDay, isNew, updatedAt])).toEqual([
			['2', false, false, null],
			['4711', false, true, '2026-10-16T11:58:40']
		]);
		expect(details).toEqual([
			...Array(2).fill('A calendar event is not an object.'),
			...Array(2).fill('A calendar event has no id.'),
			'A calendar event has no title.',
			...Array(3).fill('A calendar event has no readable start and end.'),
			'A calendar event has no allDay flag.',
			'A calendar event has an unreadable change date.',
			'A calendar event has an unknown flag value.'
		]);
		expect(details.join(' ')).not.toContain('Max');
	});

	test('rejects anything but a list of events', () => {
		expect(failureCode(() => parseEvents('<html><form>Login</form></html>'))).toBe(
			'LAYOUT_CHANGED'
		);
		expect(failureCode(() => parseEvents('{"error":"1"}'))).toBe('LAYOUT_CHANGED');
		expect(parseEvents('[]')).toEqual([]);
	});
});

describe('categories', () => {
	const page = (lines: string) => `<html><script>
		var categories = new Array();
		${lines}
		var groups = new Array();
		groups.push({id:'1', name:'Klasse 5a'});
	</script></html>`;

	test('reads the inline script with both quotes and escapes', () => {
		const { drift, details } = driftLog();
		const list = parseCategories(
			page(`categories.push({id:'1', name:'Ferien', color:'#00ff00'});
		categories.push({"id": "2", "name": "Tag der \\"offenen\\" T\\u00fcr", "color": "#ABCDEF"});
		categories.push({id: 3, name: 'Eltern\\'abend {Aula}', color: '#abc'});
		categories.push({id:'4', name:'Klausuren &amp; Tests', color:'rot'});
		categories.push({id:'5', name:'Ohne Farbe'});
		categories.push({id:'6', name:'Sportfest ${'\\'}u{1F3C3}'});
		categories.push({id:'1', name:'Doppelt', color:'#000000'});
		categories.push({id:'', name:'Leer'});
		// keine Kategorie`),
			drift
		);
		expect(list).toEqual([
			{ id: '1', name: 'Ferien', color: '#00ff00' },
			{ id: '2', name: 'Tag der "offenen" Tür', color: '#ABCDEF' },
			{ id: '3', name: "Eltern'abend {Aula}", color: '#abc' },
			{ id: '4', name: 'Klausuren & Tests', color: null },
			{ id: '5', name: 'Ohne Farbe', color: null },
			{ id: '6', name: 'Sportfest 🏃', color: null }
		]);
		expect(details).toEqual([
			'A calendar category has an unreadable color.',
			'A calendar category has no id or name.'
		]);
	});

	test('accepts an empty list but not a page without one', () => {
		expect(parseCategories(page(''))).toEqual([]);
		expect(failureCode(() => parseCategories('<html>Login</html>'))).toBe('LAYOUT_CHANGED');
	});
});

describe('details', () => {
	test('reads the responsible person and target groups', () => {
		const { drift, details } = driftLog();
		const event = parseEventDetails(
			JSON.stringify({
				id: '4711',
				properties: {
					verantwortlich: 'Muster, Max',
					zielgruppen: {
						'-sus': 'Sch&amp;amp;uuml;ler &amp;amp; Eltern',
						'-lul': 'Q1 &amp;amp; Q2',
						x: 3
					}
				}
			}),
			drift
		);
		expect(event).toEqual({
			id: '4711',
			responsible: 'Muster, Max',
			targetGroups: ['Schüler & Eltern', 'Q1 & Q2']
		});
		const bare = { id: '1', properties: { zielgruppen: { '-sus': 'Schüler & amp; Eltern' } } };
		expect(parseEventDetails(JSON.stringify(bare)).targetGroups).toEqual(['Schüler & Eltern']);
		expect(details).toEqual([]);
	});

	test('reports unknown events and pages', () => {
		const { drift, details } = driftLog();
		expect(parseEventDetails('{"id":5,"properties":[]}', drift)).toEqual({
			id: '5',
			responsible: null,
			targetGroups: []
		});
		expect(details).toEqual([]);
		expect(parseEventDetails('{"id":"5"}', drift).targetGroups).toEqual([]);
		expect(details).toEqual(['A calendar event has no properties.']);
		expect(failureCode(() => parseEventDetails('{"id":""}'))).toBe('NOT_FOUND');
		expect(failureCode(() => parseEventDetails('{"id":null}'))).toBe('NOT_FOUND');
		expect(failureCode(() => parseEventDetails('{"error":-1}'))).toBe('NOT_FOUND');
		expect(failureCode(() => parseEventDetails('{"error":-2}'))).toBe('LAYOUT_CHANGED');
		for (const body of ['{}', '{"id":{}}', '{"id":" "}', '[]']) {
			expect(failureCode(() => parseEventDetails(body))).toBe('LAYOUT_CHANGED');
		}
		expect(failureCode(() => parseEventDetails('<html>'))).toBe('LAYOUT_CHANGED');
	});
});

describe('app', () => {
	let state: string;

	beforeAll(async () => {
		const { fetch } = fakeFetch(portalRoutes());
		state = (
			await createPortal({ fetch }).login({
				schoolId: 1234,
				username: 'max',
				password: 'geheim!pw'
			})
		).exportState();
	});

	function connect(...routes: Route[]) {
		const seen: Drift[] = [];
		const fake = fakeFetch(...routes);
		const portal = createPortal({ fetch: fake.fetch, onDrift: (drift) => void seen.push(drift) });
		return { ...fake, seen, api: portal.restore(state).open(calendar) };
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

	test('asks for the range as the portal script does and keeps overlapping events', async () => {
		const { api, sent, seen } = connect(() =>
			reply(
				200,
				events(
					{ ...EVENT, Id: '1', Anfang: '2026-10-01 08:00:00', Ende: '2026-10-01 09:00:00' },
					{ ...EVENT, Id: '2', Anfang: '2026-09-28 00:00:00', Ende: '2026-10-02 00:00:00' },
					{ ...EVENT, Id: '3', Anfang: '2026-10-31 23:00:00', Ende: '2026-11-01 01:00:00' },
					{ ...EVENT, Id: '4', Anfang: '2026-11-01 00:00:00', Ende: '2026-11-02 00:00:00' },
					{
						...EVENT,
						Id: '5',
						allDay: true,
						Anfang: '2026-09-30 00:00:00',
						Ende: '2026-10-01 00:00:00'
					},
					{ ...EVENT, Id: '' }
				)
			)
		);
		const list = await api.events({ from: '2026-10-01', to: '2026-10-31' });
		expect(list.map(({ id }) => id)).toEqual(['1', '2', '3']);
		expect(sent).toHaveLength(1);
		expect([sent[0]?.method, sent[0]?.url]).toEqual(['POST', PAGE]);
		expect(Object.fromEntries(new URLSearchParams(sent[0]?.body ?? ''))).toEqual({
			f: 'getEvents',
			start: '2026-10-01',
			end: '2026-10-31',
			s: ''
		});
		expect(seen).toEqual([{ app: 'calendar', detail: 'A calendar event has no id.' }]);
	});

	test('reads categories from the calendar page', async () => {
		const { api, sent } = connect(() =>
			reply(
				200,
				`<script>var categories = new Array();
				categories.push({id:'1', name:'Ferien', color:'#00ff00'});
				var groups = new Array();</script>`
			)
		);
		expect(await api.categories()).toEqual([{ id: '1', name: 'Ferien', color: '#00ff00' }]);
		expect([sent[0]?.method, sent[0]?.url]).toEqual(['GET', PAGE]);
	});

	test('loads the details of one event', async () => {
		const { api, sent } = connect(({ body }) =>
			reply(
				200,
				new URLSearchParams(body ?? '').get('id') === '4711'
					? JSON.stringify({ id: '4711', properties: { verantwortlich: 'Muster, Max' } })
					: '{"error":-1}'
			)
		);
		expect((await api.details('4711')).responsible).toBe('Muster, Max');
		expect(Object.fromEntries(new URLSearchParams(sent[0]?.body ?? ''))).toEqual({
			f: 'getEvent',
			id: '4711'
		});
		expect((await caught(api.details('1'))).code).toBe('NOT_FOUND');
		expect((await caught(api.details(' '))).code).toBe('INVALID_OPTION');
	});

	test('reads a login page instead of events as a changed layout', async () => {
		const { api } = connect(() => reply(200, '<html><form id="login">Anmelden</form></html>'));
		const error = await caught(api.events({ from: '2026-10-01', to: '2026-10-31' }));
		expect([error.code, error.message]).toEqual([
			'LAYOUT_CHANGED',
			'ranzen no longer matches the portal: expected calendar events as JSON.'
		]);
		const expired = connect(({ url }) =>
			url === PAGE ? reply(302, '', { location: '/index.php' }) : reply(200, '<html></html>')
		);
		expect((await caught(expired.api.events({ from: '2026-10-01', to: '2026-10-31' }))).code).toBe(
			'SESSION_EXPIRED'
		);
	});

	test('refuses invalid ranges without a request', async () => {
		const { api, sent } = connect(() => reply(200, '[]'));
		const ranges = [
			{ from: '2026-10-31', to: '2026-10-01' },
			{ from: '2026-02-30', to: '2026-03-01' },
			{ from: '01.10.2026', to: '2026-10-31' },
			{ from: '2026-10-01', to: '' },
			{ from: '2026-10-01T00:00', to: '2026-10-31' }
		];
		for (const range of ranges) {
			const error = await caught(api.events(range));
			expect([error.code, error.fault]).toEqual(['INVALID_OPTION', 'caller']);
		}
		expect(sent).toHaveLength(0);
		expect(await api.events({ from: '2026-10-19', to: '2026-10-19' })).toEqual([]);
		expect(new URLSearchParams(sent[0]?.body ?? '').get('end')).toBe('2026-10-19');
	});
});
