import { defineApp } from '../../app.js';
import type { SignalOption } from '../../connection.js';
import { fail } from '../../errors.js';
import { isIsoDate, parseCategories, parseEventDetails, parseEvents } from './parse.js';
import type { CalendarCategory, CalendarEvent, CalendarEventDetails, DateRange } from './types.js';

export type * from './types.js';

const PAGE = 'kalender.php';

export interface CalendarApi {
	/** Events overlapping the inclusive range, once per id, in the portal's order. */
	events(range: DateRange, options?: SignalOption): Promise<CalendarEvent[]>;
	/** The categories events refer to by categoryId. */
	categories(options?: SignalOption): Promise<CalendarCategory[]>;
	/** Who is responsible for an event and whom it addresses; NOT_FOUND for an unknown id. */
	details(id: string, options?: SignalOption): Promise<CalendarEventDetails>;
}

/** "Kalender": the school's events and dates. */
export const calendar = defineApp<CalendarApi>({ id: 'calendar', page: PAGE }, (context) => ({
	async events({ from, to }, { signal } = {}) {
		if (!isIsoDate(from) || !isIsoDate(to)) {
			throw fail('INVALID_OPTION', 'from and to must be ISO dates such as "2026-10-19".');
		}
		if (from > to) throw fail('INVALID_OPTION', 'from must not be after to.');
		const { text } = await context.page({
			path: PAGE,
			// The portal returns the events overlapping both dates, inclusive.
			form: { f: 'getEvents', start: from, end: to, s: '' },
			ajax: true,
			signal
		});
		// An all-day end read as exclusive can move an event out of the range.
		return parseEvents(text, context.drift).filter(
			(event) => event.startDate <= to && event.endDate >= from
		);
	},

	async categories({ signal } = {}) {
		const { text } = await context.page({ path: PAGE, signal });
		return parseCategories(text, context.drift);
	},

	async details(id, { signal } = {}) {
		if (!id.trim()) throw fail('INVALID_OPTION', 'The event id must not be empty.');
		const { text } = await context.page({
			path: PAGE,
			form: { f: 'getEvent', id },
			ajax: true,
			signal
		});
		return parseEventDetails(text, context.drift);
	}
}));
