import { fail } from './errors.js';
import { unseal } from './protocol/cipher.js';
import type { Exchange, Reply, StreamReply, Transport } from './transport/http.js';

export interface Account {
	readonly schoolId: number;
	readonly username: string;
}

const ENCODED = /<encoded>([^<]*)<\/encoded>/g;
const UTF8 = new TextDecoder();

// Package-internal handle that features use to talk to the portal.
export class Session {
	readonly #life = new AbortController();

	constructor(
		readonly account: Account,
		readonly transport: Transport,
		readonly secret: Uint8Array
	) {}

	get disposed(): boolean {
		return this.#life.signal.aborted;
	}

	ensureOpen(): void {
		if (this.disposed) throw fail('DISPOSED', 'The connection was disposed.');
	}

	// Cancels queued and in-flight requests and forgets the cookies.
	dispose(): void {
		this.#life.abort();
		this.transport.jar.clear();
	}

	async send(exchange: Exchange): Promise<Reply> {
		const reply = await this.within(exchange, (bound) => this.transport.send(bound));
		if (!reply.headers.get('content-type')?.includes('text/html')) return reply;
		return { ...reply, text: this.reveal(reply.text) };
	}

	// Raw bytes for downloads; disposing the connection also cancels the body.
	stream(exchange: Exchange): Promise<StreamReply> {
		return this.within(exchange, (bound) => this.transport.stream(bound));
	}

	private async within<T>(exchange: Exchange, run: (bound: Exchange) => Promise<T>): Promise<T> {
		this.ensureOpen();
		const life = this.#life.signal;
		const signal = exchange.signal ? AbortSignal.any([exchange.signal, life]) : life;
		let result: T;
		try {
			result = await run({ ...exchange, signal });
		} catch (error) {
			this.ensureOpen();
			throw error;
		}
		this.ensureOpen();
		return result;
	}

	private reveal(html: string): string {
		return html.replace(ENCODED, (_tag, sealed: string) => {
			const plain = unseal(sealed, this.secret);
			if (!plain) throw fail('DECRYPT_FAILED', 'Could not decrypt portal content.');
			return UTF8.decode(plain);
		});
	}
}
