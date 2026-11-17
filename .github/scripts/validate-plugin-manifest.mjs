#!/usr/bin/env node
// Structural validation of emdash-plugin.jsonc.
//
// Scope is deliberately narrow: this is the "Manifest validation" category of
// docs/development-guide.md §G11 *before* the official EmDash plugin CLI is
// confirmed by Phase 0 G3/G4. It verifies that every §G4 review item is present
// and well-typed, that manifest metadata stays consistent with package.json
// (§G4 / §G12), and that no secret material has been embedded in the manifest
// (§G7 / §23). It does NOT validate EmDash semantics — a real schema check must
// come from the official tool once G3/G4 close (§4.4 No API Guessing).
//
// Usage:
//   node .github/scripts/validate-plugin-manifest.mjs [path/to/emdash-plugin.jsonc]
//
// Exit codes: 0 = passed, 1 = validation failed, 2 = usage / file not found.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..');

const manifestPath = path.resolve(REPO_ROOT, process.argv[2] ?? 'emdash-plugin.jsonc');
const packageJsonPath = path.join(REPO_ROOT, 'package.json');

const errors = [];
const warnings = [];

function fail(message) {
  errors.push(message);
}

function warn(message) {
  warnings.push(message);
}

// ------------------------------------------------------------ JSONC parsing
/**
 * Strip line and block comments and trailing commas, then JSON.parse. String
 * and escape aware, so a // inside a URL is not treated as a comment.
 */
function parseJsonc(text) {
  const stripped = stripJsonComments(text);
  return JSON.parse(removeTrailingCommas(stripped));
}

function stripJsonComments(input) {
  let out = '';
  let i = 0;
  let inString = false;
  let quote = '';
  while (i < input.length) {
    const char = input[i];
    const next = input[i + 1];

    if (inString) {
      if (char === '\\' && i + 1 < input.length) {
        out += char + next;
        i += 2;
        continue;
      }
      if (char === quote) {
        inString = false;
        quote = '';
      }
      out += char;
      i += 1;
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      out += char;
      i += 1;
      continue;
    }
    if (char === '/' && next === '/') {
      while (i < input.length && input[i] !== '\n') i += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      i += 2;
      while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += char;
    i += 1;
  }
  return out;
}

/** Remove trailing commas that JSON.parse rejects (outside strings). */
function removeTrailingCommas(text) {
  let out = '';
  let inString = false;
  let quote = '';
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (char === '\\' && i + 1 < text.length) {
        out += char + text[i + 1];
        i += 1;
        continue;
      }
      if (char === quote) inString = false;
      out += char;
      continue;
    }
    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      out += char;
      continue;
    }
    if (char === ',') {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j += 1;
      if (text[j] === ']' || text[j] === '}') continue; // drop it
    }
    out += char;
  }
  return out;
}

// ------------------------------------------------------------- secret guard
// Key names that must never appear in a committed manifest. EmDash injects
// runtime secrets through its secret store (docs/development-guide.md §G7).
const SECRET_KEY_PATTERN =
  /^(secret|secret[s]?|clientsecret|client_secret|apikey|api_key|accesskey|access_key|accesstoken|access_token|refreshtoken|refresh_token|privkey|privatekey|private_key|password|passwd|credential[s]?|bearertoken)$/i;

function scanForSecrets(value, trail) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForSecrets(item, `${trail}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (SECRET_KEY_PATTERN.test(key)) {
        fail(`Secret-like key "${key}" at ${trail}. Store secrets in the EmDash secret store, never in the manifest (§G7).`);
      }
      if (typeof item === 'string' && item.includes('-----BEGIN')) {
        fail(`PEM-like material at ${trail}.${key}. Never commit private keys (§G7, .gitignore).`);
      }
      scanForSecrets(item, `${trail}.${key}`);
    }
  }
}

// ------------------------------------------------------------------ helpers
const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function requireField(manifest, key, expected, note) {
  const present = Object.prototype.hasOwnProperty.call(manifest, key);
  const value = manifest[key];
  if (!present || value === undefined || value === null || value === '') {
    fail(`Missing required field "${key}" (${note}).`);
    return undefined;
  }
  if (expected === 'string' && !isNonEmptyString(value)) fail(`"${key}" must be a non-empty string.`);
  if (expected === 'object' && !isPlainObject(value)) fail(`"${key}" must be an object.`);
  if (expected === 'array' && !Array.isArray(value)) fail(`"${key}" must be an array.`);
  if (expected === 'object-or-string' && !isPlainObject(value) && !isNonEmptyString(value)) {
    fail(`"${key}" must be a non-empty string or an object.`);
  }
  return value;
}

// --------------------------------------------------------------------- main
if (!existsSync(manifestPath)) {
  console.error(`Manifest not found: ${manifestPath}`);
  console.error('Create emdash-plugin.jsonc (docs/development-guide.md §G4) or pass its path as an argument.');
  process.exit(2);
}

let manifest;
let raw;
try {
  raw = readFileSync(manifestPath, 'utf8');
  manifest = parseJsonc(raw);
} catch (error) {
  console.error(`${manifestPath} is not valid JSONC: ${error.message}`);
  process.exit(1);
}

if (!isPlainObject(manifest)) {
  console.error(`${manifestPath} must contain a JSON object.`);
  process.exit(1);
}

const relative = path.relative(REPO_ROOT, manifestPath) || path.basename(manifestPath);
console.log(`Validating ${relative} against docs/development-guide.md §G4`);

scanForSecrets(manifest, '$');

// §G4 "Review at minimum" list.
requireField(manifest, '$schema', 'string', '§G4: $schema');
const slug = requireField(manifest, 'slug', 'string', '§G4: slug');
requireField(manifest, 'publisher', 'object-or-string', '§G4: publisher');
const license = requireField(manifest, 'license', 'string', '§G4: license (fixed value Apache-2.0, §G12)');

if (!manifest.author && !manifest.authors) {
  fail('Missing "author" or "authors" (§G4: author or authors).');
}
if (manifest.author && !isPlainObject(manifest.author) && !isNonEmptyString(manifest.author)) {
  fail('"author" must be a non-empty string or an object.');
}
if (manifest.authors && !Array.isArray(manifest.authors)) {
  fail('"authors" must be an array.');
}

requireField(manifest, 'security', 'object', '§G4: security');
requireField(manifest, 'description', 'string', '§G4: description');

const capabilities = requireField(manifest, 'capabilities', 'array', '§G4: capabilities');
if (Array.isArray(capabilities)) {
  if (capabilities.length === 0) fail('"capabilities" must list at least one capability (or an explicit empty review in §G5).');
  capabilities.forEach((item, index) => {
    if (!isNonEmptyString(item)) fail(`capabilities[${index}] must be a non-empty string.`);
  });
}

const allowedHosts = requireField(manifest, 'allowedHosts', 'array', '§G4: allowedHosts');
if (Array.isArray(allowedHosts)) {
  if (allowedHosts.length === 0) fail('"allowedHosts" must list at least one host (§4.1 least privilege, §G6).');
  allowedHosts.forEach((item, index) => {
    if (!isNonEmptyString(item)) {
      fail(`allowedHosts[${index}] must be a non-empty string.`);
      return;
    }
    if (/\s/.test(item)) fail(`allowedHosts[${index}] contains whitespace: "${item}".`);
    if (item === '*' || item.startsWith('*.')) {
      fail(`allowedHosts[${index}] is a wildcard ("${item}"). Declare the minimum exact hosts (§4.1, §G6).`);
    }
    if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|10\.0\.0\.)/i.test(item)) {
      warn(`allowedHosts[${index}] is a loopback/private host: "${item}". Confirm this is intentional for production.`);
    }
  });
}

requireField(manifest, 'storage', 'object', '§G4: storage');
const repo = requireField(manifest, 'repo', 'string', '§G4: repo');

if (isNonEmptyString(slug) && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
  fail(`"${slug}" is not a valid slug: use lowercase letters, digits and single hyphens.`);
}

// -------------------------------------------------- package.json consistency
let packageJson = null;
if (existsSync(packageJsonPath)) {
  try {
    packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  } catch (error) {
    warn(`Could not parse package.json for cross-checks: ${error.message}`);
  }
} else {
  warn('package.json not found; skipped manifest/package.json consistency checks (§G12).');
}

if (packageJson) {
  if (isNonEmptyString(license) && isNonEmptyString(packageJson.license) && license !== packageJson.license) {
    fail(`license mismatch: manifest "${license}" vs package.json "${packageJson.license}" (§G12).`);
  }
  if (isNonEmptyString(license) && license !== 'Apache-2.0') {
    fail(`license must be "Apache-2.0" per docs/development-guide.md §G4/§G12, found "${license}".`);
  }
  if (isNonEmptyString(manifest.version) && isNonEmptyString(packageJson.version) && manifest.version !== packageJson.version) {
    fail(`version mismatch: manifest "${manifest.version}" vs package.json "${packageJson.version}" (§G12).`);
  }
  if (!manifest.version) {
    warn('"version" is absent; §G3 requires a consistent plugin version — confirm how EmDash derives it.');
  }
  const repoValue = typeof packageJson.repository === 'string' ? packageJson.repository : packageJson.repository?.url;
  if (isNonEmptyString(repo) && isNonEmptyString(repoValue)) {
    const normalize = (value) =>
      String(value)
        .toLowerCase()
        .replace(/^(git\+|https?:\/\/|ssh:\/\/|git@)/, '')
        .replace(/\.git$/, '')
        .replace(/^github\.com[:/]/, '')
        .replace(/\/$/, '');
    if (normalize(repo) !== normalize(repoValue)) {
      warn(`repo "${repo}" and package.json repository "${repoValue}" resolve differently (§G12).`);
    }
  }
}

// §G4 "release compatibility" cannot be verified here: the field names are not
// documented yet (Phase 0 G0/G1). Make that explicit instead of inventing one.
if (!manifest.emdashVersion && !manifest.emdash && !manifest.engines) {
  warn('No EmDash release-compatibility field found. §G4 requires "release compatibility"; confirm the field name with G0/G1.');
}

// ------------------------------------------------------------------- report
if (warnings.length > 0) {
  console.log('');
  console.log(`Warnings (${warnings.length}):`);
  for (const message of warnings) console.log(`  - ${message}`);
}

if (errors.length > 0) {
  console.error('');
  console.error(`Errors (${errors.length}):`);
  for (const message of errors) console.error(`  - ${message}`);
  console.error('');
  console.error('Manifest validation failed.');
  process.exit(1);
}

console.log('');
console.log('OK: all §G4 minimum manifest fields are present and internally consistent.');
console.log('Note: this is a structural check only. Wire the official EmDash plugin CLI validator once Phase 0 G3/G4 confirm it (§4.4).');
