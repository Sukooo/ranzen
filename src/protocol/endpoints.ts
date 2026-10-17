const START = 'https://start.schulportal.hessen.de';

export const PAGES = {
	start: `${START}/`,
	ajax: `${START}/ajax.php`,
	keepAlive: `${START}/ajax_login.php`,
	logout: `${START}/index.php?logout=all`,
	connect: 'https://connect.schulportal.hessen.de/',
	login: (schoolId: number) => `https://login.schulportal.hessen.de/?i=${schoolId}`
} as const;

export const MAINTENANCE_NOTICE =
	'Der Bereich der pädagogischen Organisation steht Ihnen aktuell nicht zur Verfügung.';
