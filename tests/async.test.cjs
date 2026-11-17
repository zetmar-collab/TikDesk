const { test } = require('node:test');
const assert = require('node:assert/strict');
const { bounded } = require('../src/async.cjs');
test('A stuck operation can be cancelled and times out without a late success', async () => {
  const controller = new AbortController();
  const pending = bounded(new Promise(() => {}), { signal: controller.signal });
  controller.abort(new Error('cancelled'));
  await assert.rejects(pending, /cancelled/);
  await assert.rejects(bounded(new Promise(() => {}), { timeoutMs: 5 }), { code: 'TIMEOUT' });
});
