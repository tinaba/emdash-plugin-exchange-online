#!/usr/bin/env node
// Validation of emdash-plugin.jsonc.
//
// This is the "Manifest validation" category of docs/development-guide.md §G11.
// It checks the manifest against the rules published by upstream EmDash
// (emdash-cms/emdash, commit 3e06fbd33fe242613919aa05a9686a94d31715ba):
//   - packages/plugin-cli/schemas/emdash-plugin.schema.json — required keys
//     (slug, license, publisher, capabilities, allowedHosts, storage) and
//     additionalProperties: false, reproduced by MANIFEST_PROPERTIES below.
//   - docs/src/content/docs/plugins/creating-plugins/manifest.mdx — per-field
//     rules (slug shape, version handling, author/security forms, limits).
//   - docs/src/content/docs/plugins/creating-plugins/capabilities.mdx — the
//     recognised capability set and the network:request <-> allowedHosts rule
//     that upstream only enforces at bundle/publish time ("typos fail the
//     build"), so we enforce it here instead.
// It also verifies that manifest metadata stays consistent with package.json
// (§G4 / §G12) and that no secret material has been embedded (§G7 / §23).
//
// This is NOT a replacement for `emdash-plugin validate`: it has no access to
// the bundled backend, the published schema is a snapshot pinned by the commit
// above, and a capability upstream adds later fails here until the list is
// refreshed. Wire the official CLI once @emdash-cms/plugin-cli is approved as a
// dependency (§15); that is the check that has authority.
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

// Code points, not graphemes; a close-enough proxy for the documented limits and
// it only ever produces a false pass, never a false failure of the real validator.
const sizeOf = (value) => Array.from(value).length;

// -------------------------------------------------- official schema constants
// Top-level keys accepted by packages/plugin-cli/schemas/emdash-plugin.schema.json
// (additionalProperties: false). Anything else is an invented or mistyped field.
const MANIFEST_PROPERTIES = new Set([
  '$schema',
  'admin',
  'allowedHosts',
  'author',
  'authors',
  'capabilities',
  'description',
  'keywords',
  'license',
  'name',
  'publisher',
  'release',
  'repo',
  'sections',
  'security',
  'securityContacts',
  'slug',
  'storage',
  'version',
]);

// The recognised capability set from capabilities.mdx "Capability reference".
// `emdash-plugin bundle` fails on a capability outside the recognised set
// ("typos fail the build"), so this script fails on it too. Refresh this list
// from upstream when it is edited; unknown names are the invention this repo's
// §4.4 is specifically guarding against.
const KNOWN_CAPABILITIES = new Set([
  'bylines:read',
  'comments:moderate',
  'comments:read',
  'content:publish',
  'content:read',
  'content:restore',
  'content:revisions:read',
  'content:write',
  'email:send',
  'hooks.content-policy:register',
  'hooks.email-events:register',
  'hooks.email-transport:register',
  'hooks.page-fragments:register',
  'media:bytes:read',
  'media:metadata:write',
  'media:read',
  'media:write',
  'network:request',
  'network:request:unrestricted',
  'redirects:read',
  'redirects:write',
  'schema:read',
  'taxonomies:read',
  'taxonomies:write',
  'users:read',
]);

// capabilities.mdx "Implications": these capabilities already grant these, so
// listing both is noise in the consent dialog (not an error upstream).
const IMPLIED_BY = new Map([
  ['content:read', ['content:revisions:read', 'content:write', 'content:publish']],
  ['comments:read', ['comments:moderate']],
  ['taxonomies:read', ['taxonomies:write']],
  ['media:read', ['media:write']],
  ['redirects:read', ['redirects:write']],
  ['network:request', ['network:request:unrestricted']],
]);

const MANIFEST_LIMITS = {
  capabilities: 32, // schema maxItems
  allowedHosts: 64, // schema maxItems
  keywords: 5, // manifest.mdx
  authors: 32, // manifest.mdx
  securityContacts: 8, // manifest.mdx
  name: 100, // graphemes
  description: 140, // graphemes
};

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

// The official schema sets additionalProperties: false: an unrecognised key is a
// mistyped field or an invented one, and either way `emdash-plugin validate`
// rejects it, so catch it here with a clearer message.
for (const key of Object.keys(manifest)) {
  if (!MANIFEST_PROPERTIES.has(key)) {
    fail(`Unknown top-level property "${key}". The official schema allows only: ${[...MANIFEST_PROPERTIES].sort().join(', ')} (§4.4 No API Guessing).`);
  }
}

// Open review items are kept as comments so they stay visible. Report them
// instead of silently accepting a manifest that is not publishable yet.
for (const line of raw.split('\n')) {
  const trimmed = line.trim().replace(/^\/\/\s*/, '');
  if (/^PENDING\b/.test(trimmed)) {
    warn(`Open item in ${relative}: ${trimmed.slice(0, 160)}`);
  }
}

// §G4 "Review at minimum" list, typed by the official schema.
requireField(manifest, '$schema', 'string', '§G4: $schema (keep the value `emdash-plugin init` writes)');
const slug = requireField(manifest, 'slug', 'string', '§G4: slug');
const publisher = requireField(manifest, 'publisher', 'object-or-string', '§G4: publisher (Atmosphere DID or handle)');
const license = requireField(manifest, 'license', 'string', '§G4: license (fixed value Apache-2.0, §G12)');

if (isNonEmptyString(publisher) && !publisher.startsWith('did:')) {
  warn(`publisher "${publisher}" is a handle, not a DID: a handle can move to another account, and a mismatch fails with MANIFEST_PUBLISHER_MISMATCH with no override flag (manifest.mdx "Publisher pinning", §G3).`);
}

// `author` | `authors` are alternative forms; declare exactly one (manifest.mdx).
if (manifest.author !== undefined && manifest.authors !== undefined) {
  fail('"author" and "authors" are alternative forms; declare only one.');
}
if (manifest.author === undefined && manifest.authors === undefined) {
  fail('Missing "author" or "authors" (§G4: author or authors).');
}
if (manifest.author !== undefined) {
  if (!isPlainObject(manifest.author)) {
    fail('"author" must be an object (official form: { name, url?, email? }).');
  } else {
    if (!isNonEmptyString(manifest.author.name)) fail('"author.name" must be a non-empty string.');
    else if (sizeOf(manifest.author.name) > 64) fail(`"author.name" is ${sizeOf(manifest.author.name)} characters; the limit is 64.`);
    for (const key of Object.keys(manifest.author)) {
      if (!['name', 'url', 'email'].includes(key)) fail(`"author.${key}" is not part of the official author object.`);
    }
  }
}
if (manifest.authors !== undefined) {
  if (!Array.isArray(manifest.authors)) {
    fail('"authors" must be an array.');
  } else {
    if (manifest.authors.length < 1) fail('"authors" must contain at least one entry.');
    if (manifest.authors.length > MANIFEST_LIMITS.authors) fail(`"authors" has ${manifest.authors.length} entries; the limit is ${MANIFEST_LIMITS.authors}.`);
    manifest.authors.forEach((item, index) => {
      if (!isPlainObject(item) || !isNonEmptyString(item.name)) fail(`authors[${index}] must be an object with a non-empty "name".`);
    });
  }
}

// `security` | `securityContacts` are alternative forms; each contact needs an
// email, a url, or both (manifest.mdx "Reporting").
const security = manifest.security;
const contacts = manifest.securityContacts;
if (security === undefined && contacts === undefined) {
  fail('Missing "security" or "securityContacts" (§G4: security).');
}
const contactIssues = (value, trail, limit) => {
  const list = Array.isArray(value) ? value : [value];
  if (Array.isArray(value)) {
    if (value.length < 1) fail(`"${trail}" must contain at least one contact.`);
    if (value.length > limit) fail(`"${trail}" has ${value.length} entries; the limit is ${limit}.`);
  } else if (!isPlainObject(value)) {
    fail(`"${trail}" must be a contact object or an array of contacts.`);
    return;
  }
  list.forEach((item, index) => {
    const label = Array.isArray(value) ? `${trail}[${index}]` : trail;
    if (!isPlainObject(item)) {
      fail(`${label} must be an object.`);
      return;
    }
    const hasEmail = isNonEmptyString(item.email);
    const hasUrl = isNonEmptyString(item.url);
    if (!hasEmail && !hasUrl) fail(`${label} must contain an "email", a "url", or both (manifest.mdx).`);
    if (hasUrl && !/^https:\/\//i.test(item.url)) warn(`${label}.url should be an https: URL: "${item.url}".`);
  });
};
if (security !== undefined) contactIssues(security, 'security', MANIFEST_LIMITS.securityContacts);
if (contacts !== undefined) contactIssues(contacts, 'securityContacts', MANIFEST_LIMITS.securityContacts);

// Identity fields are optional upstream but on the §G4 review list.
const description = requireField(manifest, 'description', 'string', '§G4: description');
if (isNonEmptyString(description) && sizeOf(description) > MANIFEST_LIMITS.description) {
  fail(`"description" is ${sizeOf(description)} characters; the limit is ${MANIFEST_LIMITS.description} (manifest.mdx).`);
}
if (manifest.name !== undefined) {
  if (!isNonEmptyString(manifest.name)) fail('"name" must be a non-empty string.');
  else if (sizeOf(manifest.name) > MANIFEST_LIMITS.name) fail(`"name" is ${sizeOf(manifest.name)} characters; the limit is ${MANIFEST_LIMITS.name} (manifest.mdx).`);
}
if (manifest.keywords !== undefined) {
  if (!Array.isArray(manifest.keywords)) {
    fail('"keywords" must be an array.');
  } else {
    if (manifest.keywords.length > MANIFEST_LIMITS.keywords) fail(`"keywords" has ${manifest.keywords.length} entries; the limit is ${MANIFEST_LIMITS.keywords} (manifest.mdx).`);
    manifest.keywords.forEach((item, index) => {
      if (!isNonEmptyString(item)) fail(`keywords[${index}] must be a non-empty string.`);
      else if (sizeOf(item) > 64) fail(`keywords[${index}] is ${sizeOf(item)} characters; the limit is 64.`);
    });
  }
}

const capabilities = requireField(manifest, 'capabilities', 'array', '§G4: capabilities');
const declaredCapabilities = Array.isArray(capabilities) ? capabilities.filter(isNonEmptyString) : [];
if (Array.isArray(capabilities)) {
  if (capabilities.length > MANIFEST_LIMITS.capabilities) fail(`"capabilities" has ${capabilities.length} entries; the limit is ${MANIFEST_LIMITS.capabilities} (schema maxItems).`);
  capabilities.forEach((item, index) => {
    if (!isNonEmptyString(item)) {
      fail(`capabilities[${index}] must be a non-empty string.`);
      return;
    }
    if (!KNOWN_CAPABILITIES.has(item)) {
      fail(`capabilities[${index}] "${item}" is not in the recognised capability set. A typo fails \`emdash-plugin bundle\`; an unrecognised name is an invented interface (§4.4). Refresh KNOWN_CAPABILITIES from capabilities.mdx if upstream added it.`);
    }
    if (declaredCapabilities.indexOf(item) !== index) fail(`capabilities[${index}] duplicates "${item}".`);
  });
  if (capabilities.length === 0) {
    // Empty is schema-valid and is what `emdash-plugin init` writes, so do not
    // fail on it: that is a policy question (the §G5 review table), not a type error.
    warn('"capabilities" is empty: the plugin requests no access at all. Confirm the code really makes no ctx.* call (§G5).');
  }
  for (const [implied, sources] of IMPLIED_BY) {
    const grantors = declaredCapabilities.filter((item) => sources.includes(item));
    if (declaredCapabilities.includes(implied) && grantors.length > 0) {
      warn(`"${implied}" is redundant: implied by ${grantors.map((item) => `"${item}"`).join(', ')} (capabilities.mdx "Implications").`);
    }
  }
}

const allowedHosts = requireField(manifest, 'allowedHosts', 'array', '§G4: allowedHosts');
if (Array.isArray(allowedHosts)) {
  if (allowedHosts.length > MANIFEST_LIMITS.allowedHosts) fail(`"allowedHosts" has ${allowedHosts.length} entries; the limit is ${MANIFEST_LIMITS.allowedHosts} (schema maxItems).`);

  const wantsUnrestricted = declaredCapabilities.includes('network:request:unrestricted');
  const wantsNetwork = declaredCapabilities.includes('network:request');
  // Cross-field rules that upstream only applies at bundle/publish time.
  if (wantsUnrestricted && allowedHosts.length > 0) {
    fail('`network:request:unrestricted` requires `allowedHosts` to be empty (capabilities.mdx "Bundle-time validation").');
  }
  if (wantsNetwork && !wantsUnrestricted && allowedHosts.length === 0) {
    fail('`network:request` requires a non-empty `allowedHosts` (capabilities.mdx "Bundle-time validation").');
  }
  if (!wantsNetwork && !wantsUnrestricted && allowedHosts.length > 0) {
    warn('"allowedHosts" is non-empty but no network capability is declared; the hosts grant nothing. Remove them or declare `network:request` (§4.1 least privilege).');
  }

  allowedHosts.forEach((item, index) => {
    if (!isNonEmptyString(item)) {
      fail(`allowedHosts[${index}] must be a non-empty string.`);
      return;
    }
    if (/\s/.test(item)) fail(`allowedHosts[${index}] contains whitespace: "${item}".`);
    // Bare hostnames only: a scheme, port or path is never matched by the
    // allow-list bridge and would silently stop matching requests.
    if (!/^(\*\.)?[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/.test(item)) {
      fail(`allowedHosts[${index}] "${item}" is not a bare hostname (no scheme, port, or path; "*" only as a leading "*.").`);
    }
    if (item === '*') {
      fail(`allowedHosts[${index}] is "${item}", which matches every host. Use exact hosts, or \`network:request:unrestricted\` only for operator-supplied URLs (§4.1, §G6).`);
    }
    if (item.startsWith('*.')) {
      // Upstream accepts a leading "*." subdomain wildcard; this repo does not
      // without an approval recorded in the §G6 review table.
      fail(`allowedHosts[${index}] is a wildcard ("${item}"). Upstream allows it, but §G6 forbids broad network access without explicit approval. Declare the minimum exact hosts.`);
    }
    if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/i.test(item)) {
      warn(`allowedHosts[${index}] is a loopback/private host: "${item}". Confirm this is intentional for production.`);
    }
  });
}

requireField(manifest, 'storage', 'object', '§G4: storage (an empty object is schema-valid and states that no collection is requested)');
const repo = requireField(manifest, 'repo', 'string', '§G4: repo');
if (isNonEmptyString(repo) && !/^https:\/\//i.test(repo)) {
  fail(`"repo" must be an HTTPS URL of the source repository, found "${repo}" (manifest.mdx "Repository").`);
}

// slug: a lowercase letter, then letters/digits/underscore/hyphen, max 64
// (manifest.mdx "Identity"). It is used in plugin route URLs and is not the
// npm package name.
if (isNonEmptyString(slug) && !/^[a-z][a-z0-9_-]{0,63}$/.test(slug)) {
  fail(`"${slug}" is not a valid slug: start with a lowercase letter, then lowercase letters, digits, "_" or "-", at most 64 characters (manifest.mdx "Identity").`);
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
  if (!manifest.version && !isNonEmptyString(packageJson.version)) {
    // manifest.mdx "Version": an npm package keeps its version in package.json
    // and omits it from the manifest, so an absent manifest version is the
    // recommended form — but the plugin must have a version somewhere.
    fail('No version anywhere: `emdash-plugin build` needs one. Add it to package.json (recommended) or to the manifest (§G3).');
  }
  const repoValue = typeof packageJson.repository === 'string' ? packageJson.repository : packageJson.repository?.url;
  if (isNonEmptyString(repo) && isNonEmptyString(repoValue)) {
    // Accept every spelling of the same GitHub URL: `https://`, `ssh://`,
    // `git@host:path`, and the `git+` prefix npm writes for `repository.url`.
    const normalize = (value) => {
      let out = String(value).toLowerCase().trim();
      // A repeated group so stacked prefixes such as `git+ssh://git@` come off in one pass.
      out = out.replace(/^((git\+|git@|https:\/\/|ssh:\/\/|git:\/\/|ssh:))+/, '');
      return out
        .replace(/^github\.com[:/]/, '')
        .replace(/\.git$/, '')
        .replace(/\/$/, '');
    };
    if (normalize(repo) !== normalize(repoValue)) {
      warn(`repo "${repo}" and package.json repository "${repoValue}" resolve differently (§G12).`);
    }
  }
}

// §G4 "release compatibility" is `release.requires`, keyed by `env:<name>` or a
// package DID (manifest.mdx "Release metadata"), e.g. { "env:emdash": ">=0.37.0" }.
// §G0/§G1 have not chosen a minimum EmDash version yet, so the manifest leaves it
// out on purpose. Warn rather than fail: an untested range would be an invented
// compatibility claim (§4.4), and nothing is published until G4/G5 close.
const releaseRequires = manifest.release?.requires;
if (!isPlainObject(releaseRequires) || Object.keys(releaseRequires).length === 0) {
  warn('release.requires is absent: §G4 wants release compatibility, e.g. { "env:emdash": ">=x.y.z" }. Fill it in once §G0/§G1 fix the tested EmDash version.');
} else {
  for (const [key, value] of Object.entries(releaseRequires)) {
    if (!/^(env:[a-z][a-z0-9-]*|did:)/.test(key)) {
      warn(`release.requires key "${key}" should be "env:<name>" or a package DID (manifest.mdx "Release metadata").`);
    }
    if (!isNonEmptyString(value)) fail(`release.requires["${key}"] must be a semver range string.`);
  }
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
console.log('OK: the manifest matches the published EmDash manifest rules and is internally consistent with package.json.');
console.log('Note: `emdash-plugin validate` remains the authoritative check once @emdash-cms/plugin-cli is an approved dependency (§15).');
