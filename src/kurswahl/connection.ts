import type { Drift } from '../app.js';
import type { SignalOption } from '../connection.js';
import { fail, isRanzenError, layoutChanged } from '../errors.js';
import { positive } from '../util.js';
import { parseHtml } from '../html.js';
import { isGeneralPlan, parseTimetable, timetableDatabase } from './parse.js';
import type { KurswahlAccount, KurswahlSession } from './session.js';
import { writeKurswahlState } from './state.js';
import type { Rotation, Timetable } from './types.js';

export interface TimetableOptions extends SignalOption {
	/** First day of a week the portal offers, as ISO date, e.g. "2025-08-25"; omit for the general plan. */
	week?: string;
}

/** One signed-in Kurswahl session. Save it with exportState(), end it with logout(). */
export class KurswahlConnection {
	readonly #session: KurswahlSession;
	readonly #onDrift: ((drift: Drift) => void) | undefined;
	readonly #drifted = new Set<string>();
	#heartbeat: ReturnType<typeof setInterval> | undefined;
	#beating = false;

	constructor(session: KurswahlSession, onDrift?: (drift: Drift) => void) {
		this.#session = session;
		this.#onDrift = onDrift;
	}

	get account(): KurswahlAccount {
		return this.#session.account;
	}

	/**
	 * The personal timetable. The general plan lists every lesson, both rotations included;
	 * a dated week shows only the lessons of that week's rotation.
	 */
	async timetable({ week, signal }: TimetableOptions = {}): Promise<Timetable> {
		const value = week === undefined ? '0' : weekValue(week);
		const session = this.#session;
		// The timetable form names its database; the first visit learns it.
		if (!session.database) {
			const first = await session.page('stundenplan.php', {}, signal);
			session.database = timetableDatabase(parseHtml(first.text));
		}
		const { text } = await session.page(
			'stundenplan.php',
			{ woche: value, db_name: session.database, show_optimierung: 'false' },
			signal
		);
		const timetable = parseTimetable(text, (detail) => this.#drift(detail));
		session.database = timetable.database;
		if (week !== undefined && timetable.week?.start !== week) {
			throw fail('NOT_FOUND', 'Kurswahl Online does not offer this week.');
		}
		// A single week holds only one rotation, so passing it off as the general plan would lose lessons.
		if (week === undefined && !isGeneralPlan(text)) throw layoutChanged('the general plan');
		return timetable;
	}

	/**
	 * This week's rotation, read from the plan Kurswahl shows by default, which is the current week.
	 * Null when that week has no A/B lessons, e.g. for a student without alternating courses.
	 */
	async currentRotation({ signal }: SignalOption = {}): Promise<Rotation | null> {
		const { text } = await this.#session.page('stundenplan.php', {}, signal);
		const timetable = parseTimetable(text, (detail) => this.#drift(detail));
		this.#session.database = timetable.database;
		if (timetable.week || isGeneralPlan(text)) throw layoutChanged('the current week');
		const rotations = new Set(timetable.lessons.map((lesson) => lesson.rotation));
		rotations.delete(null);
		if (rotations.size > 1) throw layoutChanged('a single rotation in the current week');
		return [...rotations][0] ?? null;
	}

	/** Extends the session; throws SESSION_EXPIRED once Kurswahl has ended it. */
	async keepAlive({ signal }: SignalOption = {}): Promise<void> {
		await this.#session.ajax('index.php', { ajax: 'keepalive' }, signal);
	}

	/** Pings Kurswahl on an interval, as its pages do; stops on dispose() or a lasting failure. */
	keepWarm(intervalMs = 60_000): void {
		this.#session.ensureOpen();
		positive(intervalMs, 'intervalMs');
		clearInterval(this.#heartbeat);
		this.#heartbeat = setInterval(() => {
			if (this.#beating) return;
			this.#beating = true;
			this.keepAlive()
				.catch((error: unknown) => {
					if (!isRanzenError(error) || !error.retryable) clearInterval(this.#heartbeat);
				})
				.finally(() => (this.#beating = false));
		}, intervalMs);
		this.#heartbeat.unref();
	}

	/** Cookies, CSRF token and identity; never the password. Store it encrypted. */
	exportState(): string {
		const session = this.#session;
		session.ensureOpen();
		return writeKurswahlState({
			account: session.account,
			token: session.token,
			database: session.database,
			cookies: session.transport.jar.snapshot()
		});
	}

	/** Stops keepWarm() and cancels pending requests; the session stays valid for restore(). */
	dispose(): void {
		clearInterval(this.#heartbeat);
		this.#heartbeat = undefined;
		this.#session.dispose();
	}

	/** Leaves through the logout link, then disposes. */
	async logout({ signal }: SignalOption = {}): Promise<void> {
		try {
			await this.#session.leave(signal);
		} finally {
			this.dispose();
		}
	}

	// Once per kind and connection, so a timetable read in a loop does not flood the hook.
	#drift(detail: string): void {
		if (!this.#onDrift || this.#drifted.has(detail)) return;
		this.#drifted.add(detail);
		try {
			this.#onDrift({ app: 'kurswahl', detail });
		} catch {
			// A failing log hook must not fail a read that succeeded.
		}
	}
}

// "2025-08-25" → "25_08_2025", the portal's week value.
function weekValue(week: string): string {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(week);
	if (!match) throw fail('INVALID_OPTION', 'week must be an ISO date such as "2025-08-25".');
	return `${match[3]}_${match[2]}_${match[1]}`;
}
