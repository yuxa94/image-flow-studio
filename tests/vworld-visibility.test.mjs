import test from 'node:test';
import assert from 'node:assert/strict';
import * as vworld from '../client/src/lib/vworld.js';

function event() {
  const listeners = new Set();
  return {
    addEventListener(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    fire(value) { for (const fn of listeners) fn(value); },
    get size() { return listeners.size; },
  };
}
const collection = (items) => ({ get length() { return items.length; }, get: (i) => items[i] });
const feature = (id, show = true) => ({ show, getProperty: (key) => key === 'TD_ID' ? id : undefined });
const tile = (...features) => ({ content: { featuresLength: features.length, getFeature: (i) => features[i] } });
function setup() {
  assert.equal(typeof vworld.createBuildingVisibility, 'function', 'persistent visibility controller must exist');
  const tileset = { tileVisible: event(), tileUnload: event() };
  const items = [collection([tileset])];
  const scene = { primitives: collection(items), preRender: event(), requestRender() {} };
  return { tileset, items, scene, controller: vworld.createBuildingVisibility(scene) };
}

test('cached LOD tiles and style resets remain hidden without another tileLoad', () => {
  const { controller, tileset } = setup();
  const near = feature(42);
  const far = feature('42');
  const neighbor = feature(43);
  tileset.tileVisible.fire(tile(far, neighbor));
  controller.hide(near);
  assert.equal(near.show, false);
  assert.equal(far.show, false);
  far.show = true; // SDK reapplies style before tileVisible.
  tileset.tileVisible.fire(tile(far, neighbor));
  assert.equal(far.show, false);
  assert.equal(neighbor.show, true);
});

test('restores reloaded features without touching destroyed original features', () => {
  const { controller, tileset } = setup();
  const original = feature(7);
  const oldTile = tile(original);
  tileset.tileVisible.fire(oldTile);
  const key = controller.hide(original);
  tileset.tileUnload.fire(oldTile);
  Object.defineProperty(original, 'show', { set() { throw new Error('destroyed'); } });
  const replacement = feature(7);
  tileset.tileVisible.fire(tile(replacement));
  assert.equal(replacement.show, false);
  controller.restore(key);
  assert.equal(replacement.show, true);
});

test('handles composite content and newly added nested tilesets before rendering', () => {
  const { controller, scene, items } = setup();
  controller.hide(feature(0));
  const late = { tileVisible: event(), tileUnload: event() };
  items.push(collection([late]));
  scene.preRender.fire();
  const loaded = feature('0');
  late.tileVisible.fire({ content: { innerContents: [tile(loaded).content] } });
  assert.equal(loaded.show, false);
});

test('restore all preserves unrelated hidden features and removes event listeners on dispose', () => {
  const { controller, tileset, scene } = setup();
  const a = feature(1), b = feature(2), other = feature(3, false);
  tileset.tileVisible.fire(tile(a, b, other));
  controller.hide(a);
  controller.hide(b);
  controller.restoreAll();
  assert.deepEqual([a.show, b.show, other.show], [true, true, false]);
  controller.dispose();
  assert.equal(tileset.tileVisible.size, 0);
  assert.equal(tileset.tileUnload.size, 0);
  assert.equal(scene.preRender.size, 0);
});

test('does not pretend to persist a feature without an identifier', () => {
  const { controller } = setup();
  const anonymous = feature(undefined);
  assert.equal(controller.hide(anonymous), null);
  assert.equal(anonymous.show, true);
});
