const { test } = require('node:test');
const assert = require('node:assert/strict');
const { shortcutCommand } = require('../src/shortcuts.cjs');
test('The same commands are available for both local and remote key handlers', () => {
  for (const [input, command] of [[{ key: 'F11' }, 'fullscreen'], [{ key: 'F5' }, 'reload'], [{ key: 'r', control: true }, 'reload'], [{ key: 'ArrowLeft', alt: true }, 'back'], [{ key: 'ArrowRight', alt: true }, 'forward'], [{ key: 'Home', alt: true }, 'home']]) assert.equal(shortcutCommand({ type: 'keyDown', ...input }), command);
  assert.equal(shortcutCommand({ type: 'keyDown', key: 'c', control: true }), null);
  assert.equal(shortcutCommand({ type: 'keyUp', key: 'F11' }), null);
});
