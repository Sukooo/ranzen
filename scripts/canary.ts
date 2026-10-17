// Runs every app against the live portal and says whose fault each failure is.
// Exit 0: ranzen matches the portal. 1: ranzen needs an update. 2: could not tell (portal, network, account, setup).
// Needs RANZEN_SCHOOL_ID, RANZEN_USERNAME and RANZEN_PASSWORD; prints no personal data.
import { catalog } from '../src/apps/catalog/index.js';
import { lessons } from '../src/apps/lessons/index.js';
import { profile } from '../src/apps/profile/index.js';
import { substitutions } from '../src/apps/substitutions/index.js';
import {
	createPortal,
	faultOf,
	isRanzenError,
	type Connection,
	type Drift,
	type Fault
} from '../src/index.js';

// 'forbidden' is an app this account may not use: an account limit, not a failed check.
type Verdict = 'ok' | 'drift' | 'forbidden' | Fault;

const [schoolId, username, password] = [
	'RANZEN_SCHOOL_ID',
	'RANZEN_USERNAME',
	'RANZEN_PASSWORD'
].map((name) => process.env[name]);
if (!schoolId || !username || !password) {
	console.error('Set RANZEN_SCHOOL_ID, RANZEN_USERNAME and RANZEN_PASSWORD.');
	process.exit(2);
}

const verdicts: Verdict[] = [];
const report = (verdict: Verdict, label: string, detail = '') => {
	verdicts.push(verdict);
	console.log(verdict.padEnd(9), label.padEnd(24), detail);
};

const portal = createPortal({
	userAgent: 'ranzen-canary',
	onDrift: ({ app, detail }: Drift) => report('drift', app, detail)
});

async function check<T>(label: string, work: () => Promise<T>): Promise<T | null> {
	const started = performance.now();
	try {
		const result = await work();
		report('ok', label, `${Math.round(performance.now() - started)}ms`);
		return result;
	} catch (error) {
		if (!isRanzenError(error)) {
			report(faultOf(error), label, error instanceof Error ? error.name : 'crash');
		} else {
			const { failure } = error;
			const detail = failure.code === 'LAYOUT_CHANGED' ? `expected ${failure.expected}` : '';
			const verdict = failure.code === 'FORBIDDEN' ? 'forbidden' : error.fault;
			report(verdict, label, `${failure.code} ${detail}`.trim());
		}
		return null;
	}
}

async function run(connection: Connection): Promise<void> {
	await check('catalog.list', () => connection.open(catalog).list());
	await check('profile.get', () => connection.open(profile).get());
	const api = connection.open(lessons);
	const overview = await check('lessons.overview', () => api.overview());
	const courses = await Promise.all(
		(overview?.courses ?? []).map(({ id }) => check('lessons.course', () => api.course(id)))
	);
	const withFile = courses
		.flatMap((course) => course?.entries.map((entry) => ({ course, entry })) ?? [])
		.find(({ entry }) => entry.files.length);
	if (withFile?.course) {
		const { course, entry } = withFile;
		await check('lessons.download', async () => {
			const file = await api.download({
				course: course.id,
				entry: entry.id,
				file: entry.files[0]!.name
			});
			await file.body.cancel();
		});
	}
	const plan = connection.open(substitutions);
	await check('substitutions.plan', () => plan.plan());
	await check('substitutions.full', () => plan.plan({ full: true }));
	await check('keepAlive', () => connection.keepAlive());
}

const connection = await check('login', () =>
	portal.login({ schoolId: Number(schoolId), username, password })
);
if (connection) {
	try {
		await run(connection);
	} finally {
		await connection.logout().catch(() => {});
	}
}

const broken = verdicts.some((verdict) => verdict === 'ranzen' || verdict === 'drift');
const unsure =
	!connection || verdicts.some((verdict) => verdict !== 'ok' && verdict !== 'forbidden');
process.exit(broken ? 1 : unsure ? 2 : 0);
