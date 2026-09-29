// Bundles audit/src into the one dependency-free file the plugin ships, and the package's bin:
//   plugin/skills/jev-eval/scripts/jev-audit.mjs and audit/bin/jev-audit.mjs (identical).
//   node scripts/build-audit.mjs            rebuild both
//   node scripts/build-audit.mjs --check    fail if either is stale (CI runs this)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TARGETS = ['plugin/skills/jev-eval/scripts/jev-audit.mjs', 'audit/bin/jev-audit.mjs'];

/** The bundle text for a kit rooted at `root`, built with the given esbuild module. */
export async function bundle(esbuild, root) {
  const result = await esbuild.build({
    entryPoints: [join(root, 'audit/src/cli.ts')],
    absWorkingDir: root,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node18',
    write: false,
    legalComments: 'none',
  });
  const code = result.outputFiles[0].text.replace(/^#!.*\n/, '');
  return `#!/usr/bin/env node\n// Generated from audit/src by scripts/build-audit.mjs. Do not edit: change audit/src and rebuild.\n${code}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const text = await bundle(await import('esbuild'), root);
  let stale = 0;
  for (const t of TARGETS) {
    const p = join(root, t);
    if (process.argv.includes('--check')) {
      let current = '';
      try { current = readFileSync(p, 'utf8'); } catch {}
      if (current !== text) { console.error(`${t} is stale: run npm run build`); stale += 1; }
    } else {
      writeFileSync(p, text, { mode: 0o755 });
      console.log(`wrote ${t}`);
    }
  }
  if (stale) process.exit(1);
  if (process.argv.includes('--check')) console.log('audit bundles are current');
}
