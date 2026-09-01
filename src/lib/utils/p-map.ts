/**
 * P6-PERF-03 — Bounded concurrency utility for parallel per-coin processing.
 *
 * Executes an array of async tasks with a maximum number of concurrent
 * in-flight operations. This prevents overwhelming the Binance API rate
 * limit and the database connection pool while still achieving significant
 * speedup over sequential execution.
 *
 * Invariants:
 * - At most `concurrency` tasks execute simultaneously
 * - Results maintain input ordering (not execution ordering)
 * - A single task failure does NOT abort other tasks
 * - All tasks always run to completion (success or error)
 */

export interface ConcurrencyOptions {
  /** Maximum number of concurrent in-flight tasks. Default: 6. */
  concurrency?: number;
}

/**
 * Run async tasks with bounded concurrency.
 *
 * @param items - Input array of items to process
 * @param fn - Async function to apply to each item
 * @param options - Concurrency configuration
 * @returns Array of results in the same order as input items
 */
export async function pMap<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  options: ConcurrencyOptions = {},
): Promise<R[]> {
  const concurrency = options.concurrency ?? 6;

  if (items.length === 0) return [];
  if (concurrency < 1) throw new Error("Concurrency must be >= 1");
  if (concurrency === 1) {
    // Sequential fallback — same semantics as current code
    const results: R[] = [];
    for (let i = 0; i < items.length; i++) {
      results.push(await fn(items[i], i));
    }
    return results;
  }

  const results = new Array<R>(items.length);
  const errors = new Array<{ index: number; error: unknown }>(items.length);
  let nextIndex = 0;
  let activeCount = 0;
  let hasError = false;

  return new Promise<R[]>((resolve) => {
    function scheduleNext() {
      while (activeCount < concurrency && nextIndex < items.length) {
        const currentIndex = nextIndex++;
        activeCount++;

        fn(items[currentIndex], currentIndex)
          .then((result) => {
            results[currentIndex] = result;
          })
          .catch((error) => {
            // Record error but do NOT abort other tasks
            errors[currentIndex] = { index: currentIndex, error };
            hasError = true;
          })
          .finally(() => {
            activeCount--;
            if (nextIndex >= items.length && activeCount === 0) {
              // All tasks complete
              if (hasError) {
                // Log errors but still resolve with partial results
                for (const err of errors) {
                  if (err) {
                    console.error(
                      `[pMap] Task at index ${err.index} failed:`,
                      err.error instanceof Error ? err.error.message : err.error,
                    );
                  }
                }
              }
              resolve(results);
            } else {
              scheduleNext();
            }
          });
      }
    }

    scheduleNext();
  });
}
