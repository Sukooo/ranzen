import { defineApp } from '../../app.js';
import type { SignalOption } from '../../connection.js';
import { germanDate } from '../../util.js';
import { parseFullPlan, parsePlan } from './parse.js';
import type { Day } from './types.js';

export type * from './types.js';

const PAGE = 'vertretungsplan.php';

export interface PlanOptions extends SignalOption {
	/** The whole school's plan instead of the account's own; not every account may read it. */
	full?: boolean;
}

export interface SubstitutionsApi {
	/** The days the portal lists, in its order; a day without substitutions has an empty list. */
	plan(options?: PlanOptions): Promise<Day[]>;
}

/** "Vertretungsplan": the substitution plan for the coming school days. */
export const substitutions = defineApp<SubstitutionsApi>(
	{ id: 'substitutions', page: PAGE },
	(context) => ({
		async plan({ full = false, signal } = {}) {
			const days = parsePlan(await context.document({ path: PAGE, signal }), context.drift);
			if (!full) return days;
			return Promise.all(
				days.map(async (day) => {
					const { text } = await context.page({
						path: PAGE,
						query: { a: 'my' },
						form: { tag: germanDate(day.date), ganzerPlan: 'true' },
						ajax: true,
						signal
					});
					return { ...day, substitutions: parseFullPlan(text, day.date, context.drift) };
				})
			);
		}
	})
);
