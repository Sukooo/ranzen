import { fail, layoutChanged } from './errors.js';

// Receives what a parser skipped or did not recognize; details must never contain personal data.
export type DriftSink = (detail: string) => void;

export const ignoreDrift: DriftSink = () => {};

// A portal-chosen name for drift details, kept only while it looks like an identifier, not content.
export function identifier(name: string): string {
	return /^[A-Za-z][\w-]{0,39}$/.test(name) ? `"${name}"` : '(unreadable name)';
}

// A count cell, optionally annotated as in "2 (3x, insg. 25 min)"; blanks are zero, the rest drift.
export function parseCount(value: string, drift: DriftSink, what: string): number {
	if (!value) return 0;
	const count = /^(\d+)(?:\s*\([^)]*\))?$/.exec(value)?.[1];
	if (count) return Number(count);
	drift(`${what} is not a number.`);
	return 0;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

// Trimmed text, or null for blanks and non-strings.
export function nonEmpty(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

// Portal JSON; anything unparsable means the portal changed, e.g. "the app list".
export function parseJson(body: string, what: string): unknown {
	try {
		return JSON.parse(body);
	} catch {
		throw layoutChanged(`${what} as JSON`);
	}
}

// dd.mm.yyyy as an ISO calendar date, without time zone guesswork; impossible dates are null.
export function isoDate(value: string): string | null {
	const match = /(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(value);
	if (!match) return null;
	const [, day = '', month = '', year = ''] = match;
	const date = new Date(0);
	date.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
	if (date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return null;
	return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

export function germanDate(iso: string): string {
	const [year, month, day] = iso.split('-');
	return `${day}.${month}.${year}`;
}

// A parameter of a relative portal link, e.g. id in "meinunterricht.php?a=sus_view&id=12#marks".
export function queryParam(href: string | undefined, name: string): string | null {
	if (!href) return null;
	return new URLSearchParams(href.split('?')[1]?.split('#')[0]).get(name);
}

export function positive(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw fail('INVALID_OPTION', `${name} must be a positive integer.`);
	}
	return value;
}
