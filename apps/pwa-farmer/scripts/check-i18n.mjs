#!/usr/bin/env node
// Fails (exit 1) when any language in messages/languages.json is out of step with en.json:
//   missing keys, extra keys, blank values, or different {placeholders}.
// Also fails when source code asks for a literal key that en.json does not have, or a dynamic key family
// (t(`state.${x}`)) has no entries at all. Keys in identical English form are only reported as a warning.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'messages');
const problems = [];
const read = (name) => JSON.parse(readFileSync(join(dir, name), 'utf8'));
const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

const languages = read('languages.json');
const en = read('en.json');
const keys = Object.keys(en);
let copied = 0;

for (const { code, label } of languages) {
  if (!code || !label) { problems.push(`languages.json: entry needs both code and label: ${JSON.stringify({ code, label })}`); continue; }
  if (!existsSync(join(dir, `${code}.json`))) { problems.push(`${code}: messages/${code}.json does not exist`); continue; }
  const m = read(`${code}.json`);
  for (const k of keys) {
    if (!(k in m)) problems.push(`${code}: missing "${k}"`);
    else if (typeof m[k] !== 'string' || !m[k].trim()) problems.push(`${code}: blank "${k}"`);
    else {
      if (placeholders(m[k]) !== placeholders(en[k])) problems.push(`${code}: placeholders differ in "${k}" (en: ${placeholders(en[k]) || 'none'}; ${code}: ${placeholders(m[k]) || 'none'})`);
      if (code !== 'en' && m[k] === en[k]) copied++;
    }
  }
  for (const k of Object.keys(m)) if (!(k in en)) problems.push(`${code}: extra key "${k}" is not in en.json`);
}
for (const f of readdirSync(dir)) {
  if (f === 'languages.json' || !f.endsWith('.json')) continue;
  const code = f.slice(0, -5);
  if (!languages.some((l) => l.code === code)) problems.push(`messages/${f} is not listed in languages.json`);
}

// Source scan.
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : []; });
const sources = walk(join(root, 'src'));
const used = new Set();
const families = new Set();
for (const p of sources) {
  const src = readFileSync(p, 'utf8');
  for (const m of src.matchAll(/\bt\(\s*'([^']+)'/g)) used.add(m[1]);
  for (const m of src.matchAll(/\bt\(\s*`([a-zA-Z.]+)\.\$\{/g)) families.add(m[1]);
  // Keys that travel as data, such as nextStep() text fields and the NAV table.
  for (const m of src.matchAll(/(?:text|action|key): '([a-z]+\.[A-Za-z.]+)'/g)) used.add(m[1]);
  for (const m of src.matchAll(/'((?:selfcert)\.[a-zA-Z0-9]+Step\d)'/g)) used.add(m[1]);
}
for (const k of used) if (!(k in en)) problems.push(`source uses "${k}" but en.json does not have it`);
for (const fam of families) if (!keys.some((k) => k.startsWith(`${fam}.`))) problems.push(`source uses t(\`${fam}.\${...}\`) but en.json has no "${fam}." keys`);

if (problems.length) {
  console.error(`i18n check FAILED with ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`i18n check passed: ${languages.length} languages (${languages.map((l) => l.code).join(', ')}), ${keys.length} keys, ${used.size} literal keys used in source.`);
if (copied) console.log(`Note: ${copied} translation(s) are identical to English (names and codes are expected to be).`);
