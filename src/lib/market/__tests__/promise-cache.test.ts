// RADAR-05 W7/W8 — TTL + inflight dedupe cho cache promise.

import { PromiseCache } from "@/lib/market/promise-cache";

describe("PromiseCache", () => {
  test("hai caller đồng thời dùng chung một lần load (inflight dedupe)", async () => {
    let loads = 0;
    let release: (value: string) => void = () => {};
    const cache = new PromiseCache<string>({ ttlMs: 60_000 });
    const load = () => {
      loads += 1;
      return new Promise<string>((resolve) => {
        release = resolve;
      });
    };

    const first = cache.lookup("k", load);
    const second = cache.lookup("k", load);

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(loads).toBe(1);
    expect(second.promise).toBe(first.promise);

    release("value");
    await expect(first.promise).resolves.toBe("value");
    await expect(second.promise).resolves.toBe("value");
    expect(loads).toBe(1);
  });

  test("còn hạn thì trả cache, hết TTL thì load lại", async () => {
    let clock = 1_000;
    let loads = 0;
    const cache = new PromiseCache<number>({ ttlMs: 5_000, now: () => clock });
    const load = async () => {
      loads += 1;
      return loads;
    };

    await expect(cache.lookup("k", load).promise).resolves.toBe(1);
    clock += 4_999;
    const hit = cache.lookup("k", load);
    expect(hit.cached).toBe(true);
    await expect(hit.promise).resolves.toBe(1);
    expect(loads).toBe(1);

    clock += 2; // vượt TTL
    const miss = cache.lookup("k", load);
    expect(miss.cached).toBe(false);
    await expect(miss.promise).resolves.toBe(2);
    expect(loads).toBe(2);
  });

  test("promise reject không bị cache — lần sau thử lại", async () => {
    let loads = 0;
    const cache = new PromiseCache<string>({ ttlMs: 60_000 });
    const failing = () => {
      loads += 1;
      return Promise.reject(new Error("binance 451"));
    };

    await expect(cache.lookup("k", failing).promise).rejects.toThrow("binance 451");
    // Cho microtask xoá entry chạy xong.
    await Promise.resolve();
    expect(cache.size).toBe(0);

    const ok = cache.lookup("k", async () => {
      loads += 1;
      return "ok";
    });
    expect(ok.cached).toBe(false);
    await expect(ok.promise).resolves.toBe("ok");
    expect(loads).toBe(2);
  });

  test("key khác nhau không dùng chung promise; clear() xoá tất cả", async () => {
    let loads = 0;
    const cache = new PromiseCache<string>({ ttlMs: 60_000 });
    const load = async () => {
      loads += 1;
      return `v${loads}`;
    };

    await expect(cache.lookup("a", load).promise).resolves.toBe("v1");
    await expect(cache.lookup("b", load).promise).resolves.toBe("v2");
    expect(cache.size).toBe(2);

    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.lookup("a", load).cached).toBe(false);
  });
});
