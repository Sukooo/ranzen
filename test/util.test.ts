import { expect, test } from 'bun:test';
import { germanDate, isoDate, nonEmpty, parseJson, queryParam } from '../src/util.js';
import { failureCode } from './failure.js';

test('converts between German and ISO dates', () => {
	expect(isoDate('Montag, 1.2.2026')).toBe('2026-02-01');
	expect(isoDate('morgen')).toBeNull();
	expect([isoDate('31.02.2026'), isoDate('29.02.2028'), isoDate('1.13.2026')]).toEqual([
		null,
		'2028-02-29',
		null
	]);
	expect(germanDate('2026-02-01')).toBe('01.02.2026');
});

test('reads parameters of relative portal links', () => {
	const href = 'meinunterricht.php?a=sus_view&id=12#marks';
	expect(queryParam(href, 'id')).toBe('12');
	expect(queryParam(href, 'halb')).toBeNull();
	expect(queryParam('#', 'id')).toBeNull();
	expect(queryParam(undefined, 'id')).toBeNull();
});

test('nonEmpty trims strings and drops the rest', () => {
	expect(nonEmpty('  Mathe ')).toBe('Mathe');
	expect(nonEmpty('  ')).toBeNull();
	expect(nonEmpty(7)).toBeNull();
});

test('parseJson treats anything else as a changed layout', () => {
	expect(parseJson('{"a":1}', 'Test')).toEqual({ a: 1 });
	expect(failureCode(() => parseJson('<html>', 'Test'))).toBe('LAYOUT_CHANGED');
});
