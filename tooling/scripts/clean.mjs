#!/usr/bin/env node
/** Remove build output from every workspace package. */
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

for (const group of ['apps', 'packages']) {
  for (const name of readdirSync(join(process.cwd(), group))) {
    rmSync(join(process.cwd(), group, name, 'dist'), { recursive: true, force: true });
  }
}
rmSync(join(process.cwd(), '.markov-tmp'), { recursive: true, force: true });
process.stdout.write('cleaned dist directories\n');
