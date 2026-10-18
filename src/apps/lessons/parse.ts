import { layoutChanged } from '../../errors.js';
import {
	all,
	attr,
	cells,
	hasClass,
	one,
	ownText,
	rows,
	text,
	type Document,
	type Element
} from '../../html.js';
import { ignoreDrift, isoDate, parseCount, queryParam, type DriftSink } from '../../util.js';
import type {
	AttendanceSummary,
	Course,
	Entry,
	EntryFile,
	Exam,
	Homework,
	Mark,
	Overview,
	Periods,
	Submission,
	Teacher
} from './types.js';

export function parseOverview(document: Document, drift: DriftSink = ignoreDrift): Overview {
	const folders = one('#mappen', document);
	if (!folders) throw layoutChanged('#mappen on the lessons page');
	const cards = all('.thumbnail', folders);
	// An empty #mappen is a valid account without courses; course links outside cards are not.
	const carded = new Set(cards.flatMap((card) => all('a[href*="sus_view"]', card)));
	if (all('a[href*="sus_view"]', folders).some((link) => !carded.has(link))) {
		drift('The lessons page lists courses outside known cards.');
	}
	const latest = one('#aktuellTable', document);
	if (!latest && one('tr[data-entry]', document)) {
		drift('The lessons page lists entries outside #aktuellTable.');
	}
	return {
		courses: cards.flatMap((card) => {
			const id = queryParam(attr(one('a[href*="sus_view"]', card), 'href'), 'id');
			if (!id) {
				drift('A course card has no course link.');
				return [];
			}
			const name = attr(one('h2 [title]', card), 'title') ?? text(one('h2', card));
			return [
				{
					id,
					name,
					teachers: all('button.dropdown-toggle[title]', card).map(teacher),
					marks: count(one('a.btn-info[href*="#leistungen"]', card)),
					undoneHomework: count(one('a.btn-danger', card)),
					upcomingEntries: count(one('a.btn-warning', card))
				}
			];
		}),
		latest: entryRows(rows(latest), 'A latest entry', drift).map((row) => ({
			course: { id: attr(row, 'data-book') ?? '', name: text(one('.name', row)) },
			teachers: all('.teacher button[title]', row).map(teacher),
			entry: {
				...emptyEntry(attr(row, 'data-entry') ?? ''),
				date: entryDate(text(one('.datum', row)), 'A latest entry', drift),
				topic: text(one('.thema', row)) || null,
				content: text(one('.inhalt', row), true) || null,
				homework: overviewHomework(row, drift),
				files: all('a.file[data-file]', row).map(file)
			}
		})),
		attendance: parseAttendanceSummaries(document, drift)
	};
}

export function parseCourse(
	document: Document,
	id: string,
	drift: DriftSink = ignoreDrift
): Course {
	const heading = one('h1[data-book]', document);
	const history = one('#history', document);
	if (!heading) throw layoutChanged('h1[data-book] on the course page');
	if (!history) throw layoutChanged('#history on the course page');
	for (const section of ['#marks', '#klausuren', '#attendanceTable']) {
		if (!one(section, document)) drift(`The course page has no ${section}.`);
	}
	const label = text(one('small', heading));
	return {
		id,
		name: ownText(heading),
		semester: Number(/(\d)\.\s*Halbjahr/.exec(label)?.[1]) || null,
		teachers: all('button.dropdown-toggle.btn-md[title]', document).map(teacher),
		entries: entryRows(rows(history), 'A history row', drift).map((row) =>
			historyEntry(row, drift)
		),
		marks: parseMarks(document, drift),
		exams: parseExams(document, drift),
		attendance: hours(rows(one('#attendanceTable', document)), drift),
		firstSemester: firstSemester(document, id)
	};
}

// Prefer a link to the course's own id, else the semester button, which is hidden in print.
function firstSemester(document: Document, id: string): string | null {
	const links = all('a[href*="halb=1"]', document);
	const own = links.some((link) => queryParam(attr(link, 'href'), 'id') === id);
	if (own) return id;
	const button = links.find((link) => hasClass(link, 'hidden-print'));
	return queryParam(attr(button, 'href'), 'id');
}

// Entries carry their id in data-entry; rows without one are reported, never guessed.
function entryRows(table: Element[], what: string, drift: DriftSink): Element[] {
	return table.filter((row) => {
		if (attr(row, 'data-entry')) return true;
		drift(`${what} has no entry id.`);
		return false;
	});
}

function entryDate(value: string, what: string, drift: DriftSink): string | null {
	const date = isoDate(value);
	if (!date) drift(`${what} has no readable date.`);
	return date;
}

// Cells are read by position, so a different count (e.g. from misnested markup) is drift.
function historyEntry(row: Element, drift: DriftSink): Entry {
	const columns = cells(row);
	if (columns.length !== 3) drift('A history row has an unknown shape.');
	const [when, body, presence] = columns;
	const presenceText = text(presence);
	return {
		...emptyEntry(attr(row, 'data-entry') ?? ''),
		date: entryDate(text(when), 'A history row', drift),
		periods: periods(text(when && one('small', when)), drift),
		topic: text(body && one(':scope > b', body)) || null,
		content: text(contentOf(body), true) || null,
		homework: historyHomework(body, drift),
		files: body ? all('.file[data-file]', body).map(file) : [],
		submissions: body ? all('.btn-group', body).flatMap((group) => submission(group, drift)) : [],
		attendance: presenceText && presenceText !== 'nicht erfasst' ? presenceText : null
	};
}

function contentOf(body: Element | undefined): Element | null {
	if (!body) return null;
	return all(':scope > .markup', body).find((markup) => one('.fa-comment-alt', markup)) ?? null;
}

// In the history, the homework text is the next .markup after the status badges.
function historyHomework(body: Element | undefined, drift: DriftSink): Homework | null {
	const status = body && one('.homework', body);
	if (!status) return null;
	let node = status.next;
	while (node && !(node.type === 'tag' && hasClass(node, 'markup'))) {
		node = node.next;
	}
	return {
		text: node?.type === 'tag' ? text(node, true) : '',
		done: homeworkDone(status, drift)
	};
}

function overviewHomework(row: Element, drift: DriftSink): Homework | null {
	const box = one('.homework', row);
	if (!box) return null;
	return { text: text(one('.realHomework', box), true), done: homeworkDone(box, drift) };
}

// The .done badge is always there and hidden while open; a visible .undone badge must agree.
function homeworkDone(box: Element, drift: DriftSink): boolean {
	const done = one('.done', box);
	const undone = one('.undone', box);
	const finished = !!done && !hasClass(done, 'hidden');
	if (!done || (undone && hasClass(undone, 'hidden') !== finished)) {
		drift('A homework has no readable state.');
		return false;
	}
	return finished;
}

// Open submissions are yellow and show their deadline, e.g. "bis 20.10.2026 um 23:59".
function submission(group: Element, drift: DriftSink): Submission[] {
	const link = one('a[href*="sus_abgabe"]', group);
	const id = queryParam(attr(link, 'href'), 'id');
	if (!id) return [];
	const button = one('button', group);
	const deadline = text(button && one('small', button));
	const day = isoDate(deadline);
	const time = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(deadline);
	if (deadline && !day) drift('A submission has no readable deadline.');
	return [
		{
			id,
			name: ownText(button),
			open: hasClass(button, 'btn-warning'),
			uploaded: text(button && one('.badge', button)) || null,
			due: day && time ? `${day}T${time[1]!.padStart(2, '0')}:${time[2]}` : day
		}
	];
}

// Each mark is a row of name, date and value, optionally followed by a comment in its own row.
function parseMarks(document: Document, drift: DriftSink): Mark[] {
	const marks: Mark[] = [];
	for (const row of rows(one('#marks', document))) {
		const [name, date, value, ...rest] = cells(row);
		const last = marks.at(-1);
		if (name && date && value && !rest.length) {
			marks.push({ name: text(name), date: text(date), value: text(value), comment: null });
		} else if (name && !value && (!date || !text(name)) && last) {
			last.comment = text(date ?? name).replace(/^[^:]*:\s*/, '') || null;
		} else drift('A mark row has an unknown shape.');
	}
	return marks;
}

// The tab lists upcoming exams with their periods, then all exams; both merge into one list.
function parseExams(document: Document, drift: DriftSink): Exam[] {
	const section = one('#klausuren', document);
	const exams = new Map<string, Exam>();
	const items = section ? all('li', section) : [];
	let read = 0;
	for (const heading of section ? all('h2', section) : []) {
		const title = text(heading);
		const upcoming = /kommende/i.test(title);
		if (!upcoming && !/alle/i.test(title)) drift('An exam list has an unknown heading.');
		for (const item of heading.parent ? all('li', heading.parent as Element) : []) {
			read++;
			const [, day = '', kind = '', periods] =
				/^(\S+)\s+([^,]+?)(?:,\s*(.+))?$/.exec(text(item)) ?? [];
			const date = isoDate(day);
			if (!date || !kind) {
				drift('An exam has no readable date and kind.');
				continue;
			}
			const known = exams.get(`${date} ${kind}`);
			if (!known) exams.set(`${date} ${kind}`, { date, kind, periods: periods ?? null, upcoming });
			else {
				known.upcoming ||= upcoming;
				known.periods ??= periods ?? null;
			}
		}
	}
	if (read < items.length) drift('An exam is outside a known list.');
	return [...exams.values()].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
}

function parseAttendanceSummaries(document: Document, drift: DriftSink): AttendanceSummary[] {
	const labels = all('#anwesend thead th', document).map((cell) => text(cell).toLowerCase());
	const table = rows(one('#anwesend', document));
	if (table.length && labels.length < 3) drift('The attendance table has no hour columns.');
	return table.flatMap((row) => {
		const link = one('a[href*="sus_view"]', row);
		const href = attr(link, 'href');
		const id = queryParam(href, 'id');
		if (!id) {
			drift('An attendance row has no course link.');
			return [];
		}
		const columns = cells(row);
		if (columns.length !== labels.length) drift('An attendance row does not match its columns.');
		const counts: Record<string, number> = {};
		labels.forEach((label, index) => {
			if (index < 2 || !label) return;
			counts[label] = parseCount(text(columns[index]), drift, 'An attendance count');
		});
		const semester = queryParam(href, 'halb');
		return [
			{
				course: { id, name: text(link) },
				semester: semester ? Number(semester) : null,
				teachers: all('[title]', columns[1] ?? row).map(teacher),
				hours: counts
			}
		];
	});
}

function hours(table: Element[], drift: DriftSink): Record<string, number> {
	const result: Record<string, number> = {};
	for (const row of table) {
		const [label, value, ...rest] = cells(row);
		if (!value || rest.length) drift('An attendance count has an unknown shape.');
		if (label) {
			result[text(label).toLowerCase()] = parseCount(text(value), drift, 'An attendance count');
		}
	}
	return result;
}

// Buttons carry "Last, First (Code)" in their title and the code as text.
function teacher(element: Element): Teacher {
	const title = (attr(element, 'title') ?? '').replace(/\s*\(([^)]*)\)\s*$/, '');
	const code = text(element) || /\(([^)]*)\)\s*$/.exec(attr(element, 'title') ?? '')?.[1] || null;
	const [lastName = '', ...firstNames] = title.split(',');
	return {
		code,
		firstName: firstNames.join(',').trim() || null,
		lastName: lastName.trim() || null
	};
}

function file(element: Element): EntryFile {
	const size = text(one('small', element)).replace(/^\(|\)$/g, '');
	return {
		name: attr(element, 'data-file') ?? '',
		extension: attr(element, 'data-extension') || null,
		size: size || null
	};
}

function periods(label: string, drift: DriftSink): Periods | null {
	if (!label) return null;
	const match = /(\d+)\.?(?:\s*-\s*(\d+)\.?)?/.exec(label);
	if (!match) {
		drift('A history row has unreadable periods.');
		return null;
	}
	const from = Number(match[1]);
	return { from, to: match[2] ? Number(match[2]) : from, label };
}

function count(element: Element | null): number {
	return Number(/\d+/.exec(text(element))?.[0] ?? 0);
}

function emptyEntry(id: string): Entry {
	return {
		id,
		date: null,
		periods: null,
		topic: null,
		content: null,
		homework: null,
		files: [],
		submissions: [],
		attendance: null
	};
}
