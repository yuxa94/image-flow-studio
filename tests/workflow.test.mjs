import test from 'node:test';
import assert from 'node:assert/strict';
import { useStore } from '../client/src/lib/store.js';
import * as ratios from '../client/src/lib/ratios.js';
const n = (id, type = 'imagine', data = {}) => ({ id, type, data, position: { x: 0, y: 0 } });
const c = (source, target, targetHandle = 'base') => ({ source, target, targetHandle, sourceHandle: 'out' });
function setup(nodes) { useStore.setState({ nodes, edges: [] }); return useStore.getState(); }
const data = (id) => useStore.getState().nodes.find(n => n.id === id).data;

test('one source updates both base and reference handles', () => {
  const s = setup([n('map', 'vworld', { output: 'capture' }), n('ai')]);
  s.onConnect(c('map', 'ai')); s.onConnect(c('map', 'ai', 'ref'));
  assert.equal(data('ai').baseImage, 'capture');
  assert.equal(data('ai').refImage, 'capture');
});
test('reconnecting an input replaces its source and disconnect clears stale input', () => {
  const s = setup([n('a', 'image', { image: 'old' }), n('b', 'image', { image: 'new' }), n('ai')]);
  s.onConnect(c('a', 'ai')); s.onConnect(c('b', 'ai'));
  assert.equal(useStore.getState().edges.length, 1);
  assert.equal(data('ai').baseImage, 'new');
  const id = useStore.getState().edges[0].id;
  s.onEdgesChange([{ type: 'remove', id }]);
  assert.equal(data('ai').baseImage, null);
});
test('rejects cycles without stack overflow', () => {
  const s = setup([n('a'), n('b')]);
  s.onConnect(c('a', 'b')); s.onConnect(c('b', 'a')); s.onConnect(c('a', 'a'));
  assert.equal(useStore.getState().edges.length, 1);
});
test('deleting a source clears connections and obsolete edit instructions', () => {
  const s = setup([n('a', 'vworld', { output: 'capture' }), n('ai')]);
  s.onConnect(c('a', 'ai'));
  s.updateNodeData('ai', { editedImage: 'old annotation' });
  s.onNodesChange([{ type: 'remove', id: 'a' }]);
  assert.equal(useStore.getState().edges.length, 0);
  assert.equal(data('ai').baseImage, null);
  assert.equal(data('ai').editedImage, null);
});
test('capture ratio follows the base input and null output clears downstream', () => {
  const s = setup([n('a', 'vworld', { output: 'capture', captureRatio: '16:9' }), n('ai')]);
  s.onConnect(c('a', 'ai'));
  assert.equal(data('ai').baseRatio, '16:9');
  s.setNodeOutput('a', null);
  assert.equal(data('ai').baseImage, null);
  assert.equal(data('ai').baseRatio, null);
});
test('capture guide refits to the chosen pixel ratio on a resized stage', () => {
  assert.equal(typeof ratios.fitCaptureRect, 'function');
  for (const [w, h] of [[1000, 500], [500, 1000], [300, 200]]) {
    const box = ratios.fitCaptureRect(16 / 9, w, h);
    assert.ok(Math.abs((box.wPct * w) / (box.hPct * h) - 16 / 9) < 1e-10);
    assert.ok(box.xPct >= 0 && box.yPct >= 0 && box.wPct <= 1 && box.hPct <= 1);
  }
});

test('Imagine shortcut reuses a connected node and retains its prompt', () => {
  const s = setup([n('map', 'vworld', { output: 'capture', captureRatio: '9:16' })]);
  const id = s.connectToImagine('map');
  s.updateNodeData(id, { prompt: 'A quiet courtyard' });
  assert.equal(s.connectToImagine('map'), id);
  assert.equal(useStore.getState().nodes.length, 2);
  assert.equal(data(id).baseRatio, '9:16');
  assert.equal(data(id).prompt, 'A quiet courtyard');
});

test('image relay propagates replacement images and clears after disconnection', () => {
  const s = setup([n('map', 'vworld', { output: 'a' }), n('relay', 'image'), n('ai')]);
  s.onConnect(c('map', 'relay', 'img')); s.onConnect(c('relay', 'ai'));
  s.setNodeOutput('map', 'b');
  assert.equal(data('ai').baseImage, 'b');
  const edge = useStore.getState().edges.find(e => e.source === 'map');
  s.onEdgesChange([{ type: 'remove', id: edge.id }]);
  assert.equal(data('ai').baseImage, null);
});

test('explicitly replacing a linked image keeps the upload and detaches its old source', () => {
  const s = setup([n('source', 'imagine', { output: 'old', linkedImageNodeId: 'image' }), n('image', 'image'), n('next')]);
  s.onConnect(c('source', 'image', 'img')); s.onConnect(c('image', 'next'));
  assert.equal(typeof s.replaceNodeImage, 'function');
  s.replaceNodeImage('image', 'uploaded');
  assert.equal(data('image').image, 'uploaded');
  assert.equal(data('next').baseImage, 'uploaded');
  assert.equal(useStore.getState().edges.some(e => e.target === 'image'), false);
  s.setNodeOutput('source', 'later'); s.linkGeneratedImage('source', 'later');
  assert.equal(data('image').image, 'uploaded');
});

test('each generation appends a snapshot and leaves earlier results and their inputs unchanged', () => {
  const s = setup([n('ai'), n('next')]);
  s.linkGeneratedImage('ai', 'first');
  const first = useStore.getState().nodes.find(n => n.type === 'image');
  s.onConnect(c(first.id, 'next'));
  s.linkGeneratedImage('ai', 'second');
  s.linkGeneratedImage('ai', 'third');
  const results = useStore.getState().nodes.filter(n => n.type === 'image');
  assert.deepEqual(results.map(n => n.data.image), ['first', 'second', 'third']);
  assert.deepEqual(results.map(n => n.data.generationIndex), [1, 2, 3]);
  assert.equal(new Set(results.map(n => `${n.position.x},${n.position.y}`)).size, 3);
  s.propagateFrom('ai');
  assert.equal(data('next').baseImage, 'first');
  assert.equal(data('ai').output, 'third');
  s.removeNode('ai');
  assert.equal(data(first.id).image, 'first');
});

test('the existing linked result is preserved before the next generation updates output', () => {
  const s = setup([n('ai', 'imagine', { output: 'old', linkedImageNodeId: 'legacy' }), n('legacy', 'image', { image: 'old' })]);
  s.onConnect(c('ai', 'legacy', 'img'));
  s.linkGeneratedImage('ai', 'new');
  assert.equal(data('legacy').image, 'old');
  assert.equal(useStore.getState().nodes.filter(n => n.type === 'image').length, 2);
  assert.equal(useStore.getState().edges.some(e => e.source === 'ai' && e.target === 'legacy'), false);
  s.propagateFrom('ai');
  assert.equal(data('legacy').image, 'old');
});

test('new results avoid existing nodes and missing producers cannot append results', () => {
  const occupied = { ...n('occupied', 'image'), position: { x: 340, y: 0 }, measured: { width: 260, height: 500 } };
  const s = setup([n('ai'), occupied]);
  s.linkGeneratedImage('ai', 'result');
  const result = useStore.getState().nodes.find(n => n.data.image === 'result');
  assert.ok(result.position.y >= 500);
  const count = useStore.getState().nodes.length;
  s.linkGeneratedImage('missing', 'ignored');
  assert.equal(useStore.getState().nodes.length, count);
});
