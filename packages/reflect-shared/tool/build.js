// @ts-check

import * as esbuild from 'esbuild';
import {writeFile} from 'node:fs/promises';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';
import {makeDefine, sharedOptions} from '../../shared/src/build.js';
import {getVersion} from './get-version.js';

// You can then visualize the metafile at https://esbuild.github.io/analyze/
const metafile = process.argv.includes('--metafile');
const debug = process.argv.includes('--debug');

const dirname = path.dirname(fileURLToPath(import.meta.url));

async function buildESM() {
  const mode = debug ? 'debug' : 'unknown';
  // let's just never minify for now, it's constantly getting in our and our
  // user's way. When we have an automated way to do both minified and non-
  // minified builds we can re-enable this.
  const minify = false;
  const shared = sharedOptions(minify, metafile);
  const outfile = path.join(dirname, '..', 'out', 'reflect-shared.js');
  const define = makeDefine(mode);
  const result = await esbuild.build({
    ...shared,
    // Use neutral to remove the automatic define for process.env.NODE_ENV
    platform: 'neutral',
    define: {
      ...define,
      REFLECT_VERSION: JSON.stringify(getVersion()),
    },
    format: 'esm',
    entryPoints: [path.join(dirname, '..', 'src', 'mod.ts')],
    outfile,
    metafile,
  });
  if (metafile) {
    await writeFile(outfile + '.meta.json', JSON.stringify(result.metafile));
  }
}

try {
  await buildESM();
} catch (e) {
  console.error(e);
  process.exit(1);
}
