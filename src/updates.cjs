const RELEASES_URL = 'https://github.com/zetmar-collab/TikDesk/releases';
function compareVersions(left, right) {
  const parse = value => /^v?\d+\.\d+\.\d+$/.test(value) ? value.replace(/^v/, '').split('.').map(Number) : null;
  const a = parse(left), b = parse(right);
  if (!a || !b) throw new Error('Nieprawidłowa wersja wydania.');
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}
async function checkUpdates(fetch, currentVersion) {
  const response = await fetch('https://api.github.com/repos/zetmar-collab/TikDesk/releases/latest', { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Nie udało się sprawdzić aktualizacji (HTTP ${response.status}).`);
  const release = await response.json();
  if (release.draft || release.prerelease) throw new Error('Nie znaleziono stabilnego wydania.');
  const available = compareVersions(release.tag_name, currentVersion) > 0;
  return { available, version: release.tag_name.replace(/^v/, ''), url: RELEASES_URL, message: available ? `Dostępna wersja ${release.tag_name}. Otwórz wydania GitHub, aby pobrać instalator.` : `Nie ma nowszego wydania. Używasz wersji ${currentVersion}.` };
}
module.exports = { compareVersions, checkUpdates, RELEASES_URL };
