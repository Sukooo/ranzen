export interface Substitution {
	/** ISO calendar date. */
	date: string;
	/** As shown by the portal, e.g. "3 - 4". */
	periods: string;
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
	/** The school's week label, e.g. "A-Woche". */
	week: string | null;
	notices: Notice[];
	substitutions: Substitution[];
	/** Local portal time, e.g. "2026-10-16T11:58:40". */
	updatedAt: string | null;
}
