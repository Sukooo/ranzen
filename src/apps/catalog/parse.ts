import { layoutChanged } from '../../errors.js';
import { PAGES } from '../../protocol/endpoints.js';
import { ignoreDrift, isRecord, nonEmpty, parseJson, type DriftSink } from '../../util.js';
import type { PortalApp } from './types.js';

const PORTAL = new URL(PAGES.start).origin;

export function parseCatalog(body: string, drift: DriftSink = ignoreDrift): PortalApp[] {
	const data = parseJson(body, 'the app list');
	if (!isRecord(data) || !Array.isArray(data.entrys)) {
		throw layoutChanged('the app list as an object with entrys');
	}
	const entries = data.entrys.filter(isRecord);
	if (entries.length < data.entrys.length) drift('An app list entry is not an object.');
	return entries.flatMap((entry) => {
		const link = nonEmpty(entry.link);
		const name = nonEmpty(entry.Name);
		const url = link && URL.parse(link, PAGES.start);
		if (!url || !name) {
			drift('An app list entry has no valid link or name.');
			return [];
		}
		const color = nonEmpty(entry.Farbe)?.replace(/^#?/, '#') ?? null;
		const builtIn =
			url.origin === PORTAL && url.pathname !== '/index.php' && url.pathname.endsWith('.php');
		return [
			{
				name,
				color: color && /^#[0-9a-f]{3,8}$/i.test(color) ? color : null,
				icon: nonEmpty(entry.Logo),
				folders: Array.isArray(entry.Ordner)
					? entry.Ordner.filter((folder) => typeof folder === 'string')
					: [],
				url: url.href,
				page: builtIn ? url.pathname.slice(1) : null,
				opensNewTab: entry.target === '_blank'
			}
		];
	});
}
