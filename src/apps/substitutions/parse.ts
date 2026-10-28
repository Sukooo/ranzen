import { fail, layoutChanged } from '../../errors.js';
import {
	all,
	attr,
	cells,
	hasClass,
	one,
	rows,
	stripTags,
	text,
	type Document,
	type Element
} from '../../html.js';
import {
	identifier,
	ignoreDrift,
	isRecord,
	isoDate,
	parseJson,
	type DriftSink
} from '../../util.js';
import type { Day, Notice, Rotation, Substitution } from './types.js';

const FIELDS = {
	Stunde: 'periods',
	Klasse: 'classes',
	Klasse_alt: 'previousClasses',
	Vertreter: 'substitute',
	Lehrer: 'teacher',
	Lehrerkuerzel: 'teacherCode',
	Vertreterkuerzel: 'substituteCode',
	Art: 'kind',
	Fach: 'subject',
	Fach_alt: 'previousSubject',
	Raum: 'room',
	Raum_alt: 'previousRoom',
	Hinweis: 'note',
	Hinweis2: 'secondNote',
	Lerngruppe: 'group'
} as const satisfies Record<string, keyof Substitution>;

type Field = keyof typeof FIELDS;

// Full plan keys ranzen knows but does not expose.
const EXTRA_KEYS = new Set(['Tag', 'Tag_en', '_hervorgehoben', '_sprechend']);

function isField(name: string): name is Field {
	return Object.hasOwn(FIELDS, name);
}

export function parsePlan(document: Document, drift: DriftSink = ignoreDrift): Day[] {
	if (!one('#menue_tag', document) && !one('[id^="tag"].panel', document)) {
		throw layoutChanged('#menue_tag or a day panel on the substitution plan');
	}
	return all('.panel[id^="tag"]', document).flatMap((panel) => {
		const date = isoDate((attr(panel, 'id') ?? '').replaceAll('_', '.'));
		if (!date) {
			drift('A plan day has no readable date.');
			return [];
		}
		const table = one('table[id^="vtable"]', panel);
		if (!table) drift('A plan day has no table.');
		const fields = table ? all('thead th', table).map((cell) => attr(cell, 'data-field')) : [];
		for (const field of fields) {
			if (!field) drift('A plan column has no name.');
			else if (!isField(field)) drift(`The plan has an unknown column ${identifier(field)}.`);
		}
		const entries = rows(table).filter((row) => !isPlaceholder(row));
		const stamp = /(\d{2}\.\d{2}\.\d{4}) um ([01]\d|2[0-3]):([0-5]\d):([0-5]\d)/.exec(text(panel));
		const stampDay = stamp && isoDate(stamp[1]!);
		const week = text(one('.badge.woche', panel)) || null;
		return [
			{
				date,
				week,
				rotation: rotation(week, drift),
				notices: parseNotices(panel),
				substitutions: entries.map((row) => {
					const columns = cells(row);
					if (columns.length !== fields.length) drift('A plan row does not match its columns.');
					const values: Record<string, string> = {};
					fields.forEach((field, index) => {
						if (field) values[field] = text(columns[index]);
					});
					return substitution(values, date, [], drift);
				}),
				updatedAt: stampDay ? `${stampDay}T${stamp![2]}:${stamp![3]}:${stamp![4]}` : null
			}
		];
	});
}

export function parseFullPlan(
	body: string,
	date: string,
	drift: DriftSink = ignoreDrift
): Substitution[] {
	if (body.trim() === '-1') {
		throw fail('FORBIDDEN', 'This account cannot read the full substitution plan.');
	}
	const rows = parseJson(body, 'the full substitution plan');
	if (!Array.isArray(rows)) throw layoutChanged('the full substitution plan as a list');
	return rows.flatMap((row) => {
		if (!isRecord(row)) {
			drift('A full plan entry is not an object.');
			return [];
		}
		const values: Record<string, string> = {};
		for (const [key, value] of Object.entries(row)) {
			if (!isField(key) && !EXTRA_KEYS.has(key))
				drift(`The full plan has an unknown key ${identifier(key)}.`);
			if (typeof value === 'string') values[key] = stripTags(value);
			else if (typeof value === 'number') values[key] = String(value);
			else if (value !== null && isField(key)) drift('A full plan field is not text.');
		}
		const marked = Array.isArray(row._hervorgehoben) ? row._hervorgehoben : [];
		return [substitution(values, isoDate(values.Tag ?? '') ?? date, marked, drift)];
	});
}

function substitution(
	values: Record<string, string>,
	date: string,
	marked: unknown[],
	drift: DriftSink
): Substitution {
	const entry: Substitution = {
		date,
		periods: values.Stunde ?? '',
		periodNumbers: periodNumbers(values.Stunde ?? '', drift),
		classes: null,
		previousClasses: null,
		substitute: null,
		teacher: null,
		substituteCode: null,
		teacherCode: null,
		kind: null,
		subject: null,
		previousSubject: null,
		room: null,
		previousRoom: null,
		note: null,
		secondNote: null,
		group: null,
		highlighted: []
	};
	for (const [field, key] of Object.entries(FIELDS) as [Field, (typeof FIELDS)[Field]][]) {
		if (key !== 'periods') entry[key] = values[field] || null;
	}
	entry.highlighted = marked.flatMap((field) => {
		if (typeof field === 'string' && isField(field)) return [FIELDS[field]];
		drift('A highlighted field is unknown.');
		return [];
	});
	return entry;
}

// "A-Woche" or "WA-Woche" → "A".
function rotation(label: string | null, drift: DriftSink): Rotation | null {
	if (!label) return null;
	const match = /^W?([AB])-?Woche$/i.exec(label);
	if (!match) drift('A plan day has an unknown week label.');
	return match ? (match[1]!.toUpperCase() as Rotation) : null;
}

// "3 - 4" → [3, 4]; break duties such as "2/3" (between periods 2 and 3) or "MP" (lunch) hold no lesson.
function periodNumbers(label: string, drift: DriftSink): number[] {
	const range = /^(\d{1,2})\.?(?:\s*[-–]\s*(\d{1,2})\.?)?$/.exec(label.trim());
	const first = Number(range?.[1]);
	const last = Number(range?.[2] ?? range?.[1]);
	if (range && last >= first) return Array.from({ length: last - first + 1 }, (_, i) => first + i);
	if (!/^(?:\d{1,2}\s*\/\s*\d{1,2}|MP)$/i.test(label.trim())) {
		drift('A substitution has periods in an unknown format.');
	}
	return [];
}

// An empty day is one cell spanning the table, e.g. "Keine Einträge!".
function isPlaceholder(row: Element): boolean {
	const [only, ...rest] = cells(row);
	return !rest.length && Number(attr(only, 'colspan')) > 1;
}

function parseNotices(panel: Element): Notice[] {
	const notices: Notice[] = [];
	for (const row of all('table.infos tr', panel)) {
		if (hasClass(row, 'subheader')) {
			notices.push({ title: text(row), lines: [] });
		} else {
			const line = text(one('td', row), true);
			if (line) notices.at(-1)?.lines.push(line);
		}
	}
	return notices;
}
