// PROMISE-CACHE — cache promise có TTL + single-flight, dùng chung cho snapshot
// radar và cluster base.
//
// Vì sao cần: mỗi key là một lần gọi Binance. Hai request đồng thời cho cùng key
// phải dùng CHUNG một promise (inflight dedupe), nếu không mở 3 tab sẽ nhân 3
// lần quét klines. Promise reject thì xoá entry để lần sau thử lại, thay vì cache
// lỗi trong suốt TTL.

export interface PromiseCacheOptions {
  ttlMs: number;
  /** Đồng hồ inject được — test TTL không phải chờ thật. */
  now?: () => number;
}

export interface PromiseCacheLookup<T> {
  promise: Promise<T>;
  /** true = dùng lại promise còn hạn hoặc đang bay (không phát sinh lần gọi mới). */
  cached: boolean;
}

export class PromiseCache<T> {
  private readonly entries = new Map<string, { expires: number; promise: Promise<T> }>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: PromiseCacheOptions) {
    this.ttlMs = options.ttlMs;
    this.now = options.now ?? Date.now;
  }

  /** Trả promise cho `key`, hoặc gọi `load()` nếu chưa có/hết hạn. */
  lookup(key: string, load: () => Promise<T>): PromiseCacheLookup<T> {
    const now = this.now();
    const entry = this.entries.get(key);
    if (entry && entry.expires > now) return { promise: entry.promise, cached: true };

    const promise = load();
    const fresh = { expires: now + this.ttlMs, promise };
    this.entries.set(key, fresh);
    promise.catch(() => {
      if (this.entries.get(key) === fresh) this.entries.delete(key);
    });
    return { promise, cached: false };
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
