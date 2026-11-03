import { defineApp, type Download } from '../../app.js';
import type { SignalOption } from '../../connection.js';
import { RanzenError, fail } from '../../errors.js';
import { parseCourse, parseOverview, parseSubmission, parseUploadResults } from './parse.js';
import type {
	Course,
	EntryRef,
	Overview,
	SubmissionDetails,
	SubmissionRef,
	SubmitResult
} from './types.js';

export type * from './types.js';

const PAGE = 'meinunterricht.php';
// The portal's upload form has five file inputs.
const MAX_FILES = 5;

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
	/** A hand-in of an entry, by Submission.id: its rules, whether it is open, and the files handed in. */
	submission(target: SubmissionRef, options?: SignalOption): Promise<SubmissionDetails>;
	/**
	 * Hands in up to five files in one upload; not idempotent on retry. Each result says how the
	 * portal took a file, and `submission` is the hand-in the portal shows afterwards.
	 */
	submit(target: SubmissionRef & { files: File[] }, options?: SignalOption): Promise<SubmitResult>;
	/** A handed-in file, by SubmittedFile.id. */
	downloadSubmitted(
		target: SubmissionRef & { file: string },
		options?: SignalOption
	): Promise<Download>;
	/** Deletes a handed-in file; the portal asks for the password again, and AUTH_FAILED means it was wrong. */
	deleteSubmitted(
		target: SubmissionRef & { file: string; password: string },
		options?: SignalOption
	): Promise<void>;
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
	},

	async submission({ course, entry, submission }, { signal } = {}) {
		const document = await context.document({
			path: PAGE,
			query: { a: 'sus_abgabe', b: course, e: entry, id: submission },
			signal
		});
		return parseSubmission(document, context.drift);
	},

	async submit({ course, entry, submission, files }, { signal } = {}) {
		if (!files.length || files.length > MAX_FILES) {
			throw fail('INVALID_OPTION', `submit() takes 1 to ${MAX_FILES} files.`);
		}
		const form = new FormData();
		form.append('a', 'sus_abgabe');
		form.append('b', course);
		form.append('e', entry);
		form.append('id', submission);
		files.forEach((file, index) => form.append(`file${index + 1}`, file, file.name));
		const document = await context.document({ path: PAGE, multipart: form, signal });
		return {
			results: parseUploadResults(
				document,
				files.map((file) => file.name),
				context.drift
			),
			submission: parseSubmission(document, context.drift)
		};
	},

	downloadSubmitted({ course, entry, submission, file }, { signal } = {}) {
		return context.download({
			path: PAGE,
			query: { a: 'downloadFile', id: course, e: entry, abg: submission, f: file },
			signal
		});
	},

	async deleteSubmitted({ course, entry, submission, file, password }, { signal } = {}) {
		const { text } = await context.page({
			path: PAGE,
			form: {
				a: 'sus_abgabe',
				d: 'delete',
				b: course,
				e: entry,
				id: submission,
				f: file,
				pw: context.encrypt(password)
			},
			ajax: true,
			signal
		});
		const answer = text.trim();
		if (answer === '1') return;
		if (answer === '-1') throw fail('AUTH_FAILED', 'The portal did not accept the password.');
		throw new RanzenError(
			{
				code: 'PORTAL_ERROR',
				notice: answer === '-2' ? 'Leider ist die Änderung fehlgeschlagen!' : 'Unbekannter Fehler!'
			},
			'The portal did not delete the file.'
		);
	}
}));
