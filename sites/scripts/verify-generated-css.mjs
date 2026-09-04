import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const cssDirectory = new URL('../dist/client/_next/static/css/', import.meta.url);
const files = (await readdir(cssDirectory)).filter((file) => file.endsWith('.css'));
const css = (await Promise.all(files.map((file) => readFile(join(cssDirectory.pathname, file), 'utf8')))).join('\n');

const requiredUtilities = ['.flex{', '.items-center{', '.rounded-full{', '.max-w-none{', '.h-8{', '.text-xs{', '.p-4{'];
const missingUtilities = requiredUtilities.filter((selector) => !css.includes(selector));
const uncompiledDirectives = ['@utility', '@theme', '@custom-variant'].filter((directive) => css.includes(directive));

if (missingUtilities.length > 0 || uncompiledDirectives.length > 0) {
  console.error('Generated Concierge CSS is incomplete.');
  if (missingUtilities.length > 0) console.error(`Missing utilities: ${missingUtilities.join(', ')}`);
  if (uncompiledDirectives.length > 0) console.error(`Uncompiled directives: ${uncompiledDirectives.join(', ')}`);
  process.exit(1);
}

console.log(`Verified ${files.length} generated CSS files include the Assistant UI utility layer.`);
