#!/usr/bin/env node
/**
 * Validate all JSON files in config/ - syntax + schema.
 * Run: npm run validate:json
 */

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv').default;

const configDir = path.join(__dirname, '..', 'config');
const schemaDir = path.join(configDir, 'schema');

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

function validateSyntax(file) {
  try {
    const content = fs.readFileSync(file, 'utf8');
    return { ok: true, data: JSON.parse(content) };
  } catch (err) {
    const msg = err.message || String(err);
    const match = msg.match(/position (\d+)/);
    if (match) {
      const content = fs.readFileSync(file, 'utf8');
      const pos = parseInt(match[1], 10);
      const before = content.slice(0, pos);
      const line = before.split('\n').length;
      return { ok: false, error: `${file}:${line} ${msg}` };
    }
    return { ok: false, error: `${file} ${msg}` };
  }
}

const ajv = new Ajv({ allErrors: true });
const screenSchema = JSON.parse(fs.readFileSync(path.join(schemaDir, 'screen.schema.json'), 'utf8'));
const actionSchema = JSON.parse(fs.readFileSync(path.join(schemaDir, 'action.schema.json'), 'utf8'));
const screenValidate = ajv.compile(screenSchema);
const actionValidate = ajv.compile(actionSchema);

const screensDir = path.join(configDir, 'screens');
const actionsDir = path.join(configDir, 'actions');

let hasError = false;
const jsonFiles = findJsonFiles(configDir);

for (const file of jsonFiles) {
  const syntax = validateSyntax(file);
  if (!syntax.ok) {
    console.error('\x1b[31m%s\x1b[0m', syntax.error);
    hasError = true;
    continue;
  }

  const rel = path.relative(configDir, file);
  if (rel.startsWith('screens' + path.sep) && rel.endsWith('.json')) {
    const valid = screenValidate(syntax.data);
    if (!valid) {
      console.error('\x1b[31mSchema error %s:\x1b[0m', file);
      screenValidate.errors.forEach((e) => console.error('  %s', e.message));
      hasError = true;
    }
  } else if (rel.startsWith('actions' + path.sep) && rel.endsWith('.json')) {
    const valid = actionValidate(syntax.data);
    if (!valid) {
      console.error('\x1b[31mSchema error %s:\x1b[0m', file);
      actionValidate.errors.forEach((e) => console.error('  %s', e.message));
      hasError = true;
    }
  }
}

if (hasError) {
  process.exit(1);
}
console.log('Validated %d JSON files (syntax + schema)', jsonFiles.length);
