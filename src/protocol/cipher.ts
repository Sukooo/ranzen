import {
	constants,
	createCipheriv,
	createDecipheriv,
	createHash,
	publicEncrypt,
	randomBytes
} from 'node:crypto';

// The portal speaks jCryption: an RSA-wrapped secret, then CryptoJS/OpenSSL "Salted__" AES-256-CBC.
const SALTED = Buffer.from('Salted__', 'latin1');
const SECRET_BYTES = 46;

export function createSecret(): Uint8Array {
	return randomBytes(SECRET_BYTES);
}

export function isSecret(value: Uint8Array): boolean {
	return value.length === SECRET_BYTES;
}

export function wrapSecret(publicKeyPem: string, secret: Uint8Array): string {
	return publicEncrypt(
		{ key: publicKeyPem, padding: constants.RSA_PKCS1_PADDING },
		secret
	).toString('base64');
}

export function seal(plaintext: string | Uint8Array, secret: Uint8Array): string {
	const salt = randomBytes(8);
	const { key, iv } = deriveKey(secret, salt);
	const cipher = createCipheriv('aes-256-cbc', key, iv);
	return Buffer.concat([SALTED, salt, cipher.update(plaintext), cipher.final()]).toString('base64');
}

export function unseal(sealed: string, secret: Uint8Array): Uint8Array | null {
	const data = Buffer.from(sealed, 'base64');
	if (data.length < 32 || !data.subarray(0, 8).equals(SALTED)) return null;
	const { key, iv } = deriveKey(secret, data.subarray(8, 16));
	try {
		const decipher = createDecipheriv('aes-256-cbc', key, iv);
		return Buffer.concat([decipher.update(data.subarray(16)), decipher.final()]);
	} catch {
		return null;
	}
}

// OpenSSL EVP_BytesToKey: MD5, one round, 32-byte key plus 16-byte IV.
function deriveKey(secret: Uint8Array, salt: Uint8Array): { key: Buffer; iv: Buffer } {
	const blocks: Buffer[] = [];
	let previous = Buffer.alloc(0);
	while (blocks.length < 3) {
		previous = createHash('md5').update(previous).update(secret).update(salt).digest();
		blocks.push(previous);
	}
	const material = Buffer.concat(blocks);
	return { key: material.subarray(0, 32), iv: material.subarray(32, 48) };
}
