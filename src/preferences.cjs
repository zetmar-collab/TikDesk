const DEFAULTS = Object.freeze({ mode: 'mobile', theme: 'dark', muted: false, window: { width: 1180, height: 900, maximized: false } });

function normalizePreferences(value) {
  const input = value && typeof value === 'object' ? value : {};
  const dimension = (value, min, fallback) => Number.isInteger(value) && value >= min && value <= 5000 ? value : fallback;
  return {
    mode: ['mobile', 'desktop'].includes(input.mode) ? input.mode : DEFAULTS.mode,
    theme: ['dark', 'light', 'system'].includes(input.theme) ? input.theme : DEFAULTS.theme,
    muted: typeof input.muted === 'boolean' ? input.muted : DEFAULTS.muted,
    window: {
      width: dimension(input.window?.width, 800, DEFAULTS.window.width),
      height: dimension(input.window?.height, 640, DEFAULTS.window.height),
      maximized: input.window?.maximized === true
    }
  };
}
module.exports = { DEFAULTS, normalizePreferences };
