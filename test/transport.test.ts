import { describe, expect, test } from 'bun:test';
import { RanzenError } from '../src/errors.js';
import { Limiter } from '../src/transport/limiter.js';
import { Transport, type Exchange, type FetchFunction } from '../src/transport/http.js';
import { fakeFetch, reply, type Route } from './fake-portal.js';

const start = 'https://start.schulportal.hessen.de/';

function transport(fetch: FetchFunction, timeoutMs = 1_000, maxConcurrency = 4) {
	return new Transport({ fetch, userAgent: 'test', timeoutMs, maxConcurrency });
}

async function failure(work: Promise<unknown>): Promise<RanzenError['failure']> {
	try {
		await work;
	} catch (error) {
		if (error instanceof RanzenError) return error.failure;
		throw error;
	}
	throw new Error('Expected a RanzenError');
}

function send(routes: Route[], exchange: Partial<Exchange> = {}) {
	const fake = fakeFetch(...routes);
	return { ...fake, reply: transport(fake.fetch).send({ url: start, ...exchange }) };
}

describe('Transport', () => {
	test('stores cookies at every hop and turns POST into GET on 302', async () => {
		const { sent, reply: result } = send(
			[
				({ url }) =>
					url === start
						? reply(302, '', { location: '/next', 'set-cookie': 'a=1; Path=/' })
						: undefined,
				({ url }) => (url.endsWith('/next') ? reply(200, 'done') : undefined)
			],
			{ method: 'POST', form: { x: '1' } }
		);
		const { text, url } = await result;

		expect(text).toBe('done');
		expect(url.href).toBe(`${start}next`);
		expect(sent).toEqual([
			{ method: 'POST', url: start, cookie: null, body: 'x=1' },
			{ method: 'GET', url: `${start}next`, cookie: 'a=1', body: null }
		]);
	});

	test('keeps the method and body on 307 and stops at manual redirects', async () => {
		const redirect: Route = ({ url }) =>
			url === start ? reply(307, '', { location: '/again' }) : reply(200, 'ok');
		const followed = send([redirect], { method: 'POST', form: { x: '1' } });
		await followed.reply;
		expect(followed.sent[1]).toMatchObject({ method: 'POST', body: 'x=1' });

		const manual = send([redirect], { redirects: 'manual' });
		const { status, location } = await manual.reply;
		expect([status, location?.href]).toEqual([307, `${start}again`]);
		expect(manual.sent).toHaveLength(1);
	});

	test('refuses hosts outside the portal, including via redirects', async () => {
		const outside = send([() => reply(200)], { url: 'https://example.com/' });
		expect((await failure(outside.reply)).code).toBe('LAYOUT_CHANGED');
		expect(outside.sent).toHaveLength(0);

		const plain = send([() => reply(200)], { url: 'http://start.schulportal.hessen.de/' });
		expect((await failure(plain.reply)).code).toBe('LAYOUT_CHANGED');

		const lookalike = send([
			() => reply(302, '', { location: 'https://evilschulportal.hessen.de/' })
		]);
		expect((await failure(lookalike.reply)).code).toBe('LAYOUT_CHANGED');
		expect(lookalike.sent).toHaveLength(1);

		const garbled = send([() => reply(302, '', { location: 'https://[' })]);
		expect((await failure(garbled.reply)).code).toBe('LAYOUT_CHANGED');

		for (const location of [
			'https://support.schulportal.hessen.de/',
			'https://start.schulportal.hessen.de:8443/'
		]) {
			const other = send([() => reply(302, '', { location })]);
			expect((await failure(other.reply)).code).toBe('LAYOUT_CHANGED');
			expect(other.sent).toHaveLength(1);
		}
	});

	test('maps maintenance, rate limits, and network errors', async () => {
		expect((await failure(send([() => reply(503)]).reply)).code).toBe('MAINTENANCE');
		expect((await failure(send([() => reply(502)]).reply)).code).toBe('MAINTENANCE');
		expect(await failure(send([() => reply(429, '', { 'retry-after': '30' })]).reply)).toEqual({
			code: 'RATE_LIMITED',
			retryAfterSeconds: 30
		});
		expect(
			await failure(
				send([() => reply(429, '', { 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' })]).reply
			)
		).toEqual({ code: 'RATE_LIMITED', retryAfterSeconds: null });
		const offline: FetchFunction = () => Promise.reject(new TypeError('body password=hunter2'));
		try {
			await transport(offline).send({ url: start });
		} catch (error) {
			expect(error instanceof RanzenError && error.code).toBe('NETWORK');
			expect(error instanceof Error && error.message).not.toContain('hunter2');
		}
	});

	test('times out and frees the slot even when fetch ignores the signal', async () => {
		let calls = 0;
		const stalled: FetchFunction = async () => {
			if (++calls === 2) return new Promise<Response>(() => {});
			if (calls === 3) return reply(200, 'ok');
			const body = new ReadableStream<Uint8Array>({
				start: (controller) => controller.enqueue(new TextEncoder().encode('<html>'))
			});
			return new Response(body, { status: 200 });
		};
		const client = transport(stalled, 20, 1);
		expect((await failure(client.send({ url: start }))).code).toBe('TIMEOUT');
		expect((await failure(client.send({ url: start }))).code).toBe('TIMEOUT');
		expect((await client.send({ url: start })).text).toBe('ok');
	});

	test('reports caller aborts in flight and while waiting for a slot', async () => {
		const hanging: FetchFunction = (_url, init) =>
			new Promise((_resolve, reject) =>
				init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
			);
		const client = transport(hanging, 1_000, 1);
		const first = new AbortController();
		const second = new AbortController();
		const running = client.send({ url: start, signal: first.signal });
		const queued = client.send({ url: start, signal: second.signal });

		second.abort();
		expect((await failure(queued)).code).toBe('ABORTED');
		first.abort();
		expect((await failure(running)).code).toBe('ABORTED');
	});

	test('cancels bodies that a timeout or abort leaves behind', async () => {
		const cancelled: string[] = [];
		const body = (name: string, chunks = 0) =>
			new ReadableStream<Uint8Array>({
				start: (controller) => {
					for (let i = 0; i < chunks; i++) controller.enqueue(new Uint8Array([i]));
				},
				cancel: () => void cancelled.push(name)
			});
		const stalledText = transport(async () => new Response(body('text')), 20);
		expect((await failure(stalledText.send({ url: start }))).code).toBe('TIMEOUT');

		const late = transport(async () => {
			await Bun.sleep(40);
			return new Response(body('late'));
		}, 20);
		expect((await failure(late.send({ url: start }))).code).toBe('TIMEOUT');

		const controller = new AbortController();
		const download = await transport(async () => new Response(body('stream', 2))).stream({
			url: start,
			signal: controller.signal
		});
		controller.abort();
		expect((await failure(download.body.getReader().read())).code).toBe('ABORTED');

		await Bun.sleep(40);
		expect(cancelled.toSorted()).toEqual(['late', 'stream', 'text']);
	});

	test('a fork shares slots but not cookies', async () => {
		const fake = fakeFetch(() => reply(200, '', { 'set-cookie': 'gate=1; Path=/' }));
		const main = transport(fake.fetch);
		await main.fork().send({ url: start });
		expect(main.jar.header(new URL(start))).toBe('');
	});
});

describe('Limiter', () => {
	test('never runs more tasks than slots and hands freed slots on in order', async () => {
		const limiter = new Limiter(2);
		let active = 0;
		let peak = 0;
		const started: number[] = [];
		await Promise.all(
			[1, 2, 3, 4, 5].map((n) =>
				limiter.run(async () => {
					started.push(n);
					peak = Math.max(peak, ++active);
					await Bun.sleep(n % 2 ? 5 : 1);
					active--;
				})
			)
		);
		expect(peak).toBe(2);
		expect(started).toEqual([1, 2, 3, 4, 5]);
	});

	test('drops an aborted waiter without losing the slot', async () => {
		const limiter = new Limiter(1);
		let release = () => {};
		const holder = limiter.run(() => new Promise<void>((resolve) => (release = resolve)));
		const controller = new AbortController();
		const waiter = limiter.run(async () => 'never', controller.signal);
		controller.abort(new Error('stop'));
		expect(waiter).rejects.toThrow('stop');

		release();
		await holder;
		expect(await limiter.run(async () => 'next')).toBe('next');
	});
});
