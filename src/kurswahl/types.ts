import type { Rotation } from '../rotation.js';

export type { Rotation };

/** ISO weekday, 1 = Monday. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface School {
	/** The subdomain, e.g. "musterschule" for musterschule.kurswahl-online.de. */
	id: string;
	name: string;
}

export interface KurswahlTeacher {
	/** The school's short code, the same one SPH uses, e.g. "Mu". */
	code: string | null;
	/** As written, e.g. "McLeod"; named like the SPH teacher field. */
	lastName: string | null;
	salutation: 'Frau' | 'Herr' | null;
}

export interface KurswahlCourse {
	/** Kurswahl's "Realkurs" number; unrelated to SPH course ids. */
	id: string;
	/** The "Leiste" the course runs in. */
	block: number | null;
	/** The short name shown in the timetable, e.g. "M-LK" or "TUT". */
	code: string;
	/** The long name as written, e.g. "MATHEMATIK" or "Politik&Wirtschaft". */
	title: string | null;
	level: 'LK' | 'GK' | null;
	teacher: KurswahlTeacher;
}

export interface KurswahlLesson {
	/** A KurswahlCourse id. */
	course: string;
	day: Weekday;
	/** The period number, as SPH counts them. */
	period: number;
	room: string | null;
	/** Null when the lesson takes place every week. */
	rotation: Rotation | null;
}

export interface PeriodTime {
	period: number;
	/** Local time, e.g. "08:00". */
	start: string | null;
	end: string | null;
}

export interface Week {
	/** The portal's value, e.g. "25_08_2025". */
	id: string;
	/** ISO calendar dates. */
	start: string;
	end: string;
}

export interface Timetable {
	/** The timetable database, e.g. "musterschule_stundenplan_1". */
	database: string;
	/** The week shown; null for the general plan. */
	week: Week | null;
	/** Weeks the portal offers; schools sometimes leave last year's dates here, so prefer rotation. */
	weeks: Week[];
	periods: PeriodTime[];
	courses: KurswahlCourse[];
	lessons: KurswahlLesson[];
	/** Local portal time of the last timetable change, e.g. "2026-08-27T12:12:51". */
	updatedAt: string | null;
	/** Local portal time of the last course assignment change. */
	assignedAt: string | null;
	/** Local portal time of the last exam plan change. */
	examsUpdatedAt: string | null;
}
