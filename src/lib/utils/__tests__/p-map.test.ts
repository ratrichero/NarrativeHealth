/**
 * P6-PERF-03 — Unit tests for the bounded concurrency utility.
 */

import { pMap } from "../p-map";

describe("pMap", () => {
  test("returns empty array for empty input", async () => {
    const result = await pMap([], async (x) => x * 2, { concurrency: 4 });
    expect(result).toEqual([]);
  });

  test("preserves input ordering regardless of execution order", async () => {
    // Simulate variable latency
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const result = await pMap(
      items,
      async (x) => {
        // Stagger delays so later items finish first
        await new Promise((r) => setTimeout(r, (10 - x) * 10));
        return x * 10;
      },
      { concurrency: 4 },
    );
    expect(result).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  });

  test("respects concurrency limit", async () => {
    let maxConcurrent = 0;
    let currentConcurrent = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);

    await pMap(
      items,
      async () => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        await new Promise((r) => setTimeout(r, 20));
        currentConcurrent--;
      },
      { concurrency: 4 },
    );

    expect(maxConcurrent).toBeLessThanOrEqual(4);
  });

  test("single task works", async () => {
    const result = await pMap([42], async (x) => x + 1, { concurrency: 4 });
    expect(result).toEqual([43]);
  });

  test("concurrency=1 behaves sequentially", async () => {
    const order: number[] = [];
    const items = [1, 2, 3];
    await pMap(
      items,
      async (x) => {
        order.push(x);
        return x;
      },
      { concurrency: 1 },
    );
    expect(order).toEqual([1, 2, 3]);
  });

  test("task failure does not abort other tasks", async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await pMap(
      items,
      async (x) => {
        if (x === 3) throw new Error("boom");
        return x * 2;
      },
      { concurrency: 4 },
    );
    // All items complete; the failed one has undefined result
    expect(results[0]).toBe(2);
    expect(results[1]).toBe(4);
    expect(results[2]).toBeUndefined(); // failed
    expect(results[3]).toBe(8);
    expect(results[4]).toBe(10);
  });

  test("concurrency=10 allows high parallelism", async () => {
    let maxConcurrent = 0;
    let currentConcurrent = 0;
    const items = Array.from({ length: 30 }, (_, i) => i);

    await pMap(
      items,
      async () => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        await new Promise((r) => setTimeout(r, 50));
        currentConcurrent--;
      },
      { concurrency: 10 },
    );

    expect(maxConcurrent).toBe(10);
  });

  test("rejects invalid concurrency", async () => {
    await expect(
      pMap([1], async (x) => x, { concurrency: 0 }),
    ).rejects.toThrow("Concurrency must be >= 1");
  });

  test("passes index to callback", async () => {
    const items = ["a", "b", "c"];
    const indices: number[] = [];
    await pMap(
      items,
      async (_item, index) => {
        indices.push(index);
      },
      { concurrency: 4 },
    );
    expect(indices).toContain(0);
    expect(indices).toContain(1);
    expect(indices).toContain(2);
  });
});
