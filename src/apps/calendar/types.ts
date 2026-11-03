export interface DateRange {
	/** ISO calendar date, e.g. "2026-10-01". */
	from: string;
	/** ISO calendar date, inclusive. */
	to: string;
}

/**
 * One occurrence; the portal has no recurrence. Dates and times are the portal's
 * Europe/Berlin wall clock, as written, never converted through UTC.
 */
export interface CalendarEvent {
	id: string;
	title: string;
	/** Plain text, with line breaks kept. */
	description: string | null;
	location: string | null;
	/** Refers to CalendarCategory.id. */
	categoryId: string | null;
	/** The course or group the event belongs to, e.g. "Q1 Mathematik". */
	group: string | null;
	allDay: boolean;
	/** ISO calendar date, e.g. "2026-10-19". */
	startDate: string;
	/** ISO calendar date, inclusive; never before startDate. */
	endDate: string;
	/** "HH:MM"; null for all-day events. */
	startTime: string | null;
	/** "HH:MM"; null for all-day events and for events the portal gives no end. */
	endTime: string | null;
	/** Last change as local portal time, e.g. "2026-10-16T11:58:40". */
	updatedAt: string | null;
	/** The portal's own flags: Neu, Oeffentlich, Privat and Geheim. */
	isNew: boolean;
	isPublic: boolean;
	isPrivate: boolean;
	isSecret: boolean;
}

export interface CalendarCategory {
	id: string;
	name: string;
	/** CSS hex color, e.g. "#25599a". */
	color: string | null;
}

export interface CalendarEventDetails {
	id: string;
	/** Display name of the person responsible; may name a person, so review it before logging. */
	responsible: string | null;
	/** Whom the event addresses, as the portal labels the groups. */
	targetGroups: string[];
}
