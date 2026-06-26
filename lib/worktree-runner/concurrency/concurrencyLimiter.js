/**
 * Simple FIFO concurrency gate. Callers submit work via run(fn); at most
 * maxConcurrent functions are in flight at once, the rest queue in order.
 */
export function createConcurrencyLimiter(maxConcurrent) {
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
    throw new RangeError("maxConcurrent must be a positive integer.");
  }

  let active = 0;
  const queue = [];

  function dequeueNext() {
    if (active >= maxConcurrent || queue.length === 0) return;
    active += 1;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(fn)
      .then((value) => {
        active -= 1;
        resolve(value);
        dequeueNext();
      })
      .catch((err) => {
        active -= 1;
        reject(err);
        dequeueNext();
      });
  }

  return {
    run(fn) {
      return new Promise((resolve, reject) => {
        queue.push({ fn, resolve, reject });
        dequeueNext();
      });
    },
    get activeCount() {
      return active;
    },
    get queuedCount() {
      return queue.length;
    }
  };
}
