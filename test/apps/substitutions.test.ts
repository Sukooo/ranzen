import { expect, test } from 'bun:test';
import { parseFullPlan, parsePlan } from '../../src/apps/substitutions/parse.js';
import { parseHtml } from '../../src/html.js';
import { driftLog, failureCode } from '../failure.js';

test('reads days, notices and own substitutions', () => {
	const { drift, details } = driftLog();
	const days = parsePlan(
		parseHtml(`
		<div class="panel panel-info" id="tag19_10_2026">
			<div class="panel-heading">Montag, 19.10.2026 <span class="badge woche">A-Woche</span></div>
			<table class="infos"><tr class="subheader"><td>Allgemein<tr><td>Hofdienst<br>8a</table>
			<table id="vtable19_10_2026"><thead><tr><th data-field="Stunde">Std<th data-field="Klasse">Kl
				<th data-field="Lehrer">Lehrer<th data-field="Raum">Raum<th>Sonstiges</thead>
				<tbody><tr><td>3 - 4<td>Q1<td><del>DEF</del><td>101<td>?</tbody></table>
			<div class="footer">Letzte Aktualisierung: 16.10.2026 um 11:58:40 Uhr</div>
		</div>
		<div class="panel" id="tag20_10_2026"><table id="vtable20_10_2026"><thead><tr><th data-field="Stunde">
			<tbody><tr><td colspan="5">Keine Einträge</tbody></table></div>`),
		drift
	);
	expect(details).toEqual(['A plan column has no name.']);
	expect(days.map(({ substitutions, ...day }) => [day, substitutions.length])).toEqual([
		[
			{
				date: '2026-10-19',
				week: 'A-Woche',
				rotation: 'A',
				notices: [{ title: 'Allgemein', lines: ['Hofdienst\n8a'] }],
				updatedAt: '2026-10-16T11:58:40'
			},
			1
		],
		[{ date: '2026-10-20', week: null, rotation: null, notices: [], updatedAt: null }, 0]
	]);
	expect(days[0]?.substitutions[0]).toMatchObject({
		periods: '3 - 4',
		periodNumbers: [3, 4],
		classes: 'Q1',
		teacher: 'DEF',
		room: '101',
		subject: null
	});
});
test('keeps rows with single-column cells and skips only the empty-day row', () => {
	const { drift, details } = driftLog();
	const [day] = parsePlan(
		parseHtml(`<div class="panel" id="tag19_10_2026"><table id="vtable19_10_2026">
			<thead><tr><th data-field="Stunde"><th data-field="Klasse"></thead>
			<tbody><tr><td colspan="1">3<td>Q1<tr><td colspan="2">Keine Einträge</tbody></table>
			<div>Letzte Aktualisierung: 31.02.2026 um 11:58:40 Uhr</div></div>`),
		drift
	);
	expect([day?.substitutions.map(({ periods }) => periods), day?.updatedAt]).toEqual([['3'], null]);
	expect(details).toEqual([]);
});

test('reads the full plan and its markup', () => {
	const { drift, details } = driftLog();
	const [entry] = parseFullPlan(
		JSON.stringify([
			{
				Tag: '19.10.2026',
				Stunde: '1 - 2',
				Lehrer: '<del>Mül</del>',
				Lehrerkuerzel: 'MÜL',
				Vertreterkuerzel: '',
				Raum: '081',
				Raum_alt: '082',
				Hinweis: 'Tom &amp; Jerry',
				Raum_neu: '083',
				_hervorgehoben: ['Raum', 'Unbekannt', 'constructor', '__proto__']
			},
			null
		]),
		'2026-10-20',
		drift
	);
	expect(details).toEqual([
		'The full plan has an unknown key "Raum_neu".',
		...Array(3).fill('A highlighted field is unknown.'),
		'A full plan entry is not an object.'
	]);
	expect(entry).toMatchObject({
		date: '2026-10-19',
		teacher: 'Mül',
		teacherCode: 'MÜL',
		substituteCode: null,
		room: '081',
		previousRoom: '082',
		note: 'Tom & Jerry',
		highlighted: ['room']
	});
	expect(failureCode(() => parseFullPlan('-1', '2026-10-19'))).toBe('FORBIDDEN');
	expect(failureCode(() => parseFullPlan('<html>', '2026-10-19'))).toBe('LAYOUT_CHANGED');
});

test('keeps numbers and never copies content-like names into drift', () => {
	const { drift, details } = driftLog();
	const [entry] = parseFullPlan(
		JSON.stringify([{ Stunde: 3, Raum: { neu: '101' }, 'Max Muster': 'x' }]),
		'2026-10-20',
		drift
	);
	expect(entry).toMatchObject({ periods: '3', room: null });
	expect(details).toEqual([
		'A full plan field is not text.',
		'The full plan has an unknown key (unreadable name).'
	]);
});

test('reads lesson periods and leaves break duties without any', () => {
	const { drift, details } = driftLog();
	const labels = ['4', '3. - 4.', '7-8', '9 – 10', '5.', '2/3', '0/1', 'MP', '4 - 3', 'Abend'];
	const entries = parseFullPlan(
		JSON.stringify(labels.map((Stunde) => ({ Stunde }))),
		'2026-10-20',
		drift
	);
	expect(entries.map((entry) => entry.periodNumbers)).toEqual([
		[4],
		[3, 4],
		[7, 8],
		[9, 10],
		[5],
		[],
		[],
		[],
		[],
		[]
	]);
	expect(details).toEqual(Array(2).fill('A substitution has periods in an unknown format.'));
});

test('reads both week label styles as rotation', () => {
	const { drift, details } = driftLog();
	const day = (id: string, label: string) =>
		`<div class="panel" id="tag${id}"><span class="badge woche">${label}</span>
			<table id="vtable${id}"><thead><tr><th data-field="Stunde"></thead><tbody></tbody></table></div>`;
	const days = parsePlan(
		parseHtml(
			day('19_10_2026', 'WA-Woche') + day('20_10_2026', 'WB-Woche') + day('21_10_2026', 'C-Woche')
		),
		drift
	);
	expect(days.map((entry) => [entry.week, entry.rotation])).toEqual([
		['WA-Woche', 'A'],
		['WB-Woche', 'B'],
		['C-Woche', null]
	]);
	expect(details).toEqual(['A plan day has an unknown week label.']);
});
