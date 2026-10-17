export interface Teacher {
	/** The school's short code, e.g. "Mül". */
	code: string | null;
	firstName: string | null;
	lastName: string | null;
}

export interface Periods {
	from: number;
	to: number;
	/** The portal's wording, unchanged, e.g. "1. - 2. Stunde". */
	label: string;
}

export interface Homework {
	text: string;
	done: boolean;
}

export interface EntryFile {
	name: string;
	extension: string | null;
	/** As shown by the portal, e.g. "1,13 MB". */
	size: string | null;
}

export interface Submission {
	id: string;
	name: string;
	open: boolean;
	/** The portal's badge, e.g. "2" files handed in; null without one. */
	uploaded: string | null;
	/** Deadline of an open submission as ISO date or local date-time, e.g. "2026-10-20T23:59". */
	due: string | null;
}

export interface Entry {
	id: string;
	/** ISO calendar date, e.g. "2026-09-24". */
	date: string | null;
	periods: Periods | null;
	topic: string | null;
	content: string | null;
	homework: Homework | null;
	files: EntryFile[];
	submissions: Submission[];
	/** The portal's own wording, e.g. "anwesend"; null when not recorded. */
	attendance: string | null;
}

export interface CourseRef {
	id: string;
	name: string;
}

export interface CourseCard extends CourseRef {
	teachers: Teacher[];
	marks: number;
	undoneHomework: number;
	upcomingEntries: number;
}

export interface LatestEntry {
	course: CourseRef;
	teachers: Teacher[];
	entry: Entry;
}

export interface AttendanceSummary {
	course: CourseRef;
	semester: number | null;
	teachers: Teacher[];
	/** Hours per portal label, e.g. { anwesend: 20, entschuldigt: 2 }. */
	hours: Record<string, number>;
}

export interface Overview {
	courses: CourseCard[];
	latest: LatestEntry[];
	attendance: AttendanceSummary[];
}

export interface Mark {
	name: string;
	/** As shown by the portal, which omits the year, e.g. "Do, 17.09.". */
	date: string;
	value: string;
	comment: string | null;
}

export interface Exam {
	/** ISO calendar date. */
	date: string | null;
	/** e.g. "Klausur". */
	kind: string;
	/** As announced, e.g. "3., 4., 5. Std."; only upcoming exams carry it. */
	periods: string | null;
	upcoming: boolean;
}

export interface Course extends CourseRef {
	semester: number | null;
	teachers: Teacher[];
	entries: Entry[];
	marks: Mark[];
	exams: Exam[];
	attendance: Record<string, number>;
	/** Whether the portal links this course's first semester. */
	hasFirstSemester: boolean;
}

export interface EntryRef {
	course: string;
	entry: string;
}
