import { constants, generateKeyPairSync, privateDecrypt } from 'node:crypto';
import { seal } from '../src/protocol/cipher.js';
import type { FetchFunction } from '../src/transport/http.js';

export interface Sent {
	method: string;
	url: string;
	cookie: string | null;
	body: string | null;
}

export type Route = (request: Sent) => Response | Promise<Response> | undefined;

const keys = generateKeyPairSync('rsa', { modulusLength: 1024 });
export const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();

// Runtimes refuse PKCS#1 v1.5 private decryption, so strip the 00 02 <random> 00 padding by hand.
export function revealSecret(wrapped: string): Buffer {
	const block = privateDecrypt(
		{ key: keys.privateKey, padding: constants.RSA_NO_PADDING },
		Buffer.from(wrapped, 'base64')
	);
	if (block[0] !== 0 || block[1] !== 2) throw new Error('Not PKCS#1 v1.5 padded');
	return block.subarray(block.indexOf(0, 2) + 1);
}

export function reply(status: number, body = '', headers: Record<string, string | string[]> = {}) {
	const list = new Headers();
	for (const [name, value] of Object.entries(headers)) {
		for (const item of [value].flat()) list.append(name, item);
	}
	return new Response(status === 204 ? null : body, { status, headers: list });
}

// A scripted Schulportal: routes run in order, the first defined answer wins.
export function fakeFetch(...routes: Route[]): { fetch: FetchFunction; sent: Sent[] } {
	const sent: Sent[] = [];
	const fetch: FetchFunction = async (url, init) => {
		init.signal?.throwIfAborted();
		const request: Sent = {
			method: init.method ?? 'GET',
			url,
			cookie: new Headers(init.headers).get('cookie'),
			body: typeof init.body === 'string' ? init.body : null
		};
		sent.push(request);
		for (const route of routes) {
			const response = await route(request);
			if (response) return response;
		}
		throw new Error(`Unexpected ${request.method} ${url}`);
	};
	return { fetch, sent };
}

export interface PortalScript {
	password?: string;
	lockText?: string;
	challenge?: (secret: Buffer) => string;
}

export function portalRoutes({
	password = 'geheim!pw',
	lockText,
	challenge
}: PortalScript = {}): Route {
	return ({ method, url, body }) => {
		const form = new URLSearchParams(body ?? '');
		if (method === 'GET' && url === 'https://start.schulportal.hessen.de/') {
			return reply(200, '<html>Schulportal</html>');
		}
		if (method === 'POST' && url.startsWith('https://login.schulportal.hessen.de/?i=')) {
			if (form.get('password') !== password) {
				const lock = lockText ? `<span id="authErrorLocktime">${lockText}</span>` : '';
				return reply(200, `<form>Login fehlgeschlagen ${lock}</form>`);
			}
			return reply(302, '', {
				location: 'https://connect.schulportal.hessen.de/',
				'set-cookie': 'SPH-Login=gate; Domain=.schulportal.hessen.de; Path=/; Secure'
			});
		}
		if (url === 'https://connect.schulportal.hessen.de/') {
			return reply(302, '', { location: 'https://start.schulportal.hessen.de/?t=bridge' });
		}
		if (url === 'https://start.schulportal.hessen.de/?t=bridge') {
			return reply(302, '', {
				location: '/index.php',
				'set-cookie': 'sid=session-1; Path=/; Secure; HttpOnly'
			});
		}
		if (url === 'https://start.schulportal.hessen.de/ajax.php?f=rsaPublicKey') {
			return reply(200, JSON.stringify({ publickey: publicKeyPem }));
		}
		if (url.startsWith('https://start.schulportal.hessen.de/ajax.php?f=rsaHandshake&s=')) {
			const secret = revealSecret(form.get('key') ?? '');
			return reply(200, JSON.stringify({ challenge: (challenge ?? ((s) => seal(s, s)))(secret) }));
		}
		return undefined;
	};
}
