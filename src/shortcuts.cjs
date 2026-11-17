const DEFAULT_SHORTCUTS = Object.freeze({ reload: 'F5, Ctrl+R', fullscreen: 'F11', back: 'Alt+Left', forward: 'Alt+Right', home: 'Alt+Home' });
const KEYS = { arrowleft: 'Left', arrowright: 'Right', arrowup: 'Up', arrowdown: 'Down', home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown', space: 'Space' };
function canonical(value) {
  const parts = value.trim().split('+').map(part => part.trim().toLowerCase());
  const key = parts.pop();
  if (!key || parts.some(part => !['ctrl', 'alt', 'shift'].includes(part)) || new Set(parts).size !== parts.length) throw new Error('Nieprawidłowy skrót. Użyj np. Ctrl+Shift+R albo F5.');
  const mapped = KEYS[key] || Object.values(KEYS).find(item => item.toLowerCase() === key) || (/^[a-z0-9]$|^f([1-9]|1[0-9]|2[0-4])$/.test(key) ? key.toUpperCase() : '');
  if (!mapped || parts.length === 0 && !/^F\d+$/.test(mapped)) throw new Error('Klawisz musi mieć Ctrl/Alt/Shift albo być klawiszem F1–F24.');
  const result = [...['ctrl', 'alt', 'shift'].filter(part => parts.includes(part)).map(part => ({ ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift' })[part]), mapped].join('+');
  if (['Alt+F4', 'Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+A', 'Ctrl+Z', 'Ctrl+Y'].includes(result)) throw new Error('Ten skrót jest zarezerwowany przez system lub edycję tekstu.');
  return result;
}
function normalizeShortcuts(value = DEFAULT_SHORTCUTS) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Nieprawidłowa konfiguracja skrótów.');
  const result = {}; const used = new Set();
  for (const name of Object.keys(DEFAULT_SHORTCUTS)) {
    const input = value[name] ?? DEFAULT_SHORTCUTS[name];
    if (typeof input !== 'string' || input.length > 100) throw new Error('Nieprawidłowa konfiguracja skrótów.');
    const keys = input ? input.split(',').map(canonical) : [];
    if (keys.length > 3 || keys.some(key => used.has(key)) || new Set(keys).size !== keys.length) throw new Error('Skróty nie mogą się powtarzać. Maksymalnie trzy na polecenie.');
    keys.forEach(key => used.add(key)); result[name] = keys.join(', ');
  }
  return result;
}
function shortcutCommand(input, config = DEFAULT_SHORTCUTS) {
  if (input.type !== 'keyDown' || input.isAutoRepeat || input.meta || typeof input.key !== 'string') return null;
  let key; try { key = canonical([input.control && 'Ctrl', input.alt && 'Alt', input.shift && 'Shift', input.key === ' ' ? 'Space' : input.key].filter(Boolean).join('+')); } catch { return null; }
  return Object.keys(config).find(name => config[name].split(', ').includes(key)) || null;
}
module.exports = { DEFAULT_SHORTCUTS, normalizeShortcuts, shortcutCommand };
