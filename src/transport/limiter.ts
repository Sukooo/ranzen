// Bounds in-flight requests per connection; a freed slot passes straight to the next waiter.
export class Limiter {
	private active = 0;
	private readonly waiting: Array<() => void> = [];

	constructor(private readonly slots: number) {}

	async run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
		await this.acquire(signal);
		try {
			return await task();
		} finally {
			this.release();
		}
	}

	private acquire(signal?: AbortSignal): Promise<void> {
		signal?.throwIfAborted();
		if (this.active < this.slots) {
			this.active++;
			return Promise.resolve();
		}
		return new Promise((resolve, reject) => {
			const grant = () => {
				signal?.removeEventListener('abort', abort);
				resolve();
			};
			const abort = () => {
				this.waiting.splice(this.waiting.indexOf(grant), 1);
				reject(signal?.reason);
			};
			signal?.addEventListener('abort', abort, { once: true });
			this.waiting.push(grant);
		});
	}

	private release(): void {
		const next = this.waiting.shift();
		if (next) next();
		else this.active--;
	}
}
