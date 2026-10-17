import { expect, test } from 'bun:test';
import { parseCatalog } from '../../src/apps/catalog/parse.js';
import { driftLog, failureCode } from '../failure.js';

test('reads built-in and linked apps', () => {
	const { drift, details } = driftLog();
	const apps = parseCatalog(
		JSON.stringify({
			error: '0',
			entrys: [
				{
					Name: 'Mein Unterricht',
					Farbe: '2C3E50',
					Logo: 'fa fa-book',
					Ordner: ['1. Unterricht', 7],
					link: 'meinunterricht.php'
				},
				{ Name: 'Moodle', Farbe: 'red', link: 'index.php?a=f&e=3', target: '_blank' },
				{ Name: 'Fremd', link: 'https://example.com/meinunterricht.php' },
				{ Name: 'Kaputt' },
				{ Name: 'Ungültig', link: 'https://[' },
				'x'
			]
		}),
		drift
	);
	expect(details).toEqual([
		'An app list entry is not an object.',
		'An app list entry has no valid link or name.',
		'An app list entry has no valid link or name.'
	]);
	expect(apps).toEqual([
		{
			name: 'Mein Unterricht',
			color: '#2C3E50',
			icon: 'fa fa-book',
			folders: ['1. Unterricht'],
			url: 'https://start.schulportal.hessen.de/meinunterricht.php',
			page: 'meinunterricht.php',
			opensNewTab: false
		},
		{
			name: 'Moodle',
			color: null,
			icon: null,
			folders: [],
			url: 'https://start.schulportal.hessen.de/index.php?a=f&e=3',
			page: null,
			opensNewTab: true
		},
		{
			name: 'Fremd',
			color: null,
			icon: null,
			folders: [],
			url: 'https://example.com/meinunterricht.php',
			page: null,
			opensNewTab: false
		}
	]);
});

test('rejects anything but an app list', () => {
	expect(failureCode(() => parseCatalog('{"error":"1"}'))).toBe('LAYOUT_CHANGED');
	expect(failureCode(() => parseCatalog('<html>'))).toBe('LAYOUT_CHANGED');
});
