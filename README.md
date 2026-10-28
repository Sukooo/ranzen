# ranzen

A typed client for Schulportal Hessen (SPH, also known as LANIS). It signs in like the browser
does, keeps the session alive, and reads the portal's apps into plain, typed objects.

```sh
bun add @ranzenjs/client
```

Runs on Bun and Node 22.1 or newer. It has four small dependencies (htmlparser2, domhandler,
css-select, and hash-wasm for Kurswahl Online) and no native code.

## Usage

```ts
import { createPortal } from '@ranzenjs/client';
import { lessons } from '@ranzenjs/client/lessons';
import { substitutions } from '@ranzenjs/client/substitutions';

const portal = createPortal({ onDrift: (drift) => console.warn('ranzen drift', drift) });
const connection = await portal.login({ schoolId: 1234, username: 'max.muster', password });

const app = connection.open(lessons);
const { courses, latest } = await app.overview();
const details = await Promise.all(courses.map((card) => app.course(card.id)));
const days = await connection.open(substitutions).plan();

await connection.logout();
```

### Apps

Every portal feature is an app that you open on a connection. Opening makes no request.

| Import                           | App             | Calls                                                                                        |
| -------------------------------- | --------------- | -------------------------------------------------------------------------------------------- |
| `@ranzenjs/client/lessons`       | Mein Unterricht | `overview()`, `course(id, { semester })`, `setHomeworkDone()`, `download()`, `downloadAll()` |
| `@ranzenjs/client/substitutions` | Vertretungsplan | `plan({ full })`                                                                             |
| `@ranzenjs/client/profile`       | Benutzerdaten   | `get()`                                                                                      |
| `@ranzenjs/client/catalog`       | Start page      | `list()`, `offers(app)`                                                                      |

Schools turn apps on and off. To find out whether an account has an app, ask
`connection.open(catalog).offers(lessons)`.

Every call accepts `{ signal }` for cancellation. Downloads return a `ReadableStream`, so a
large file never sits in memory:

```ts
const file = await connection
	.open(lessons)
	.download({ course: '101', entry: '55', file: 'blatt.pdf' });
await Bun.write('blatt.pdf', new Response(file.body));
```

### Sessions

`exportState()` returns the portal cookies, the session's cipher secret, and the account. It never
includes the password. Store the state encrypted, because whoever holds it is signed in until the
portal session ends. `portal.restore(state)` rebuilds the connection without sending a request.

```ts
const connection = portal.restore(await vault.read(userId));
connection.keepWarm(); // pings every minute while a long job runs
try {
	await sync(connection);
} finally {
	try {
		await vault.write(userId, connection.exportState());
	} finally {
		connection.dispose(); // stops the pings and cancels pending requests; the session stays valid
	}
}
```

`dispose()` keeps the portal session, so the state can be restored later. `logout()` ends the
session on the portal and then disposes. `keepAlive()` reports `SESSION_EXPIRED` when the portal
refuses it, but the portal often answers an ended session like a live one. Only an app call proves
that a session still works, so sign in again when one reports `SESSION_EXPIRED`.

`timeoutMs` (default 15000) bounds each request, including the wait for every chunk of a body.
`maxConcurrency` (default 4) caps parallel requests per connection. Extra calls wait for a free
slot, and a download frees its slot once the headers arrive.

## Kurswahl Online

Many schools run their course timetable on [Kurswahl Online](https://www.kurswahl-online.de/).
Its client stands on its own: a school may use it, Schulportal, or both, and neither needs the
other.

```ts
import { createKurswahl } from '@ranzenjs/client/kurswahl';

const kurswahl = createKurswahl({ onDrift: (drift) => console.warn('ranzen drift', drift) });
const schools = await kurswahl.schools(); // [{ id: 'musterschule', name: '…' }, …], no sign-in needed
const connection = await kurswahl.login({
	school: 'musterschule',
	username: 'max.muster',
	password
});

const plan = await connection.timetable(); // the general plan, A and B weeks included
const week = await connection.timetable({ week: '2025-08-25' }); // one week, one rotation
const rotation = await connection.currentRotation(); // 'A', 'B', or null; this week
await connection.logout();
```

Kurswahl lists only the courses the student takes, so treat it as the source of truth for them.
Each lesson names its course, ISO weekday, period, room and `rotation` (`'A'`, `'B'`, or `null`
for every week). Teachers come with their short code, which Schulportal uses too, and their
salutation. Sign-in hashes the password with Argon2 the way the login page does, which takes a few
seconds of CPU. The week list can still show last school year's dates, so ask
`currentRotation()` for this week's rotation rather than picking a week by date.

`exportState()`, `restore()`, `keepAlive()`, `keepWarm()` and `dispose()` work as they do for
Schulportal, with requests one at a time, since each page hands out the next CSRF token. Export
once the connection is idle, and let one connection at a time use a session.

To line both up, substitution days carry `rotation` next to their `week` label, and each
substitution has `periodNumbers` (`"3 - 4"` → `[3, 4]`). Break duties such as `"2/3"` or `"MP"`
have none.

## Errors

ranzen throws a `RanzenError` with a `code` and a `fault`. The fault says who has to act:

| Fault     | Codes                                                                 | What to do                     |
| --------- | --------------------------------------------------------------------- | ------------------------------ |
| `ranzen`  | `LAYOUT_CHANGED`, `HANDSHAKE_FAILED`, `DECRYPT_FAILED`                | update ranzen or report a bug  |
| `portal`  | `MAINTENANCE`, `RATE_LIMITED`, `PORTAL_ERROR`                         | try again later                |
| `network` | `NETWORK`, `TIMEOUT`                                                  | try again                      |
| `account` | `AUTH_FAILED`, `AUTH_LOCKED`, `SESSION_EXPIRED`, `FORBIDDEN`          | ask the user, or sign in again |
| `caller`  | `ABORTED`, `INVALID_STATE`, `INVALID_OPTION`, `NOT_FOUND`, `DISPOSED` | fix the call                   |

`faultOf(error)` works on anything you catch, and it blames ranzen for errors that are not a
`RanzenError`. Some failures carry details in `error.failure`. `AUTH_LOCKED` has `lockoutSeconds`,
`RATE_LIMITED` has `retryAfterSeconds`, `PORTAL_ERROR` has the portal's German `notice`, and
`LAYOUT_CHANGED` names what ranzen `expected`.

ranzen never retries a request on its own. `retryable` only says that the failure is temporary. It
does not mean that a repeated write is safe, because a timed-out `setHomeworkDone` may already have
reached the portal.

## Drift

The portal changes without notice. When a page has changed but ranzen can still read the parts it
needs, the call succeeds and ranzen reports what it skipped to `onDrift`, once per kind of change
on each connection. Log drift: it means ranzen needs an update before the change breaks reads.

The built-in apps keep personal data out of drift details and error messages. Both may name what
changed, such as an unknown column as the portal labels it, but never the values on the page. The
exceptions are `notice`, which is the portal's own text, and the `cause` of a network error.

In this repository, `bun run canary` runs every app against the live portal. It exits with 0 when
ranzen matches the portal, 1 when ranzen needs an update, and 2 when it cannot tell (for example,
during portal maintenance or on a network failure). It reads its credentials from
`RANZEN_SCHOOL_ID`, `RANZEN_USERNAME` and `RANZEN_PASSWORD`.

## Writing an app

An app is a stateless definition. Its context sends checked requests on the account's session.

```ts
import { defineApp, type SignalOption } from '@ranzenjs/client';
import { one, text } from '@ranzenjs/client/html';

export const messages = defineApp({ id: 'messages', page: 'nachrichten.php' }, (context) => ({
	async unread({ signal }: SignalOption = {}) {
		const document = await context.document({ path: 'nachrichten.php', signal });
		const badge = one('#unread', document);
		if (!badge) context.drift('The messages page has no #unread.');
		return Number(text(badge)) || 0;
	}
}));
```

Requests can only reach the portal. `document()` and `page()` turn the portal's error pages, ended
sessions, and missing scripts into the errors above. `@ranzenjs/client/html` has the parsing helpers that the
built-in apps use.

## Development

```sh
bun install
bun run test     # unit tests against a fake portal
bun run check    # types
bun run build    # dist, then an import check on Node
```

## License

MIT
