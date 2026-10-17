import { defineApp, type Download } from '../../app.js';
import type { SignalOption } from '../../connection.js';
import { RanzenError } from '../../errors.js';
import { parseCourse, parseOverview } from './parse.js';
import type { Course, EntryRef, Overview } from './types.js';

export type * from './types.js';

const PAGE = 'meinunterricht.php';

export interface CourseOptions extends SignalOption {
	/** Reads an earlier semester of the same course, e.g. 1 while in the second. */
	semester?: number;
}

export interface LessonsApi {
	/** Course cards, latest entries and attendance, all from one request. */
	overview(options?: SignalOption): Promise<Overview>;
	/** Entries, marks, exams and attendance of one course, by the id of its card. */
	course(id: string, options?: CourseOptions): Promise<Course>;
	/** Checks or unchecks homework; not idempotent on retry, as a timed-out call may have landed. */
	setHomeworkDone(target: EntryRef & { done: boolean }, options?: SignalOption): Promise<void>;
	/** One file of an entry, by its name in EntryFile.name; the body streams. */
	download(target: EntryRef & { file: string }, options?: SignalOption): Promise<Download>;
	/** Every file of an entry as one zip archive. */
	downloadAll(target: EntryRef, options?: SignalOption): Promise<Download>;
}

/** "Mein Unterricht": course folders, entries, homework, marks and attendance. */
export const lessons = defineApp<LessonsApi>({ id: 'lessons', page: PAGE }, (context) => ({
	async overview({ signal } = {}) {
		return parseOverview(await context.document({ path: PAGE, signal }), context.drift);
	},

	async course(id, { semester, signal } = {}) {
		const query: Record<string, string> = { a: 'sus_view', id };
		if (semester !== undefined) query.halb = String(semester);
		return parseCourse(await context.document({ path: PAGE, query, signal }), id, context.drift);
	},

	async setHomeworkDone({ course, entry, done }, { signal } = {}) {
		const { text } = await context.page({
			path: PAGE,
			form: { a: 'sus_homeworkDone', id: course, entry, b: done ? 'done' : 'undone' },
			ajax: true,
			signal
		});
		if (text.trim() !== '1') {
			throw new RanzenError(
				{
					code: 'PORTAL_ERROR',
					notice: 'Die Hausaufgabenänderung konnte leider nicht gespeichert werden!'
				},
				'The portal did not save the homework state.'
			);
		}
	},

	download({ course, entry, file }, { signal } = {}) {
		return context.download({
			path: PAGE,
			query: { a: 'downloadFile', id: course, e: entry, f: file },
			signal
		});
	},

	downloadAll({ course, entry }, { signal } = {}) {
		return context.download({
			path: PAGE,
			query: { a: 'downloadFile', b: 'zip', id: course, e: entry },
			signal
		});
	}
}));
