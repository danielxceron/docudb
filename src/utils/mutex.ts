/**
 * Keyed mutual exclusion helper.
 *
 * Replaces the previous `global._documentLocks` spin-wait with a FIFO promise
 * chain: no polling, no timers, no shared global state and no cross-database
 * key collisions (keys always include the database name).
 */

/** Runs tasks sequentially per key, concurrently across different keys */
export class KeyedMutex {
  /** Tail of the promise chain per key */
  private readonly tails: Map<string, Promise<unknown>>

  constructor () {
    this.tails = new Map()
  }

  /** Number of keys with an in-flight task */
  get active (): number {
    return this.tails.size
  }

  /**
   * Runs `task` while holding the lock for `key`.
   * @param key - Lock key (must be unique per resource)
   * @param task - Exclusive task
   * @returns The value returned by `task`
   */
  async withLock<T> (key: string, task: () => Promise<T> | T): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve()

    // Swallow rejections of the previous task so the chain is never poisoned.
    const run = previous.then(
      () => task(),
      () => task()
    )

    // Keep a tail that never rejects.
    const tail = run.then(
      () => undefined,
      () => undefined
    )
    this.tails.set(key, tail)

    try {
      return await run
    } finally {
      if (this.tails.get(key) === tail) {
        this.tails.delete(key)
      }
    }
  }
}

/** Process-wide mutex used to serialize document level operations */
export const documentMutex = new KeyedMutex()

export default KeyedMutex
