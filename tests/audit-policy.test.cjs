const { test } = require('node:test'); const assert = require('node:assert/strict');
const { evaluate } = require('../scripts/audit-policy.cjs');
test('Audit exception is restricted to the exact advisory, dev dependencies, version and expiry', () => {
  const lock = { packages: { 'node_modules/picomatch': { dev: true, version: '4.0.7' } } };
  const audit = { metadata: {}, vulnerabilities: { picomatch: { nodes: ['node_modules/picomatch'], via: [{ url: 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf' }] } } };
  assert.equal(evaluate(audit, lock, new Date('2026-11-17')).accepted, true);
  assert.equal(evaluate(audit, lock, new Date('2026-12-17')).accepted, false);
  assert.equal(evaluate(audit, { packages: { 'node_modules/picomatch': { dev: false, version: '4.0.7' } } }, new Date('2026-11-17')).accepted, false);
  audit.vulnerabilities.picomatch.via[0].url = 'https://github.com/advisories/unknown';
  assert.equal(evaluate(audit, lock, new Date('2026-11-17')).accepted, false);
  assert.throws(() => evaluate({ error: {} }, lock));
});
