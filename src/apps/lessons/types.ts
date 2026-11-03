export interface Teacher {
	/** The school's short code, e.g. "Mül". */
	code: string | null;
	firstName: string | null;
	lastName: string | null;
}

export interface Periods {
	/** Null with `to` when the label names no period numbers, e.g. "08:00 - 09:30". */
	from: number | null;
	to: number | null;
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
	/** As written, so it can serve as a key. */
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
	/** As written, like `date`, so it can serve as a key. */
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
	/** Id the portal links for this course's first semester; read it with `course(id, { semester: 1 })`. */
	firstSemester: string | null;
}

export interface EntryRef {
	course: string;
	entry: string;
}

export interface SubmissionRef extends EntryRef {
	/** Submission.id of the entry, e.g. "1". */
	submission: string;
}

export interface SubmittedFile {
	/** For downloadSubmitted() and deleteSubmitted(); null once the portal has deleted the file. */
	id: string | null;
	name: string;
	/** Local date-time of the upload, e.g. "2026-10-28T13:55". */
	uploaded: string | null;
	/** The portal offers to delete it, which takes the account password. */
	deletable: boolean;
}

export interface SubmissionDetails {
	id: string;
	/** As written, matching Submission.name. */
	name: string;
	course: CourseRef;
	entry: string;
	/** Local date-times the portal accepts files between, e.g. "2026-11-04T15:30". */
	opens: string | null;
	due: string | null;
	/** The portal accepts files right now. */
	open: boolean;
	/** Files one submit() may carry; 0 while closed. */
	slots: number;
	/** Null when the page does not say. */
	multipleFiles: boolean | null;
	repeatable: boolean | null;
	/** As shown, e.g. "Lehrkräfte der Kursmappe". */
	visibleTo: string | null;
	/** ISO calendar date the portal deletes the files on. */
	deletesOn: string | null;
	/** Upper-case extensions, e.g. ["PDF", "PNG"]; empty when the page names none. */
	fileTypes: string[];
	/** As shown, e.g. "10,00 MB". */
	maxSize: string | null;
	/** maxSize in decimal bytes, so never above what the portal accepts. */
	maxBytes: number | null;
	/** The hint above the upload form, e.g. how to name files; null while closed. */
	notice: string | null;
	files: SubmittedFile[];
}

export interface UploadResult {
	/** The file name as the portal lists it. */
	name: string;
	ok: boolean;
	/** The portal's label, e.g. "erfolgreich". */
	status: string;
	/** e.g. that the portal renamed a file whose name was taken. */
	message: string | null;
}
