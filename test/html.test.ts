import { expect, test } from 'bun:test';
import { hasClass, one, parseHtml, stripTags, text } from '../src/html.js';

test('text separates blocks and cells', () => {
	const body = parseHtml(
		'<p>Erstens</p><p>Zweitens<br><br>Absatz</p><ul><li>a<li>b</ul><table><tr><td>1<td>2</table>'
	);
	expect(text(body)).toBe('Erstens Zweitens Absatz a b 1 2');
	expect(text(body, true)).toBe('Erstens\nZweitens\n\nAbsatz\na\nb\n1 2');
});

test('hasClass matches whole class names only', () => {
	const icon = one('i', parseHtml('<i class="fa  fa-user-circle"></i>'));
	expect(hasClass(icon, 'fa-user-circle')).toBe(true);
	expect(hasClass(icon, 'fa-user')).toBe(false);
	expect(hasClass(null, 'fa')).toBe(false);
});

test('stripTags keeps the text and decodes entities', () => {
	expect(stripTags('<del>Mül</del> &amp; <b>Kim</b>')).toBe('Mül & Kim');
});
