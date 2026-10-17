export type Role = 'student' | 'teacher' | 'parent';

export interface Profile {
	login: string | null;
	firstName: string | null;
	lastName: string | null;
	/** ISO calendar date. */
	birthDate: string | null;
	grade: string | null;
	className: string | null;
	role: Role | null;
	school: string | null;
	/** Every row the school provides, by its portal label, e.g. { Geschlecht: 'weiblich' }. */
	fields: Record<string, string>;
}
