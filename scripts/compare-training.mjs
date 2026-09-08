import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
await mkdir('.evaluation-cache', { recursive: true });
const outfile = resolve('.evaluation-cache/compare-training.mjs');
await build({ entryPoints: ['evaluation/compareTraining.mjs'], outfile, bundle: true, platform: 'node', format: 'esm', packages: 'external' });
await import(pathToFileURL(outfile).href);
