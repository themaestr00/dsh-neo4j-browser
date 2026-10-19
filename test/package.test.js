import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));

test('package entry points and metadata resolve after directory restructuring', async () => {
  assert.equal(manifest.exports['.'], './src/index.js');
  assert.equal(manifest.exports['./client'], './dist/client.js');
  assert.equal(manifest.icon, './assets/icon.svg');
  for (const path of [manifest.exports['.'], manifest.exports['./client'], manifest.icon, manifest.dsh.bundle.patch, 'locale/en.json']) {
    await access(new URL(path, root));
  }
  const entry = await import(new URL(manifest.exports['.'], root));
  assert.equal(typeof entry.apply, 'function');
  assert.equal(typeof entry.Neo4jBrowser, 'function');
  const {VERSION}=await import('../src/backend.js');
  const lock=JSON.parse(await readFile(new URL('package-lock.json',root),'utf8'));
  assert.equal(VERSION,manifest.version);
  assert.equal(lock.version,manifest.version);
  assert.deepEqual(lock.packages[''].devDependencies,manifest.devDependencies);
  assert.equal(lock.packages[''].version,manifest.version);
});

test('package allowlist includes source and artwork without development artifacts', () => {
  assert.deepEqual(manifest.files, ['src', 'assets', 'dist', 'build.mjs', 'cordis.patch.yml', 'locale', 'README.md']);
  for (const path of ['test', 'node_modules', '.npm-cache', 'generation-smoke']) {
    assert.ok(!manifest.files.includes(path));
  }
});
