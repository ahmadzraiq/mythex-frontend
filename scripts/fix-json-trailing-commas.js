#!/usr/bin/env node
/**
 * Fix common JSON syntax errors (trailing commas, etc.) by parsing with JSON5
 * and re-serializing to strict JSON. Run when validate:json fails.
 * Usage: npm run fix:json
 */

const fs = require('fs');
const path = require('path');
const JSON5 = require('json5');

const configDir = path.join(__dirname, '..', 'config');

function findJsonFiles(dir, files = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      findJsonFiles(p, files);
    } else if (e.name.endsWith('.json')) {
      files.push(p);
    }
  }
  return files;
}

const jsonFiles = findJsonFiles(configDir);
let fixed = 0;
let failed = 0;

for (const file of jsonFiles) {
  try {
    const content = fs.readFileSync(file, 'utf8');
    try {
      JSON.parse(content);
      continue;
    } catch (_) {
      // Invalid strict JSON - try JSON5
    }
    const data = JSON5.parse(content);
    const strict = JSON.stringify(data, null, 2);
    fs.writeFileSync(file, strict + '\n');
    console.log('Fixed:', file);
    fixed++;
  } catch (err) {
    console.error('Failed:', file, err.message);
    failed++;
  }
}

if (fixed > 0) {
  console.log(`Fixed ${fixed} file(s). Run npm run validate:json to verify.`);
}
if (failed > 0) {
  process.exit(1);
}
