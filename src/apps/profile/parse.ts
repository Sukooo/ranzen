import { layoutChanged } from '../../errors.js';
import { all, cells, hasClass, one, rows, text, type Document } from '../../html.js';
import { ignoreDrift, isoDate, type DriftSink } from '../../util.js';
import type { Profile, Role } from './types.js';

// The navbar icon is the only place the portal states the account's role.
const ROLE_ICONS: [string, Role][] = [
	['fa-child', 'student'],
	['fa-user-circle', 'parent'],
	['fa-user', 'teacher']
];

const KNOWN_LABELS = ['Login', 'Vorname', 'Nachname', 'Geburtsdatum', 'Stufe', 'Klasse'];

export function parseProfile(document: Document, drift: DriftSink = ignoreDrift): Profile {
	const table = one('#content table', document);
	if (!table) throw layoutChanged('#content table on the profile page');
	const fields: Record<string, string> = {};
	const lines = rows(table);
	for (const row of lines) {
		const [label, value, ...rest] = cells(row);
		if (!value || rest.length) drift('A profile row has an unknown shape.');
		const key = text(label).replace(/:$/, '');
		if (key) fields[key] = text(value);
	}
	if (lines.length && !KNOWN_LABELS.some((key) => key in fields)) {
		drift('The profile table has no known labels.');
	}
	const icon = one('.navbar-right > li > a > i', document);
	const role = ROLE_ICONS.find(([name]) => hasClass(icon, name))?.[1] ?? null;
	if (!role) drift('The navbar shows no known role icon.');
	const field = (key: string) => fields[key] || null;
	return {
		login: field('Login'),
		firstName: field('Vorname'),
		lastName: field('Nachname'),
		birthDate: isoDate(fields.Geburtsdatum ?? ''),
		grade: field('Stufe'),
		className: field('Klasse'),
		role,
		school:
			all('.navbar-brand', document)
				.map((brand) => text(brand))
				.find(Boolean) ?? null,
		fields
	};
}
