import { defineApp } from '../../app.js';
import type { SignalOption } from '../../connection.js';
import { parseProfile } from './parse.js';
import type { Profile } from './types.js';

export type * from './types.js';

const PAGE = 'benutzerverwaltung.php';

export interface ProfileApi {
	/** Reads the account's data page; schools decide which fields it shows. */
	get(options?: SignalOption): Promise<Profile>;
}

/** The account's own data as stored by the school. */
export const profile = defineApp<ProfileApi>({ id: 'profile', page: null }, (context) => ({
	async get({ signal } = {}) {
		return parseProfile(
			await context.document({ path: PAGE, query: { a: 'userData' }, signal }),
			context.drift
		);
	}
}));
