import test from 'node:test';
import assert from 'node:assert/strict';
import * as geometry from '../client/src/lib/modelGeometry.js';

function glb(positions, indices, mode = 4) {
  const pos = new Float32Array(positions), idx = new Uint16Array(indices);
  const json = { asset:{version:'2.0'}, scene:0, scenes:[{nodes:[0]}], nodes:[{mesh:0}],
    meshes:[{primitives:[{attributes:{POSITION:0},indices:1,mode}]}],
    buffers:[{byteLength:pos.byteLength+idx.byteLength}],
    bufferViews:[{buffer:0,byteOffset:0,byteLength:pos.byteLength},{buffer:0,byteOffset:pos.byteLength,byteLength:idx.byteLength}],
    accessors:[{bufferView:0,componentType:5126,count:positions.length/3,type:'VEC3'}, {bufferView:1,componentType:5123,count:indices.length,type:'SCALAR'}] };
  const text=new TextEncoder().encode(JSON.stringify(json));
  const jl=Math.ceil(text.length/4)*4, bl=Math.ceil((pos.byteLength+idx.byteLength)/4)*4;
  const result=new ArrayBuffer(28+jl+bl), view=new DataView(result), bytes=new Uint8Array(result);
  [0x46546c67,2,result.byteLength,jl,0x4e4f534a].forEach((n,i)=>view.setUint32(i*4,n,true));
  bytes.fill(32,20,20+jl);bytes.set(text,20);view.setUint32(20+jl,bl,true);view.setUint32(24+jl,0x004e4942,true);
  bytes.set(new Uint8Array(pos.buffer),28+jl);bytes.set(new Uint8Array(idx.buffer),28+jl+pos.byteLength);
  return result;
}

test('adds black physical boundary edges without a diagonal across a flat face', () => {
  assert.equal(typeof geometry.addBlackModelEdges, 'function');
  const input=glb([10,0,10,20,0,10,20,0,20,10,0,20],[0,1,2,0,2,3]);
  const result=geometry.addBlackModelEdges(input);
  assert.equal(result.edgeCount,4);
  const length=new DataView(result.buffer).getUint32(12,true);
  const json=JSON.parse(new TextDecoder().decode(new Uint8Array(result.buffer,20,length)));
  const lines=json.meshes[0].primitives.find(p=>p.mode===1);
  assert.ok(lines);
  assert.equal(json.accessors[lines.indices].count,8);
  assert.deepEqual(json.materials[lines.material].pbrMetallicRoughness.baseColorFactor,[0,0,0,1]);
  assert.equal(json.meshes[0].primitives[0].indices,1);
  // Edges sit just outside the face to avoid depth flicker, while the source
  // surface's coordinates and indices remain byte-for-byte intact.
  const inputJsonLength = new DataView(input).getUint32(12, true);
  const sourceBytes = new Uint8Array(input, 28 + inputJsonLength);
  assert.deepEqual(new Uint8Array(result.buffer, 28 + length, sourceBytes.length), sourceBytes);
  assert.notEqual(lines.attributes.POSITION, 0);
  const edgeAccessor = json.accessors[lines.attributes.POSITION];
  const edgeView = json.bufferViews[edgeAccessor.bufferView];
  const edgeVertices = new Float32Array(result.buffer, 28 + length + edgeView.byteOffset, edgeAccessor.count * 3);
  for (let i = 1; i < edgeVertices.length; i += 3) {
    assert.ok(edgeVertices[i] < 0 && edgeVertices[i] > -0.01);
  }
});

test('existing exported line strips also receive black material', () => {
  const result = geometry.addBlackModelEdges(glb([0,0,0,1,0,0,1,1,0], [0,1,2], 3));
  const length = new DataView(result.buffer).getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(result.buffer, 20, length)));
  const line = json.meshes[0].primitives[0];
  assert.equal(line.mode, 3);
  assert.deepEqual(json.materials[line.material].pbrMetallicRoughness.baseColorFactor, [0,0,0,1]);
});

test('creases between adjoining non-coplanar faces are drawn', () => {
  assert.equal(typeof geometry.addBlackModelEdges, 'function');
  const result=geometry.addBlackModelEdges(glb([0,0,0,1,0,0,0,1,0,0,0,1],[0,1,2,1,0,3]));
  assert.equal(result.edgeCount,5);
});

test('an offset model center stays fixed for rotation and scaling', () => {
  assert.equal(typeof geometry.keepModelPivotFixed, 'function');
  const pivot={x:72,y:71,z:100}, world=[127000,37000,400];
  for(const scale of [0.1,1,5]) for(const angle of [0,Math.PI/2,Math.PI,2*Math.PI]) for(const axis of [0,1,2]) {
    const c=Math.cos(angle),s=Math.sin(angle);
    const rotations=[[1,0,0,0,0,c,s,0,0,-s,c,0],[c,0,-s,0,0,1,0,0,s,0,c,0],[c,s,0,0,-s,c,0,0,0,0,1,0]];
    const matrix=[...rotations[axis],...world,1];
    geometry.keepModelPivotFixed(matrix,pivot,scale);
    for(let row=0;row<3;row++) {
      const actual=matrix[row]*pivot.x*scale+matrix[row+4]*pivot.y*scale+matrix[row+8]*pivot.z*scale+matrix[row+12];
      assert.ok(Math.abs(actual-world[row])<1e-8);
    }
  }
});
