import test from 'node:test';
import assert from 'node:assert/strict';
import * as vworld from '../client/src/lib/vworld.js';
test('legacy models enter the scene before waiting for readiness', async () => {
  assert.equal(typeof vworld.loadSceneModel, 'function');
  let resolve;
  const model = { readyPromise: new Promise(r => { resolve = r; }) };
  const scene = { primitives: { add(m) { resolve(m); return m; }, remove() {} } };
  assert.equal(await vworld.loadSceneModel({ Model: { fromGltf: () => model } }, scene, {}), model);
});
test('a failed legacy load removes its primitive and surfaces the error', async () => {
  assert.equal(typeof vworld.loadSceneModel, 'function');
  const failure = new Error('Invalid GLB');
  const model = { readyPromise: Promise.reject(failure) };
  let removed;
  const scene = { primitives: { add: m => m, remove: m => { removed = m; } } };
  await assert.rejects(vworld.loadSceneModel({ Model: { fromGltf: () => model } }, scene, {}), /Invalid GLB/);
  assert.equal(removed, model);
});
test('async model API loads and adds a model once', async () => {
  assert.equal(typeof vworld.loadSceneModel, 'function');
  let added = 0;
  const model = {};
  const scene = { primitives: { add(m) { added++; return m; }, remove() {} } };
  assert.equal(await vworld.loadSceneModel({ Model: { fromGltfAsync: async () => model } }, scene, {}), model);
  assert.equal(added, 1);
});
