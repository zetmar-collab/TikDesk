const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compareVersions, checkUpdates } = require('../src/updates.cjs');
test('Versions compare numerically and invalid release tags are rejected', () => {
  assert.equal(compareVersions('v1.10.0', '1.9.0'), 1);
  assert.equal(compareVersions('1.2.0', '1.3.0'), -1);
  assert.equal(compareVersions('1.3.0', '1.3.0'), 0);
  assert.throws(() => compareVersions('latest', '1.3.0'));
});
test('Only stable releases produce update notices with a fixed repository link', async () => {
  const result = await checkUpdates(async () => new Response(JSON.stringify({ tag_name: 'v1.4.0', html_url: 'https://evil.invalid' })), '1.3.0');
  assert.equal(result.available, true);
  assert.equal(result.url, 'https://github.com/zetmar-collab/TikDesk/releases');
  await assert.rejects(checkUpdates(async () => new Response('{}', { status: 403 }), '1.3.0'));
});
