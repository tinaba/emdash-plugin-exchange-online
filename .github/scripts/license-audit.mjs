#!/usr/bin/env node
// License gate for docs/development-guide.md §G11 ("License scanning") and
// §G12 ("OSS and Licensing").
//
// Reads package-lock.json (lockfileVersion >= 2) and classifies every resolved
// package by its declared SPDX identifier. The lockfile already records the
// license metadata for the exact tree `npm ci` installs, so no install and no
// third-party package are required — this keeps the gate dependency-free
// (§15: no new dependency to review).
//
// Fails (exit 1) when:
//   * a package is outside the allowlist, or
//   * its license cannot be determined ("unresolved licensing", §15).
//
// Usage:
//   node .github/scripts/license-audit.mjs [--allow <spdx>] [--verbose]
//
// When GITHUB_STEP_SUMMARY is set (GitHub Actions), a markdown table is
// appended there as well.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..');

// Licenses compatible with distributing an Apache-2.0 plugin. Anything not
// listed here needs an explicit, reviewed decision (record it in
// THIRD_PARTY_NOTICES.md and extend this list or pass --allow).
const ALLOWED = new Set([
  'mit',
  'isc',
  'blueoak-1.0.0',
  'bsd-2-clause',
  'bsd-3-clause',
  '0bsd',
  'zlib',
  'unlicense',
  'cc0-1.0',
  'apache-2.0',
  'apache-2.0 with llvm-exception',
  'python-2.0',
  'postgresql',
]);

// Kept separate from ALLOWED only to produce a clearer message: these are
// copyleft / restricted families that §G12 treats as "incompatible dependencies
// to review" rather than an accidental allowlist omission.
const NEEDS_REVIEW = new Set([
  'gpl-1.0-only',
  'gpl-1.0-or-later',
  'gpl-2.0-only',
  'gpl-2.0-or-later',
  'gpl-3.0-only',
  'gpl-3.0-or-later',
  'lgpl-2.0-only',
  'lgpl-2.0-or-later',
  'lgpl-2.1-only',
  'lgpl-2.1-or-later',
  'lgpl-3.0-only',
  'lgpl-3.0-or-later',
  'agpl-3.0-only',
  'agpl-3.0-or-later',
  'sspl-1.0',
  'bsl-1.0',
  'npl-1.1',
  'fair-license',
  'nonstandard',
]);

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(
    [
      'Usage: node .github/scripts/license-audit.mjs [--allow <spdx>] [--verbose]',
      '',
      'Checks every package in package-lock.json against the license allowlist',
      'required by docs/development-guide.md §G11 / §G12.',
    ].join('\n'),
  );
  process.exit(0);
}

const verbose = args.includes('--verbose');
const extraAllowed = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--allow') {
    const value = args[i + 1];
    if (!value) {
      console.error('--allow requires a value, e.g. --allow "MIT OR ISC"');
      process.exit(2);
    }
    extraAllowed.push(value);
    i += 1;
  }
}

const allowlist = new Set([...ALLOWED, ...extraAllowed.map(normalizeSpdx)]);

function normalizeSpdx(spdx) {
  return String(spdx).trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Evaluate a simple SPDX expression. Supports the operators that appear in
 * real package metadata: OR (either side acceptable) and AND (both required),
 * plus parenthesised groups. No license-exceptions handling beyond the
 * `WITH` form being kept as part of the identifier string.
 */
function evaluateExpression(expression) {
  const expr = unwrapParens(String(expression).trim());
  if (expr === '') return true;

  const orParts = splitTopLevel(expr, ' OR ');
  if (orParts.length > 1) return orParts.some((part) => evaluateExpression(part));

  const andParts = splitTopLevel(expr, ' AND ');
  if (andParts.length > 1) return andParts.every((part) => evaluateExpression(part));

  return allowlist.has(normalizeSpdx(expr));
}

function unwrapParens(expr) {
  let value = expr;
  while (value.startsWith('(') && value.endsWith(')') && isBalanced(value.slice(1, -1))) {
    value = value.slice(1, -1).trim();
  }
  return value;
}

function isBalanced(text) {
  let depth = 0;
  for (const char of text) {
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

function splitTopLevel(text, separator) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    if (depth === 0 && text.slice(i, i + separator.length) === separator) {
      parts.push(current);
      current = '';
      i += separator.length - 1;
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part !== '');
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

/**
 * Collect license information from a lockfile package entry. npm stores either
 * `license` (string) or `licenses` (array of { type } / string), and legacy
 * `license: { type, url }`.
 */
function licenseOf(entry) {
  const raw = entry.license;
  if (typeof raw === 'string' && raw.trim() !== '') {
    return { expression: raw.trim(), source: 'lockfile:license' };
  }
  if (raw && typeof raw === 'object' && typeof raw.type === 'string') {
    return { expression: raw.type.trim(), source: 'lockfile:license.type' };
  }
  if (Array.isArray(entry.licenses)) {
    const types = entry.licenses
      .map((item) => (typeof item === 'string' ? item : item?.type))
      .filter((item) => typeof item === 'string' && item.trim() !== '')
      .map((item) => item.trim());
    if (types.length > 0) {
      return { expression: types.join(' OR '), source: 'lockfile:licenses' };
    }
  }
  return null;
}

const lockfilePath = path.join(REPO_ROOT, 'package-lock.json');
const packageJsonPath = path.join(REPO_ROOT, 'package.json');

if (!existsSync(lockfilePath)) {
  console.error('package-lock.json not found. Commit a lockfile so CI can audit a fixed dependency tree.');
  process.exit(1);
}

const lockfile = readJson(lockfilePath);
const manifest = existsSync(packageJsonPath) ? readJson(packageJsonPath) : {};
const directDependencies = new Set([
  ...Object.keys(manifest.dependencies ?? {}),
  ...Object.keys(manifest.devDependencies ?? {}),
]);

const packages = lockfile.packages;
if (!packages || typeof packages !== 'object') {
  console.error('Unsupported package-lock.json: no "packages" map (needs lockfileVersion >= 2).');
  process.exit(1);
}

/** @type {Map<string, { license: string, packages: string[] }>} */
const byLicense = new Map();
const unresolved = [];
const violations = [];
let audited = 0;

for (const [key, entry] of Object.entries(packages)) {
  if (key === '') continue; // the workspace root
  if (entry?.link === true) continue; // symlinked workspace package

  const name = typeof entry?.name === 'string' && entry.name !== '' ? entry.name : key.replace(/^node_modules\//, '');
  audited += 1;

  const info = licenseOf(entry);
  if (!info) {
    unresolved.push({ key, name, dev: entry?.dev === true });
    continue;
  }

  const isAllowed = evaluateExpression(info.expression);
  const record = byLicense.get(info.expression) ?? { license: info.expression, packages: [] };
  record.packages.push(name);
  byLicense.set(info.expression, record);

  if (!isAllowed) {
    const normalised = normalizeSpdx(info.expression);
    const reviewFamily = String(info.expression)
      .split(/\s+OR\s+/i)
      .some((part) => NEEDS_REVIEW.has(normalizeSpdx(part)));
    violations.push({
      key,
      name,
      version: entry?.version ?? 'unknown',
      license: info.expression,
      dev: entry?.dev === true,
      direct: directDependencies.has(name),
      copyleft: reviewFamily,
    });
  }
}

// ---------------------------------------------------------------- reporting
const lines = [];
lines.push('# Dependency license audit');
lines.push('');
lines.push(`Repository license: \`${manifest.license ?? 'unknown'}\`  `);
lines.push(`Audited packages: ${audited} (from \`package-lock.json\`, lockfileVersion ${lockfile.lockfileVersion})`);
lines.push(`Allowlist size: ${allowlist.size}`);
lines.push('');

const sortedLicenses = [...byLicense.entries()].sort((a, b) => b[1].packages.length - a[1].packages.length);
lines.push('| License | Packages | Used by (sample) |');
lines.push('|---|---:|---|');
for (const [license, record] of sortedLicenses) {
  const sample = record.packages.slice(0, 5).join(', ') + (record.packages.length > 5 ? ' …' : '');
  lines.push(`| \`${license}\` | ${record.packages.length} | ${sample} |`);
}
lines.push('');

if (unresolved.length > 0) {
  lines.push(`## Unresolved licensing (${unresolved.length})`);
  lines.push('');
  for (const item of unresolved) {
    lines.push(`- \`${item.name}\`${item.dev ? ' (dev)' : ''} — no license declared in the lockfile`);
  }
  lines.push('');
}

if (violations.length > 0) {
  lines.push(`## Allowlist violations (${violations.length})`);
  lines.push('');
  for (const item of violations) {
    const flags = [item.direct ? 'direct' : null, item.dev ? 'dev' : null, item.copyleft ? 'copyleft family' : null]
      .filter(Boolean)
      .join(', ');
    lines.push(`- \`${item.name}@${item.version}\` — \`${item.license}\`${flags ? ` (${flags})` : ''}`);
  }
  lines.push('');
}

const report = lines.join('\n');

// stdout first (always useful locally), then the Actions job summary.
console.log(report);

const summaryPath = process.env.GITHUB_STEP_SUMMARY;
if (summaryPath) {
  writeFileSync(summaryPath, `${report}\n`, { flag: 'a' });
}

if (verbose) {
  console.log('\nAllowlist:');
  console.log([...allowlist].sort().join('\n'));
}

if (unresolved.length > 0) {
  console.error('');
  console.error(
    `ERROR: ${unresolved.length} package(s) have no license metadata. ` +
      'docs/development-guide.md §15 forbids adding a dependency with unresolved licensing.',
  );
  process.exit(1);
}

if (violations.length > 0) {
  console.error('');
  console.error(
    `ERROR: ${violations.length} package(s) are outside the license allowlist ` +
      '(docs/development-guide.md §G12). Review them against THIRD_PARTY_NOTICES.md, then either ' +
      'remove the dependency or extend the allowlist in .github/scripts/license-audit.mjs with a reviewed rationale.',
  );
  process.exit(1);
}

console.log('');
console.log(`OK: all ${audited} packages are within the license allowlist.`);
