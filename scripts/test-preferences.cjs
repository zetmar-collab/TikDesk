const { spawnSync } = require('node:child_process');
const electron = require('electron');
const profile = `restart-${process.pid}-${Date.now()}`;
for (const phase of ['write', 'read', 'read-manual']) {
  const result = spawnSync(electron, ['.', '--smoke-test', `--smoke-profile=${profile}`, `--preferences-${phase}`], { cwd: require('node:path').join(__dirname, '..'), stdio: 'inherit', timeout: 20000 });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
