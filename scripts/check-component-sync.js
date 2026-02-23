#!/usr/bin/env node
/**
 * Ensures config/component-names.ts stays in sync with lib/sdui/component-registry.tsx.
 * Run after adding/removing components from the registry.
 * Exits 1 if out of sync.
 */

const fs = require('fs');
const path = require('path');

const REGISTRY_PATH = path.join(__dirname, '../lib/sdui/component-registry.tsx');
const COMPONENT_NAMES_PATH = path.join(__dirname, '../config/component-names.ts');

const registryContent = fs.readFileSync(REGISTRY_PATH, 'utf8');
const namesContent = fs.readFileSync(COMPONENT_NAMES_PATH, 'utf8');

// Extract keys from COMPONENT_REGISTRY = { ... }
const registryMatch = registryContent.match(/COMPONENT_REGISTRY[^=]*=\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}/s);
if (!registryMatch) {
  console.error('Could not find COMPONENT_REGISTRY in', REGISTRY_PATH);
  process.exit(1);
}
const body = registryMatch[1];
// Match "  Key," or "  Key: Value," (key is the exported name)
const keyMatch = body.matchAll(/^\s*([A-Za-z][A-Za-z0-9]*)\s*(?::|,)/gm);
const registryKeys = [...new Set([...keyMatch].map((m) => m[1]))].sort();

// Extract from COMPONENT_NAMES = [ ... ]
const namesMatch = namesContent.match(/COMPONENT_NAMES\s*=\s*\[([\s\S]*?)\]\s*as\s*const/);
if (!namesMatch) {
  console.error('Could not find COMPONENT_NAMES in', COMPONENT_NAMES_PATH);
  process.exit(1);
}
const namesBody = namesMatch[1];
const configNames = namesBody
  .split(',')
  .map((s) => s.replace(/['"]/g, '').trim())
  .filter(Boolean)
  .sort();

const inRegistry = registryKeys.filter((k) => !configNames.includes(k));
const inConfig = configNames.filter((k) => !registryKeys.includes(k));

if (inRegistry.length || inConfig.length) {
  console.error('Component sync mismatch:\n');
  if (inRegistry.length) {
    console.error('  In registry but NOT in component-names:', inRegistry.join(', '));
    console.error('  → Add these to config/component-names.ts\n');
  }
  if (inConfig.length) {
    console.error('  In component-names but NOT in registry:', inConfig.join(', '));
    console.error('  → Remove from config/component-names.ts or add to registry\n');
  }
  process.exit(1);
}

console.log('✓ component-names.ts is in sync with component-registry.tsx');
