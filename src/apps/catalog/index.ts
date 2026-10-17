import { defineApp, type AppInfo } from '../../app.js';
import type { SignalOption } from '../../connection.js';
import { parseCatalog } from './parse.js';
import type { PortalApp } from './types.js';

export type * from './types.js';

export interface CatalogApi {
	/** Every app tile on the start page, including links to services outside the portal. */
	list(options?: SignalOption): Promise<PortalApp[]>;
	/** Whether the account's school offers the app; apps without a page are always offered. */
	offers(app: AppInfo, options?: SignalOption): Promise<boolean>;
}

/** The apps the portal start page lists for this account. */
export const catalog = defineApp<CatalogApi>({ id: 'catalog', page: null }, (context) => {
	const list = async ({ signal }: SignalOption = {}) => {
		const { text } = await context.page({
			path: 'startseite.php',
			query: { a: 'ajax', f: 'apps' },
			ajax: true,
			signal
		});
		return parseCatalog(text, context.drift);
	};
	return {
		list,
		async offers(app, options) {
			return app.page === null || (await list(options)).some(({ page }) => page === app.page);
		}
	};
});
