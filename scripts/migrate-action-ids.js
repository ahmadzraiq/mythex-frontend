#!/usr/bin/env node
/**
 * migrate-action-ids.js
 * 
 * One-time migration: converts all named action keys in config/actions/*.json
 * from camelCase names to stable UUIDs, adds a "name" field for display,
 * and updates all references in config/screens/*.json and config/fragments/**\/*.json.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');

// ─── Walk directory recursively ──────────────────────────────────────────────
function walkFiles(dir, ext) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) results.push(...walkFiles(full, ext));
    else if (entry.endsWith(ext)) results.push(full);
  }
  return results;
}

// ─── Step 1: Read all actions and build name→uuid mapping ────────────────────
const ACTION_DIR = path.join(ROOT, 'config', 'actions');
const actionFiles = fs.readdirSync(ACTION_DIR).filter(f => f.endsWith('.json'));

// Map: originalName → uuid
const nameToUuid = {};
// Map: file → parsed JSON (to rewrite)
const fileData = {};

for (const file of actionFiles) {
  const filePath = path.join(ACTION_DIR, file);
  const raw = fs.readFileSync(filePath, 'utf-8');
  const data = JSON.parse(raw);
  fileData[filePath] = data;

  for (const key of Object.keys(data)) {
    if (!nameToUuid[key]) {
      nameToUuid[key] = crypto.randomUUID();
    }
  }
}

console.log(`Generated ${Object.keys(nameToUuid).length} UUIDs for action keys`);

// ─── Helper: recursively replace "action": "name" → "action": "uuid" ─────────
function replaceActionRefs(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(replaceActionRefs);

  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'action' && typeof v === 'string' && nameToUuid[v]) {
      result[k] = nameToUuid[v];
    } else {
      result[k] = replaceActionRefs(v);
    }
  }
  return result;
}

// ─── Step 2: Rewrite action files with UUID keys and "name" field ─────────────
for (const [filePath, data] of Object.entries(fileData)) {
  const newData = {};
  for (const [key, def] of Object.entries(data)) {
    const uuid = nameToUuid[key];
    // Add "name" field preserving original key as display name
    const newDef = { name: key, ...(def) };
    // Recursively replace any "action" references inside this definition
    const replaced = replaceActionRefs(newDef);
    newData[uuid] = replaced;
  }
  fs.writeFileSync(filePath, JSON.stringify(newData, null, 2) + '\n', 'utf-8');
  console.log(`Updated: ${path.relative(ROOT, filePath)} (${Object.keys(newData).length} entries)`);
}

// ─── Step 3: Update references in screens and fragments ───────────────────────
const screenFiles = walkFiles(path.join(ROOT, 'config', 'screens'), '.json');
const fragmentFiles = walkFiles(path.join(ROOT, 'config', 'fragments'), '.json');
const allFiles = [...screenFiles, ...fragmentFiles];

let totalReplacements = 0;
for (const filePath of allFiles) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    console.warn(`  Skipping (invalid JSON): ${path.relative(ROOT, filePath)}`);
    continue;
  }

  const replaced = replaceActionRefs(data);
  const newRaw = JSON.stringify(replaced, null, 2) + '\n';
  if (newRaw !== raw) {
    // Count replacements
    const oldRefs = (raw.match(/"action":\s*"[^"]+"/g) ?? []).filter(m => {
      const name = m.match(/"action":\s*"([^"]+)"/)?.[1];
      return name && nameToUuid[name];
    }).length;
    totalReplacements += oldRefs;
    fs.writeFileSync(filePath, newRaw, 'utf-8');
    console.log(`Updated: ${path.relative(ROOT, filePath)} (${oldRefs} refs replaced)`);
  }
}

console.log(`\nDone! Total refs replaced in screens/fragments: ${totalReplacements}`);
console.log('\nName → UUID mapping (first 10):');
const entries = Object.entries(nameToUuid).slice(0, 10);
for (const [name, uuid] of entries) {
  console.log(`  ${name} → ${uuid}`);
}
console.log(`  ... and ${Object.keys(nameToUuid).length - 10} more`);
