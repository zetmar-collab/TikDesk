const EXCEPTION = 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf';
const EXPIRES = '2026-12-17T00:00:00Z';
function evaluate(audit, lock, now = new Date()) {
  if (!audit.vulnerabilities || !audit.metadata || audit.error) throw new Error('Nie otrzymano poprawnego raportu npm audit.');
  const names = Object.keys(audit.vulnerabilities);
  if (!names.length) return { accepted: true, exceptions: 0 };
  const onlyKnown = (name, seen = new Set()) => {
    if (seen.has(name)) return true;
    seen.add(name);
    const row = audit.vulnerabilities[name];
    if (!row || !row.via?.length || !row.nodes?.length || row.nodes.some(node => lock.packages[node]?.dev !== true)) return false;
    return row.via.every(cause => typeof cause === 'string' ? onlyKnown(cause, seen) : cause.url === EXCEPTION);
  };
  const versions = Object.entries(lock.packages).filter(([name]) => /(^|\/)node_modules\/picomatch$/.test(name));
  const accepted = now < new Date(EXPIRES) && versions.length > 0 && versions.every(([, row]) => row.dev === true && row.version === '4.0.7') && names.every(name => onlyKnown(name));
  return { accepted, exceptions: accepted ? names.length : 0 };
}
if (require.main === module) {
  const fs = require('node:fs'); const { spawnSync } = require('node:child_process');
  if (!process.env.npm_execpath) throw new Error('Uruchom przez npm run audit:security.');
  const result = spawnSync(process.execPath, [process.env.npm_execpath, 'audit', '--json'], { encoding: 'utf8', timeout: 60000, windowsHide: true });
  if (result.error) throw result.error;
  const audit = JSON.parse(result.stdout);
  fs.mkdirSync('artifacts', { recursive: true }); fs.writeFileSync('artifacts/npm-audit.json', JSON.stringify(audit, null, 2));
  const outcome = evaluate(audit, JSON.parse(fs.readFileSync('package-lock.json', 'utf8')));
  if (!outcome.accepted) { console.error('Nierozwiązane alerty bezpieczeństwa. Szczegóły: artifacts/npm-audit.json'); process.exitCode = 1; }
  else if (outcome.exceptions) console.warn(`Tymczasowy wyjątek tylko dla narzędzi budowania: ${EXCEPTION}; zależne pakiety: ${outcome.exceptions}; wygasa ${EXPIRES}. Szczegóły: docs/SECURITY-EXCEPTIONS.md`);
  else console.log('npm audit: 0 alertów.');
}
module.exports = { evaluate };
