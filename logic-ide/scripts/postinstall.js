const { readdirSync, chmodSync } = require('node:fs');
const { join } = require('node:path');

const candidates = ['node_modules/node-pty/prebuilds', '../node_modules/node-pty/prebuilds'];
for (const dir of candidates) {
  try {
    for (const d of readdirSync(dir)) {
      try { chmodSync(join(dir, d, 'spawn-helper'), 0o755); } catch {}
    }
  } catch {}
}
try { chmodSync('scripts/git-askpass.sh', 0o755); } catch {}
