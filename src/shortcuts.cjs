function shortcutCommand(input) {
  if (input.type !== 'keyDown' || input.isAutoRepeat) return null;
  const key = input.key.toLowerCase();
  if (key === 'f5' || (input.control && !input.alt && key === 'r')) return 'reload';
  if (key === 'f11') return 'fullscreen';
  if (input.alt && key === 'arrowleft') return 'back';
  if (input.alt && key === 'arrowright') return 'forward';
  if (input.alt && key === 'home') return 'home';
  return null;
}
module.exports = { shortcutCommand };
