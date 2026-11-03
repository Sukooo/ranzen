import { fail, layoutChanged } from '../../errors.js';
import { parseHtml, text } from '../../html.js';
import { ignoreDrift, isRecord, parseJson, type DriftSink } from '../../util.js';
import type { CalendarCategory, CalendarEvent, CalendarEventDetails } from './types.js';

// The portal's "YYYY-MM-DD HH:MM:SS", read as wall clock.
const STAMP = /^(\d{4}-\d{2}-\d{2})[ T]([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

interface Stamp {
	date: string;
	/** "HH:MM:SS". */
	time: string;
}

// Real calendar dates only; Date arithmetic in UTC never shifts a plain date.
export function isIsoDate(value: unknown): value is string {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const date = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

function addDays(date: string, days: number): string {
	return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

// Callers treat the list as complete, so an unreadable event fails the whole read.
export function parseEvents(body: string, drift: DriftSink = ignoreDrift): CalendarEvent[] {
	const data = parseJson(body, 'calendar events');
	if (!Array.isArray(data)) throw layoutChanged('calendar events as a list');
	const events = new Map<string, CalendarEvent>();
	for (const raw of data) {
		const event = parseEvent(raw, drift);
		// The same id twice is the same event; the first one wins.
		if (!events.has(event.id)) events.set(event.id, event);
	}
	return [...events.values()];
}

function parseEvent(raw: unknown, drift: DriftSink): CalendarEvent {
	if (!isRecord(raw)) throw layoutChanged('every calendar event as an object');
	const id = idOf(raw.Id);
	const title = plain(raw.title);
	const start = stamp(raw.Anfang);
	if (!id || !title || !start) {
		throw layoutChanged('an id, a title and a readable start on every calendar event');
	}
	const end = stamp(raw.Ende);
	if (!end && raw.Ende != null && raw.Ende !== '') drift('A calendar event has an unreadable end.');

	if (typeof raw.allDay !== 'boolean') drift('A calendar event has no allDay flag.');
	const allDay = raw.allDay === true;
	// Without a readable end the event is read as starting only.
	let last = end ?? start;
	// The portal ends all-day events at 23:59; an end at midnight of a later day is read as exclusive.
	if (allDay && end && end.time === '00:00:00' && end.date > start.date) {
		last = { date: addDays(end.date, -1), time: end.time };
	}
	if (`${last.date} ${last.time}` < `${start.date} ${start.time}`) last = start;
	const changed = raw.LetzteAenderung == null ? null : stamp(raw.LetzteAenderung);
	if (raw.LetzteAenderung != null && !changed)
		drift('A calendar event has an unreadable change date.');
	return {
		id,
		title,
		description: plain(raw.description, true),
		location: plain(raw.Ort),
		categoryId: idOf(raw.category),
		group: isRecord(raw.Lerngruppe) ? plain(raw.Lerngruppe.Name) : null,
		allDay,
		startDate: start.date,
		endDate: last.date,
		startTime: allDay ? null : start.time.slice(0, 5),
		endTime: allDay || !end ? null : last.time.slice(0, 5),
		updatedAt: changed && `${changed.date}T${changed.time}`,
		isNew: flag(raw.Neu, drift),
		isPublic: flag(raw.Oeffentlich, drift),
		isPrivate: flag(raw.Privat, drift),
		isSecret: flag(raw.Geheim, drift)
	};
}

const CATEGORIES =
	/var\s+categories\s*=\s*new\s+Array\(\);([\s\S]*?)var\s+groups\s*=\s*new\s+Array\(\);/;
// A key with its single- or double-quoted value or bare number, e.g. id:'3' or "name": "Ferien".
const PROPERTY = /["']?(\w+)["']?\s*:\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|(-?\d+))/g;

/** Categories from the calendar page's inline script, one object literal per line. */
export function parseCategories(html: string, drift: DriftSink = ignoreDrift): CalendarCategory[] {
	const block = CATEGORIES.exec(html)?.[1];
	if (block === undefined) throw layoutChanged('the category list on the calendar page');
	const categories = new Map<string, CalendarCategory>();
	// Line by line, so a brace inside a name cannot split a literal.
	for (const [literal] of block.matchAll(/\{.*\}/g)) {
		const values: Record<string, string> = {};
		for (const [, key = '', single, double, number] of literal.matchAll(PROPERTY)) {
			values[key] = number ?? unescape(single ?? double ?? '');
		}
		const id = values.id?.trim();
		const name = plain(values.name);
		if (!id || !name) {
			drift('A calendar category has no id or name.');
			continue;
		}
		const color = values.color?.trim() || null;
		const valid = color && /^#(?:[0-9a-f]{3}){1,2}$/i.test(color) ? color : null;
		if (color && !valid) drift('A calendar category has an unreadable color.');
		if (!categories.has(id)) categories.set(id, { id, name, color: valid });
	}
	return [...categories.values()];
}

export function parseEventDetails(
	body: string,
	drift: DriftSink = ignoreDrift
): CalendarEventDetails {
	const data = parseJson(body, 'a calendar event');
	if (!isRecord(data) || Array.isArray(data)) throw layoutChanged('a calendar event as an object');
	// The portal answers an unknown id with error -1, or with an empty id when it is not a number.
	if (data.error === -1 || data.id === '' || data.id === null) {
		throw fail('NOT_FOUND', 'The portal has no such calendar event.');
	}
	const id = idOf(data.id);
	if (!id) throw layoutChanged('a calendar event with an id');
	const properties = isRecord(data.properties) ? data.properties : {};
	if (!isRecord(data.properties)) drift('A calendar event has no properties.');
	const groups = isRecord(properties.zielgruppen) ? Object.entries(properties.zielgruppen) : [];
	return {
		id,
		responsible: plain(properties.verantwortlich),
		targetGroups: groups.flatMap(([key, label]) => {
			if (typeof label !== 'string') return [];
			// The -sus label carries leftover "amp;", which lanis-mobile drops the same way.
			const name = plain(key === '-sus' ? label.replaceAll('amp;', '') : label);
			return name ? [name] : [];
		})
	};
}

function stamp(value: unknown): Stamp | null {
	const match = typeof value === 'string' ? STAMP.exec(value.trim()) : null;
	if (!match || !isIsoDate(match[1])) return null;
	return { date: match[1], time: `${match[2]}:${match[3]}:${match[4] ?? '00'}` };
}

function idOf(value: unknown): string | null {
	if (typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) {
		return null;
	}
	return String(value).trim() || null;
}

// 'ja' or 'nein'; a missing flag is off (lanis-mobile reads anything but 'nein' as on).
function flag(value: unknown, drift: DriftSink): boolean {
	if (value !== undefined && value !== null && value !== 'ja' && value !== 'nein') {
		drift('A calendar event has an unknown flag value.');
	}
	return value === 'ja';
}

// Values are HTML, sometimes encoded once more. Only encoded breaks such as "&lt;br /&gt;" become
// markup, so escaped text such as "a &lt;b" stays text; a second layer of entities is decoded.
function plain(value: unknown, multiline = false): string | null {
	if (typeof value !== 'string' && typeof value !== 'number') return null;
	const html = String(value).replace(/&(?:amp;)*lt;br\s*\/?&(?:amp;)*gt;/gi, '<br>');
	const lines = text(parseHtml(html), multiline).split('\n');
	return lines.map((line) => (ENTITY.test(line) ? decode(line) : line)).join('\n') || null;
}

const ENTITY = /&(?:[a-z][a-z\d]*|#\d+|#x[\da-f]+);/i;

// Entities only; a "<" in the text is escaped first so it cannot start a tag.
function decode(line: string): string {
	return text(parseHtml(line.replaceAll('<', '&lt;')));
}

// JavaScript string escapes such as \' and \u{...}.
function unescape(value: string): string {
	return value.replace(
		/\\(u\{[\da-f]{1,6}\}|u[\da-f]{4}|x[\da-f]{2}|.)/gi,
		(escape, code: string) => {
			if (code.length === 1) return { n: '\n', r: '\r', t: '\t' }[code] ?? code;
			const point = parseInt(code.replace(/^[ux]\{?|\}$/g, ''), 16);
			return point <= 0x10ffff ? String.fromCodePoint(point) : escape;
		}
	);
}
