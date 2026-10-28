import type { Rotation } from '../../rotation.js';

export type { Rotation };

export interface Substitution {
	/** ISO calendar date. */
	date: string;
	/** As shown by the portal, e.g. "3 - 4", "2/3" or "MP". */
	periods: string;
	/**
	 * The lesson periods, e.g. [3, 4] for "3 - 4". Empty for break duties such as "2/3"
	 * (between periods 2 and 3) or "MP" (lunch break), and for labels ranzen cannot read.
	 */
	periodNumbers: number[];
	classes: string | null;
	previousClasses: string | null;
	substitute: string | null;
	teacher: string | null;
	/** Short codes, which the full plan carries next to the names, e.g. "MUS". */
	substituteCode: string | null;
	teacherCode: string | null;
	kind: string | null;
	subject: string | null;
	previousSubject: string | null;
	room: string | null;
	previousRoom: string | null;
	note: string | null;
	secondNote: string | null;
	group: string | null;
	/** Fields the school marked, by name, e.g. ["room"]. */
	highlighted: (keyof Substitution)[];
}

export interface Notice {
	title: string;
	lines: string[];
}

export interface Day {
	date: string;
	/** The school's week label, e.g. "A-Woche" or "WA-Woche". */
	week: string | null;
	/** The week label as A/B rotation; null without a label or for one ranzen cannot read. */
	rotation: Rotation | null;
	notices: Notice[];
	substitutions: Substitution[];
	/** Local portal time, e.g. "2026-10-16T11:58:40". */
	updatedAt: string | null;
}
