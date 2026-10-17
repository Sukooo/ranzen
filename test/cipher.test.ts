import { describe, expect, test } from 'bun:test';
import { isRanzenError } from '../src/errors.js';
import { createSecret, seal, unseal, wrapSecret } from '../src/protocol/cipher.js';
import { Session } from '../src/session.js';
import { Transport } from '../src/transport/http.js';
import { fakeFetch, publicKeyPem, reply, revealSecret } from './fake-portal.js';

const UTF8 = new TextDecoder();

describe('cipher', () => {
	test('seals and unseals OpenSSL envelopes', () => {
		const secret = createSecret();
		const sealed = seal('Mathe LK – Klausur', secret);
		expect(Buffer.from(sealed, 'base64').subarray(0, 8).toString('latin1')).toBe('Salted__');
		expect(UTF8.decode(unseal(sealed, secret) ?? new Uint8Array())).toBe('Mathe LK – Klausur');
		expect(UTF8.decode(unseal(sealed, createSecret()) ?? new Uint8Array())).not.toBe(
			'Mathe LK – Klausur'
		);
		expect(unseal('bm90IHNhbHRlZA==', secret)).toBeNull();
	});

	test('opens an envelope from `openssl enc -aes-256-cbc -md md5`', () => {
		const secret = Buffer.from('ranzen-known-answer-secret-0123456789abcdefgh!');
		const sealed = 'U2FsdGVkX18BAgMEBQYHCOd/eFmv/uqO0mj1BNYy7YvQH7u01q9xAMdJF9rdqQGo';
		expect(UTF8.decode(unseal(sealed, secret) ?? new Uint8Array())).toBe('Mathe LK – Klausur');
	});

	test('wraps the secret for the portal public key', () => {
		const secret = createSecret();
		expect(Buffer.compare(revealSecret(wrapSecret(publicKeyPem, secret)), secret)).toBe(0);
	});
});

describe('Session', () => {
	function session(page: string, contentType = 'text/html; charset=UTF-8') {
		const secret = createSecret();
		const body = page.replaceAll('{sealed}', seal('Geheim', secret));
		const { fetch } = fakeFetch(() => reply(200, body, { 'content-type': contentType }));
		const transport = new Transport({
			fetch,
			userAgent: 'test',
			timeoutMs: 1_000,
			maxConcurrency: 1
		});
		return new Session({ schoolId: 1, username: 'u' }, transport, secret);
	}

	test('decrypts encoded fragments in HTML only', async () => {
		const page = '<p><encoded>{sealed}</encoded></p>';
		const html = await session(page).send({ url: 'https://start.schulportal.hessen.de/x' });
		expect(html.text).toBe('<p>Geheim</p>');
		const json = await session(page, 'application/json').send({
			url: 'https://start.schulportal.hessen.de/x'
		});
		expect(json.text).toContain('<encoded>');
	});

	test('fails loudly on fragments it cannot decrypt', async () => {
		try {
			await session('<encoded>bm90IHNhbHRlZA==</encoded>').send({
				url: 'https://start.schulportal.hessen.de/x'
			});
			throw new Error('Expected a failure');
		} catch (error) {
			expect(isRanzenError(error) && error.code).toBe('DECRYPT_FAILED');
		}
	});
});
