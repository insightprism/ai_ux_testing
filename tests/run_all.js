// Runs every tests/<package>/test_*.js in sequence. Per-package roll-up.
// Exits non-zero if any suite fails.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const TESTS_DIR = __dirname;
const PACKAGES = ['shared', 'ux_testing', 'flow_review'];

let totalFailedSuites = 0;
for (const packageName of PACKAGES) {
  const packageDir = path.join(TESTS_DIR, packageName);
  if (!fs.existsSync(packageDir)) continue;
  const testFiles = fs.readdirSync(packageDir)
    .filter(f => /^test_.*\.js$/.test(f))
    .sort();
  if (!testFiles.length) continue;

  console.log(`\n########## ${packageName} ##########`);
  for (const file of testFiles) {
    console.log(`\n===== ${packageName}/${file} =====`);
    const result = spawnSync(
      process.execPath,
      [path.join(packageDir, file)],
      { stdio: 'inherit' },
    );
    if (result.status !== 0) totalFailedSuites += 1;
  }
}

console.log('');
console.log(`Total suites failed: ${totalFailedSuites}`);
process.exit(totalFailedSuites ? 1 : 0);
