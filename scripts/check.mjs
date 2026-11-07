#!/usr/bin/env node
/**
 * Repository self-check, runnable without dependencies (`npm run check`).
 *
 * It validates the bundle manifest, the shipped files, the Cordis patch, both
 * locale documents, the default wallpaper bytes, and the Client module syntax.
 * CI additionally runs `node --check` on the two entry files.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

/** Record one failed expectation. */
function check(condition, message) {
  if (!condition) failures.push(message);
}

/** Read a UTF-8 file relative to the repository root. */
function read(relative) {
  return readFileSync(resolve(ROOT, relative), 'utf8');
}

/** True when a file exists relative to the repository root. */
function exists(relative) {
  return existsSync(resolve(ROOT, relative));
}

/** Report whether `files` covers at least one existing path (globs expanded by hand). */
function checkFileEntry(entry) {
  if (!entry.includes('*')) {
    check(exists(entry), `manifest file entry is missing: ${entry}`);
    return;
  }
  const directory = dirname(entry);
  const suffix = entry.slice(entry.indexOf('*') + 1);
  const found = exists(directory)
    && readdirSync(resolve(ROOT, directory)).some((name) => name.endsWith(suffix));
  check(found, `manifest glob entry matches nothing: ${entry}`);
}

// ---- manifest -----------------------------------------------------------
let pkg;
try {
  pkg = JSON.parse(read('package.json'));
} catch (error) {
  failures.push(`package.json is not valid JSON: ${error.message}`);
}

if (pkg !== undefined) {
  check(pkg.name === 'dsh-wallpaper-bg', `package name must be dsh-wallpaper-bg, found ${pkg.name}`);
  check(/^\d+\.\d+\.\d+$/.test(pkg.version ?? ''), `package version must be semver, found ${pkg.version}`);
  check(pkg.type === 'module', 'package type must be module');
  check(pkg.dsh?.bundle?.patch === './cordis.patch.yml', 'dsh.bundle.patch must point at ./cordis.patch.yml');
  check(pkg.dsh?.client?.platform === 'web', 'dsh.client.platform must be web');
  check(Array.isArray(pkg.dsh?.client?.inject), 'dsh.client.inject must be an array');
  check(pkg.exports?.['.'] === './index.js', 'exports["."] must be ./index.js');
  check(pkg.exports?.['./client'] === './client.js', 'exports["./client"] must be ./client.js');
  check(Array.isArray(pkg.files), 'package files must be an array');
  for (const entry of pkg.files ?? []) checkFileEntry(entry);
  for (const required of ['index.js', 'client.js', 'cordis.patch.yml', 'README.md', 'LICENSE']) {
    check(exists(required), `required repository file is missing: ${required}`);
  }
}

// ---- Cordis patch -------------------------------------------------------
if (exists('cordis.patch.yml')) {
  const patch = read('cordis.patch.yml');
  check(/^-\s*insert:/m.test(patch), 'cordis.patch.yml must insert a row');
  check(/id:\s*dsh-wallpaper-bg\b/.test(patch), 'cordis.patch.yml must insert the dsh-wallpaper-bg row');
  check(/name:\s*dsh-wallpaper-bg\b/.test(patch), 'cordis.patch.yml row must name the dsh-wallpaper-bg package');
}

// ---- locale documents ---------------------------------------------------
for (const locale of ['en', 'zh']) {
  const relative = `locale/${locale}.json`;
  try {
    const dict = JSON.parse(read(relative));
    check(typeof dict.meta?.title === 'string' && dict.meta.title !== '', `${relative} needs meta.title`);
    check(typeof dict.meta?.description === 'string' && dict.meta.description !== '', `${relative} needs meta.description`);
  } catch (error) {
    failures.push(`${relative} is not valid JSON: ${error.message}`);
  }
}
try {
  const icon = read('icon.svg').trim();
  check(icon.startsWith('<svg') && icon.includes('viewBox'), 'icon.svg must be an SVG document with a viewBox');
} catch (error) {
  failures.push(`icon.svg is not readable: ${error.message}`);
}

// ---- bundled default wallpaper -----------------------------------------
const asset = 'assets/default-wallpaper.webp';
if (!exists(asset)) {
  failures.push(`bundled wallpaper is missing: ${asset}`);
} else {
  const bytes = readFileSync(resolve(ROOT, asset));
  check(bytes.length > 12, `${asset} is too small to be an image`);
  check(bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP',
    `${asset} is not a WebP file`);
}

// ---- Client module ------------------------------------------------------
try {
  const source = read('client.js');
  new Script(source, { filename: 'client.js' });
  check(source.includes("id: 'dsh-wallpaper-bg'"), 'client.js must load the dsh-wallpaper-bg module id');
  check(source.includes('window.__ModuleLoader__.load'), 'client.js must register through __ModuleLoader__');
  check(source.includes('/api/dsh-wallpaper-bg/default'), 'client.js must fetch the bundled wallpaper route');
} catch (error) {
  failures.push(`client.js failed to parse: ${error.message}`);
}

// ---- host module --------------------------------------------------------
if (exists('index.js')) {
  const source = read('index.js');
  check(source.includes('export function apply'), 'index.js must export apply()');
  check(source.includes('webServer.register'), 'index.js must register the default wallpaper route');
  check(source.includes('assets/default-wallpaper.webp'), 'index.js must resolve the bundled wallpaper asset');
}

// ---- report -------------------------------------------------------------
if (failures.length > 0) {
  console.error(`✗ ${failures.length} check(s) failed:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log('✓ all checks passed');
}
