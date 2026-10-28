import { layoutChanged } from '../errors.js';
import {
	all,
	attr,
	cells,
	hasClass,
	one,
	ownText,
	parseHtml,
	stripTags,
	text,
	type Document,
	type Element
} from '../html.js';
import { isoDate, type DriftSink } from '../util.js';
import type {
	KurswahlCourse,
	KurswahlLesson,
	PeriodTime,
	Rotation,
	Timetable,
	Week,
	Weekday
} from './types.js';

const DAYS = ['montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag', 'sonntag'];

// "<b>Leiste 1: LK 1:  MATHEMATIK bei Muster, Frau<br>Raum: 101, Woche: A</b><br>Realkurs: 7"
const TOOLTIP =
	/^<b>\s*Leiste\s+(\d+):\s*(.*?)(?:\s+bei\s+(.*?))?\s*<br\s*\/?>\s*Raum:\s*(.*?)(?:,\s*Woche:\s*([AB]))?\s*<\/b>\s*<br\s*\/?>\s*Realkurs:\s*(\d+)\s*$/is;
// "2: LK 2:  PH-LK (Mu)" or "18: TUT (Bsp)".
const LABEL = /^(\d+):\s*(?:LK\s*\d+:\s*)?(.+?)(?:\s*\(([^()]+)\))?$/;
// "27.08.26  12:12:51"
const STAMP = /(\d{2})\.(\d{2})\.(\d{2}|\d{4})\s+(\d{2}):(\d{2}):(\d{2})/g;

/** The anti-CSRF token every Kurswahl page carries. */
export function csrfToken(html: string): string | null {
	const token = attr(one('meta[name="anti_csrf_token"]', parseHtml(html)), 'content');
	return token && isToken(token) ? token : null;
}

/** The timetable database the page's week form posts, e.g. "musterschule_stundenplan_1". */
export function timetableDatabase(doc: Document): string {
	const database = attr(one('input[name="db_name"]', doc), 'value');
	if (!database || !isDatabase(database)) throw layoutChanged('the timetable database field');
	return database;
}

/** Kurswahl marks "allgemeiner Stundenplan" as selected only when it shows the general plan. */
export function isGeneralPlan(html: string): boolean {
	return all('select[name="woche"] option[selected]', parseHtml(html)).some(
		(option) => attr(option, 'value') === '0'
	);
}

/** Visible ASCII only, since the token travels in a header; shared with state validation. */
export function isToken(value: string): boolean {
	return /^[\x21-\x7e]{1,512}$/.test(value);
}

export function isDatabase(value: string): boolean {
	return /^[\w-]{1,200}$/.test(value);
}

export function parseTimetable(html: string, drift: DriftSink): Timetable {
	const doc = parseHtml(html);
	const database = timetableDatabase(doc);
	const table = one('table.stundenplan', doc);
	if (!table) throw layoutChanged('the timetable table');

	const [head, ...body] = all('tr', table);
	const days = all('th', head ?? table)
		.slice(1)
		.map((th) => DAYS.indexOf(text(th).toLowerCase()) + 1);
	if (!days.length || !days.every(isWeekday))
		throw layoutChanged('weekday headers in the timetable');

	const periods: PeriodTime[] = [];
	const courses = new Map<string, KurswahlCourse>();
	const lessons: KurswahlLesson[] = [];
	for (const row of body) {
		const [first, ...slots] = cells(row);
		const match = /^(\d+)\.\s*(?:(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2}))?/.exec(text(first));
		if (!match || slots.length !== days.length) throw layoutChanged('timetable rows per period');
		const period = Number(match[1]);
		periods.push({ period, start: match[2] ?? null, end: match[3] ?? null });

		slots.forEach((slot, index) => {
			const entries = all('div[tooltip]', slot);
			if (!entries.length && text(slot)) throw layoutChanged('course entries in timetable cells');
			for (const entry of entries) {
				const { course, room, rotation } = parseEntry(entry);
				const known = courses.get(course.id);
				if (!known) courses.set(course.id, course);
				else if (JSON.stringify(known) !== JSON.stringify(course)) {
					drift('A course shows different details in different cells.');
				}
				lessons.push({ course: course.id, day: days[index] as Weekday, period, room, rotation });
			}
		});
	}

	const options = all('select[name="woche"] option', doc).map((option) => {
		const value = attr(option, 'value') ?? '';
		const week = parseWeek(value, text(option));
		if (!week && value !== '0') drift('A week option has an unknown format.');
		return { value, week, selected: 'selected' in option.attribs };
	});
	// The general plan selects no option (or "0"); an unreadable dated week must not pass for it.
	const chosen = options.find((option) => option.selected && option.value !== '0');
	if (chosen && !chosen.week) throw layoutChanged('the selected week');
	return {
		database,
		week: chosen?.week ?? null,
		weeks: options.flatMap((option) => (option.week ? [option.week] : [])),
		periods,
		courses: [...courses.values()],
		lessons,
		...changeTimes(doc)
	};
}

function parseEntry(entry: Element): {
	course: KurswahlCourse;
	room: string | null;
	rotation: Rotation | null;
} {
	const tooltip = TOOLTIP.exec((attr(entry, 'tooltip') ?? '').trim());
	const label = LABEL.exec(ownText(entry));
	if (!tooltip || !label) throw layoutChanged('a known course entry in the timetable');
	const [, block = '', heading = '', teacher = '', room = '', week, id = ''] = tooltip;
	const code = label[2] ?? '';
	const level = /^(LK|GK)\b\s*(?:\d+:)?\s*(.*)$/.exec(stripTags(heading));
	// The heading names the level; failing that, a "-LK"/"-GK" code or the cell's lk class does.
	const kind = level?.[1] ?? /-(LK|GK)$/.exec(code)?.[1] ?? (hasClass(entry, 'lk') ? 'LK' : null);
	const person = /^(.*?)(?:,\s*(Frau|Herr))?$/.exec(stripTags(teacher));
	const shown = text(one('span', entry));
	return {
		course: {
			id,
			block: Number(block),
			code,
			title: (level ? level[2] : stripTags(heading)) || null,
			level: kind as 'LK' | 'GK' | null,
			teacher: {
				code: label[3]?.trim() || null,
				lastName: person?.[1] || null,
				salutation: (person?.[2] as 'Frau' | 'Herr' | undefined) ?? null
			}
		},
		room: stripTags(room) || shown.replace(/\[[AB]\]/, '').trim() || null,
		rotation: (week ?? /\[([AB])\]/.exec(shown)?.[1] ?? null) as Rotation | null
	};
}

function isWeekday(day: number): day is Weekday {
	return day >= 1 && day <= 7;
}

function parseWeek(value: string, label: string): Week | null {
	const [start, end] = label.split(/\s+-\s+/).map((part) => isoDate(part));
	return /^\d{2}_\d{2}_\d{4}$/.test(value) && start && end ? { id: value, start, end } : null;
}

// "Letzte Änderung Stundenplan (Kurszuteilung): 27.08.26 12:12:51 (25.08.26 09:02:04)"
function changeTimes(
	doc: Document
): Pick<Timetable, 'updatedAt' | 'assignedAt' | 'examsUpdatedAt'> {
	let updatedAt: string | null = null;
	let assignedAt: string | null = null;
	let examsUpdatedAt: string | null = null;
	for (const row of all('tr', doc)) {
		const [label = '', value = ''] = cells(row).map((cell) => text(cell));
		if (!label.startsWith('Letzte Änderung')) continue;
		const [first = null, second = null] = [...value.matchAll(STAMP)].map(localTime);
		if (label.includes('Klausurplan')) examsUpdatedAt = first;
		else if (label.includes('Stundenplan')) [updatedAt, assignedAt] = [first, second];
	}
	return { updatedAt, assignedAt, examsUpdatedAt };
}

function localTime([, day, month, year = '', hours, minutes, seconds]: RegExpMatchArray):
	string | null {
	const date = isoDate(`${day}.${month}.${year.length === 2 ? `20${year}` : year}`);
	return date && `${date}T${hours}:${minutes}:${seconds}`;
}
