import { expect, test } from 'bun:test';
import { parseCourse, parseOverview } from '../../src/apps/lessons/parse.js';
import { parseHtml } from '../../src/html.js';
import { driftLog, failureCode } from '../failure.js';

const TEACHER = '<button class="btn btn-md dropdown-toggle" title="Muster, Max (MUS)">MUS</button>';

test('reads the overview', () => {
	const overview = parseOverview(
		parseHtml(`
		<div id="mappen"><div class="row"><div class="thumbnail">
			<h2><span title="Mathematik LK">Mathe</span></h2>${TEACHER}
			<a class="btn btn-info" href="meinunterricht.php?a=sus_view&id=101#leistungen">3 Leistungen</a>
			<a class="btn btn-danger" href="#">2</a>
			<a class="btn btn-warning" href="#">1 Eintrag</a>
		</div></div></div>
		<table id="aktuellTable"><tbody><tr data-entry="55" data-book="101">
			<td><span class="name">Mathe</span><span class="teacher">${TEACHER}</span>
			<td><b class="thema">Integrale</b> <span class="datum">14.10.2026</span>
				<div class="inhalt">Erste Zeile<br>
					zweite   Zeile</div>
				<div class="homework"><span class="done hidden">erledigt</span><span class="realHomework">S. 12</span></div>
				<a class="file" data-file="blatt.pdf" data-extension="pdf">blatt.pdf <small>(12 KB)</small></a>
		</tbody></table>
		<table id="anwesend"><thead><tr><th>Kurs<th>Lehrkraft<th>Fehlstunden<th>davon entschuldigt<th>verspätet</thead>
			<tbody><tr><td><a href="meinunterricht.php?a=sus_view&id=101&halb=1">Mathe</a><td>${TEACHER}<td>4<td>2<td>1 (2x, insg. 15 min)
		</tbody></table>`)
	);
	const teacher = { code: 'MUS', firstName: 'Max', lastName: 'Muster' };
	expect(overview.courses).toEqual([
		{
			id: '101',
			name: 'Mathematik LK',
			teachers: [teacher],
			marks: 3,
			undoneHomework: 2,
			upcomingEntries: 1
		}
	]);
	expect(overview.latest[0]).toEqual({
		course: { id: '101', name: 'Mathe' },
		teachers: [teacher],
		entry: {
			id: '55',
			date: '2026-10-14',
			periods: null,
			topic: 'Integrale',
			content: 'Erste Zeile\nzweite Zeile',
			homework: { text: 'S. 12', done: false },
			files: [{ name: 'blatt.pdf', extension: 'pdf', size: '12 KB' }],
			submissions: [],
			attendance: null
		}
	});
	expect(overview.attendance).toEqual([
		{
			course: { id: '101', name: 'Mathe' },
			semester: 1,
			teachers: [teacher],
			hours: { fehlstunden: 4, 'davon entschuldigt': 2, verspätet: 1 }
		}
	]);
});

test('reads a course with its history, marks and attendance', () => {
	const course = parseCourse(
		parseHtml(`
		<h1 data-book="101">Mathe <small><span class="label">2. Halbjahr</span></small></h1>${TEACHER}
		<a href="meinunterricht.php?a=sus_view&id=101&halb=1">1. Halbjahr</a>
		<div id="history"><table><tbody>
			<tr data-entry="55"><td>14.10.2026<br><small>1. - 2. Stunde</small>
				<td><b>Integrale</b><br>
					<span class="markup"><i class="fa fa-comment-alt"></i> Inhalt<br>mehr</span>
					<span class="homework"><span class="undone">offen</span><span class="done hidden">erledigt</span></span>
					<span class="markup">Aufgabe 3</span>
					<div class="file" data-file="a.pdf" data-extension="pdf">a.pdf <small>(1 MB)</small></div>
					<div class="btn-group"><button class="btn btn-warning"><i class="fa fa-upload"></i> Abgabe <span class="badge">2</span>
							<small>bis 20.10.2026 um 9:05</small><span class="caret"></span></button>
						<ul><li><a href="meinunterricht.php?a=sus_abgabe&b=&e=&id=9">öffnen</a></li></ul></div>
					<div class="btn-group"><button class="btn btn-default">Alt</button>
						<a href="meinunterricht.php?a=sus_abgabe&id=8">ansehen</a></div>
				<td><span class="hidden_encoded">x9f</span>anwesend
			<tr data-entry="56"><td>13.10.2026 <small>3. Stunde</small><td><b>Wiederholung</b><td>nicht erfasst
		</tbody></table></div>
		<div id="marks"><table>
			<tr><td>Klausur 1<td>Do, 17.09.<td><span class="badge">12</span>
			<tr><td colspan="3">Kommentar: gut gelöst
		</table></div>
		<div id="klausuren"><div class="alert alert-info">noch keine Leistungskontrollen</div></div>
		<table id="attendanceTable"><tr><td>Fehlstunden<td>2</table>`),
		'101'
	);
	expect(course).toMatchObject({
		id: '101',
		name: 'Mathe',
		semester: 2,
		marks: [{ name: 'Klausur 1', date: 'Do, 17.09.', value: '12', comment: 'gut gelöst' }],
		exams: [],
		attendance: { fehlstunden: 2 },
		firstSemester: '101'
	});
	expect(course.entries).toEqual([
		{
			id: '55',
			date: '2026-10-14',
			periods: { from: 1, to: 2, label: '1. - 2. Stunde' },
			topic: 'Integrale',
			content: 'Inhalt\nmehr',
			homework: { text: 'Aufgabe 3', done: false },
			files: [{ name: 'a.pdf', extension: 'pdf', size: '1 MB' }],
			submissions: [
				{ id: '9', name: 'Abgabe', open: true, uploaded: '2', due: '2026-10-20T09:05' },
				{ id: '8', name: 'Alt', open: false, uploaded: null, due: null }
			],
			attendance: 'anwesend'
		},
		{
			id: '56',
			date: '2026-10-13',
			periods: { from: 3, to: 3, label: '3. Stunde' },
			topic: 'Wiederholung',
			content: null,
			homework: null,
			files: [],
			submissions: [],
			attendance: null
		}
	]);
});

test('reads legacy layouts of semester links, periods, names and comments', () => {
	const { drift, details } = driftLog();
	const course = parseCourse(
		parseHtml(`
		<h1 data-book="101">Mathe</h1>
		<button class="btn btn-md dropdown-toggle" title="Muster, Max, Dr. (MUS)">MUS</button>
		<a class="btn btn-default hidden-print" href="meinunterricht.php?a=sus_view&id=99&halb=1">1. Halbjahr</a>
		<div id="history"><table><tbody>
			<tr data-entry="55"><td>14.10.2026<br><small>1.-2.</small><td><b>Integrale</b><td>anwesend
		</tbody></table></div>
		<div id="marks"><table>
			<tr><td>Klausur 1<td>Do, 17.09.<td>12
			<tr><td><td colspan="2">Bemerkung: gut: sehr
		</table></div>
		<div id="klausuren"></div><table id="attendanceTable"></table>`),
		'101',
		drift
	);
	expect(details).toEqual([]);
	expect(course).toMatchObject({
		firstSemester: '99',
		teachers: [{ code: 'MUS', firstName: 'Max, Dr.', lastName: 'Muster' }],
		marks: [{ name: 'Klausur 1', comment: 'gut: sehr' }]
	});
	expect(course.entries[0]?.periods).toEqual({ from: 1, to: 2, label: '1.-2.' });
});

test('rejects look-alike semester links, periods and comment rows', () => {
	const { drift, details } = driftLog();
	const course = parseCourse(
		parseHtml(`
		<h1 data-book="101">Mathe</h1>
		<a class="hidden-print" href="vertretungsplan.php?id=7&halb=1">Andere</a>
		<a class="btn btn-default hidden-print" href="meinunterricht.php?a=sus_view&id=8&halb=10">2. Halbjahr</a>
		<a class="btn btn-default hidden-print" href="meinunterricht.php?a=sus_view&id=99&halb=1">1. Halbjahr</a>
		<div id="history"><table><tbody>
			<tr data-entry="55"><td>14.10.2026<br><small>08:00 - 09:30</small><td><b>x</b><td>anwesend
			<tr data-entry="56"><td>15.10.2026<br><small>1.–2. Stunde</small><td><b>x</b><td>anwesend
		</tbody></table></div>
		<div id="marks"><table>
			<tr><td>Klausur 1<td>Do, 17.09.<td>12
			<tr><td>Kommentar: gut
			<tr><td><td colspan="2">
			<tr><td><td>Di, 20.10.
		</table></div>
		<div id="klausuren"></div><table id="attendanceTable"></table>`),
		'101',
		drift
	);
	expect(course.firstSemester).toBe('99');
	expect(course.entries.map((entry) => entry.periods)).toEqual([
		null,
		{ from: 1, to: 2, label: '1.–2. Stunde' }
	]);
	expect(course.marks).toMatchObject([{ name: 'Klausur 1', comment: 'gut' }]);
	expect(details).toEqual([
		'A history row has unreadable periods.',
		'A mark row has an unknown shape.'
	]);
});

test('a course without a first-semester link has none', () => {
	const course = parseCourse(
		parseHtml(`<h1 data-book="101">Mathe</h1><div id="history"></div>
		<a href="meinunterricht.php?a=sus_view&id=7&halb=1">Andere</a>`),
		'101'
	);
	expect(course.firstSemester).toBeNull();
});

test('merges upcoming and past exams', () => {
	const { exams } = parseCourse(
		parseHtml(`
		<h1 data-book="101">Deutsch</h1><div id="history"></div>
		<div id="klausuren"><div class="row"><div class="col-md-12">
			<div class="col-md-6"><h2><i class="fa fa-pen-alt"></i> Kommende Leistungskontrolle(n)</h2>
				<ul><li> 01.12.2026 Klausur, 3., 4., 5. Std. </li></ul></div>
			<div class="col-md-6"><h2><i class="fa fa-pen-alt"></i> Alle Leistungskontrolle(n)</h2>
				<ul><li>11.09.2026 Klausur</li><li>01.12.2026 Klausur</li></ul></div>
		</div></div></div>`),
		'101'
	);
	expect(exams).toEqual([
		{ date: '2026-09-11', kind: 'Klausur', periods: null, upcoming: false },
		{ date: '2026-12-01', kind: 'Klausur', periods: '3., 4., 5. Std.', upcoming: true }
	]);
});

test('known layouts report no drift', () => {
	const { drift, details } = driftLog();
	parseCourse(
		parseHtml(`<h1 data-book="1">Mathe</h1><div id="history"><table></table></div>
		<div id="marks"><table><tr><td>Test<td>Mo<td>9<tr><td colspan="3">Kommentar: ok</table></div>
		<div id="klausuren"></div><table id="attendanceTable"></table>`),
		'1',
		drift
	);
	expect(details).toEqual([]);
});

test('reports drift instead of guessing', () => {
	const { drift, details } = driftLog();
	const overview = parseOverview(
		parseHtml(`<div id="mappen"><div class="thumbnail"><h2>Neu</h2></div></div>
		<table id="aktuellTable"><tr><td>ohne id</table>`),
		drift
	);
	const course = parseCourse(
		parseHtml(`<h1 data-book="1">Mathe</h1>
		<div id="history"><table><tr><td>ohne id</table></div>
		<div id="marks"><table><tr><td>Test<td>Mo</table></div>
		<div id="klausuren"><div><h2>Neue Liste</h2><ul><li>bald</li></ul></div></div>`),
		'1',
		drift
	);
	expect([overview.courses, overview.latest, course.entries, course.marks, course.exams]).toEqual([
		[],
		[],
		[],
		[],
		[]
	]);
	expect(details).toEqual([
		'A course card has no course link.',
		'A latest entry has no entry id.',
		'The course page has no #attendanceTable.',
		'A history row has no entry id.',
		'A mark row has an unknown shape.',
		'An exam list has an unknown heading.',
		'An exam has no readable date and kind.'
	]);
});

test('reports sections that moved instead of returning nothing', () => {
	const { drift, details } = driftLog();
	const overview = parseOverview(
		parseHtml(`<div id="mappen"><div class="card"><a href="meinunterricht.php?a=sus_view&id=1">M</a></div></div>
		<table id="neu"><tr data-entry="5"><td>x</table>`),
		drift
	);
	const course = parseCourse(
		parseHtml(`<h1 data-book="1">Mathe</h1><div id="marks"></div>
		<div id="history"><table><tr data-entry="5"><td>gestern <small>morgens</small><td><b>Integrale</b><div class="btn-group"><button class="btn btn-warning">Abgabe <small>bald</small></button><a href="x.php?a=sus_abgabe&id=3">o</a></div><td></table></div>
		<div id="klausuren"><h3>Kommende</h3><ul><li>01.12.2026 Klausur</li></ul></div>
		<table id="attendanceTable"><tr><td>Fehlstunden<td>zwei</table>`),
		'1',
		drift
	);
	expect([overview.courses, overview.latest, course.exams, course.attendance]).toEqual([
		[],
		[],
		[],
		{ fehlstunden: 0 }
	]);
	expect(details).toEqual([
		'The lessons page lists courses outside known cards.',
		'The lessons page lists entries outside #aktuellTable.',
		'A history row has no readable date.',
		'A history row has unreadable periods.',
		'A submission has no readable deadline.',
		'An exam is outside a known list.',
		'An attendance count is not a number.'
	]);
});

test('an account without courses is not drift', () => {
	const { drift, details } = driftLog();
	parseOverview(parseHtml('<div id="mappen"></div>'), drift);
	expect(details).toEqual([]);
});

test('reports misnested cells instead of returning empty fields', () => {
	const { drift, details } = driftLog();
	parseCourse(
		parseHtml(`<h1 data-book="1">Mathe</h1><div id="marks"></div><div id="klausuren"></div>
		<table id="attendanceTable"></table>
		<div id="history"><table><tr data-entry="5"><td><p>14.10.2026<td><b>Integrale</b><td>anwesend</table></div>`),
		'1',
		drift
	);
	expect(details).toEqual(['A history row has an unknown shape.']);
});

test('rejects unknown layouts', () => {
	expect(failureCode(() => parseOverview(parseHtml('<p>Wartung</p>')))).toBe('LAYOUT_CHANGED');
	expect(failureCode(() => parseCourse(parseHtml('<h1>Mathe</h1>'), '1'))).toBe('LAYOUT_CHANGED');
});

test('reads homework state from either badge and reports a missing one', () => {
	const { drift, details } = driftLog();
	const homework = (badges: string) =>
		parseOverview(
			parseHtml(`<div id="mappen"></div><table id="aktuellTable"><tr data-entry="1" data-book="1">
			<td><span class="datum">1.10.2026</span><div class="homework">${badges}<span class="realHomework">S. 1</span></div></table>`),
			drift
		).latest[0]?.entry.homework?.done;
	expect([
		homework('<span class="done">erledigt</span>'),
		homework('<span class="done hidden">erledigt</span><span class="undone">offen</span>'),
		homework('<span class="completed">erledigt</span>'),
		homework('<span class="done">erledigt</span><span class="undone">offen</span>')
	]).toEqual([true, false, false, false]);
	expect(details).toEqual([
		'A homework has no readable state.',
		'A homework has no readable state.'
	]);
});

test('reports course links outside cards next to known cards', () => {
	const { drift, details } = driftLog();
	const overview = parseOverview(
		parseHtml(`<div id="mappen">
			<div class="thumbnail"><h2>Mathe</h2><a href="meinunterricht.php?a=sus_view&id=1">M</a></div>
			<div class="card"><h2>Physik</h2><a href="meinunterricht.php?a=sus_view&id=2">P</a></div>
		</div>`),
		drift
	);
	expect(overview.courses.map(({ id }) => id)).toEqual(['1']);
	expect(details).toEqual(['The lessons page lists courses outside known cards.']);
});
