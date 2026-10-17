import { randomInt } from 'node:crypto';
import { RanzenError, fail, layoutChanged } from '../errors.js';
import type { Transport } from '../transport/http.js';
import { createSecret, unseal, wrapSecret } from './cipher.js';
import { MAINTENANCE_NOTICE, PAGES } from './endpoints.js';

export interface Credentials {
	schoolId: number;
	username: string;
	password: string;
}

const AJAX_HEADERS = {
	accept: '*/*',
	'content-type': 'application/x-www-form-urlencoded; charset=UTF-8'
};

// Everything before the bridge runs on a forked jar so only portal cookies reach exported state.
export async function signIn(
	transport: Transport,
	{ schoolId, username, password }: Credentials,
	signal?: AbortSignal
): Promise<void> {
	const gate = transport.fork();
	const home = await gate.send({ url: PAGES.start, redirects: 'manual', signal });
	if (home.text.includes(MAINTENANCE_NOTICE))
		throw fail('MAINTENANCE', 'The portal is unavailable.');

	const attempt = await gate.send({
		url: PAGES.login(schoolId),
		method: 'POST',
		form: { user: `${schoolId}.${username}`, user2: username, password },
		redirects: 'manual',
		signal
	});
	if (!attempt.location) {
		const lock = /id=["']?authErrorLocktime["']?[^>]*>([^<]*)</.exec(attempt.text)?.[1]?.trim();
		if (lock) {
			const seconds = /^\d+$/.test(lock) ? Number(lock) : null;
			throw new RanzenError(
				{ code: 'AUTH_LOCKED', lockoutSeconds: seconds },
				'The account is temporarily locked after failed logins.'
			);
		}
		if (attempt.status !== 200) throw layoutChanged(`the login page, not HTTP ${attempt.status}`);
		throw fail('AUTH_FAILED', 'The portal rejected the credentials.');
	}

	const bridge = await gate.send({ url: PAGES.connect, redirects: 'manual', signal });
	if (!bridge.location) throw layoutChanged('a session handover after sign-in');
	await transport.send({ url: bridge.location, redirects: 'manual', signal });
	if (!transport.jar.get(new URL(PAGES.start), 'sid')) {
		throw layoutChanged('a session cookie after sign-in');
	}
}

export async function handshake(transport: Transport, signal?: AbortSignal): Promise<Uint8Array> {
	const secret = createSecret();
	const keyReply = await transport.send({
		url: PAGES.ajax,
		method: 'POST',
		query: { f: 'rsaPublicKey' },
		headers: AJAX_HEADERS,
		signal
	});
	const challengeReply = await transport.send({
		url: PAGES.ajax,
		method: 'POST',
		query: { f: 'rsaHandshake', s: String(randomInt(2000)) },
		form: { key: wrapFor(jsonField(keyReply.text, 'publickey'), secret) },
		headers: AJAX_HEADERS,
		signal
	});
	const echoed = unseal(jsonField(challengeReply.text, 'challenge'), secret);
	if (!echoed || Buffer.compare(echoed, secret) !== 0)
		throw fail('HANDSHAKE_FAILED', 'The portal failed the key check.');
	return secret;
}

function wrapFor(publicKeyPem: string, secret: Uint8Array): string {
	try {
		return wrapSecret(publicKeyPem, secret);
	} catch (error) {
		throw fail('HANDSHAKE_FAILED', 'The portal sent an unusable public key.', error);
	}
}

function jsonField(text: string, field: string): string {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		throw fail('HANDSHAKE_FAILED', `The portal sent no ${field}.`, error);
	}
	const value: unknown =
		parsed && typeof parsed === 'object'
			? Object.getOwnPropertyDescriptor(parsed, field)?.value
			: undefined;
	if (typeof value !== 'string' || !value) {
		throw fail('HANDSHAKE_FAILED', `The portal sent no ${field}.`);
	}
	return value;
}
