import { expect, test } from 'bun:test';
import { parseProfile } from '../../src/apps/profile/parse.js';
import { parseHtml } from '../../src/html.js';
import { driftLog, failureCode } from '../failure.js';

const page = (icon: string) =>
	parseHtml(`
	<nav><a class="navbar-brand" href="/"><img src="logo.png"></a><span class="navbar-brand">Muster-Gymnasium</span>
		<ul class="nav navbar-nav navbar-right"><li><a href="#"><i class="fa ${icon}"></i> Muster, Max (Q1)</a></ul></nav>
	<div id="content"><table class="table table-striped"><tbody>
		<tr><td>Login:<td>max.muster
		<tr><td>Vorname<td>Max<tr><td>Nachname<td>Muster
		<tr><td>Geburtsdatum<td>1.2.2008<tr><td>Stufe<td>Q1<tr><td>Geschlecht<td>männlich
	</tbody></table></div>`);

test('reads the account data', () => {
	expect(parseProfile(page('fa-child'))).toEqual({
		login: 'max.muster',
		firstName: 'Max',
		lastName: 'Muster',
		birthDate: '2008-02-01',
		grade: 'Q1',
		className: null,
		role: 'student',
		school: 'Muster-Gymnasium',
		fields: {
			Login: 'max.muster',
			Vorname: 'Max',
			Nachname: 'Muster',
			Geburtsdatum: '1.2.2008',
			Stufe: 'Q1',
			Geschlecht: 'männlich'
		}
	});
});

test('tells roles apart by exact icon', () => {
	expect(parseProfile(page('fa-user-circle')).role).toBe('parent');
	expect(parseProfile(page('fa-user')).role).toBe('teacher');
	const { drift, details } = driftLog();
	expect(parseProfile(page('fa-question'), drift).role).toBeNull();
	expect(details).toEqual(['The navbar shows no known role icon.']);
});

test('reports renamed labels instead of returning an empty profile', () => {
	const { drift, details } = driftLog();
	const profile = parseProfile(
		parseHtml(
			'<div id="content"><table><tr><td>Benutzer<td>max</table></div><i class="fa fa-child"></i>'
		),
		drift
	);
	expect(profile.login).toBeNull();
	expect(details).toEqual([
		'The profile table has no known labels.',
		'The navbar shows no known role icon.'
	]);
});

test('rejects unknown layouts', () => {
	expect(failureCode(() => parseProfile(parseHtml('<p>Wartung</p>')))).toBe('LAYOUT_CHANGED');
});
