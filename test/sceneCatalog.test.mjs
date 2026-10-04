import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import catalogModule from '../dist/sceneCatalog.js';

const { SceneCatalog } = catalogModule;

test('the scene catalog stores every device and rewrites the file only on changes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoleaf-catalog-'));
  const file = path.join(dir, 'scenes.json');
  try {
    const catalog = new SceneCatalog(file);
    catalog.record('S1', 'Porch', 'NL73K1', ['Forest', 'Ocean']);
    const first = fs.statSync(file).mtimeMs;
    const written = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(written.S1.scenes, ['Forest', 'Ocean']);
    assert.equal(written.S1.name, 'Porch');

    fs.utimesSync(file, new Date(0), new Date(0));
    catalog.record('S1', 'Porch', 'NL73K1', ['Forest', 'Ocean']);
    assert.equal(fs.statSync(file).mtimeMs, 0, 'unchanged list must not be written again');
    assert.notEqual(first, 0);

    catalog.record('S2', 'Hall', 'NL42', ['Party']);
    const reloaded = new SceneCatalog(file);
    reloaded.record('S1', 'Porch', 'NL73K1', ['Forest']);
    const final = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(Object.keys(final).sort(), ['S1', 'S2']);
    assert.deepEqual(final.S1.scenes, ['Forest']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
