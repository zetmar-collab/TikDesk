/**
 * @template T
 * @param {PromiseLike<T> | T} promise
 * @param {{ signal?: AbortSignal, timeoutMs?: number, message?: string }} options
 * @returns {Promise<T>}
 */
function bounded(promise, { signal, timeoutMs = 10000, message = 'Przekroczono czas oczekiwania.' } = {}) {
  return new Promise((resolve, reject) => {
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    /** @param {(value: any) => void} callback @param {any} value */
    const finish = (callback, value) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); callback(value); };
    const abort = () => finish(reject, signal?.reason || new Error('Anulowano.'));
    if (signal?.aborted) { Promise.resolve(promise).catch(() => {}); abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => { const error = Object.assign(new Error(message), { code: 'TIMEOUT' }); finish(reject, error); }, timeoutMs);
    Promise.resolve(promise).then(value => finish(resolve, value), error => finish(reject, error));
  });
}
module.exports = { bounded };
