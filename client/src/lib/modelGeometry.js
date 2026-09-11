// Cesium's model.scale is applied before modelMatrix. Offset the translation
// by R * (scale * localCenter) so the same world pivot survives every edit.
export function keepModelPivotFixed(matrix, pivot, scale) {
  for (let row = 0; row < 3; row++) {
    matrix[12 + row] -= scale * (matrix[row] * pivot.x + matrix[4 + row] * pivot.y + matrix[8 + row] * pivot.z);
  }
  return matrix;
}

// Append real glTF LINES geometry. Screen-space silhouettes cannot expose
// interior corners. Original surfaces, node transforms and textures stay intact.
export function addBlackModelEdges(buffer) {
  const input = new DataView(buffer);
  if (buffer.byteLength < 20 || input.getUint32(0, true) !== 0x46546c67 || input.getUint32(4, true) !== 2) {
    throw new Error('GLB 2.0 파일이 필요합니다.');
  }
  let json, binary;
  for (let offset = 12; offset + 8 <= buffer.byteLength;) {
    const length = input.getUint32(offset, true), type = input.getUint32(offset + 4, true);
    const bytes = new Uint8Array(buffer, offset + 8, length);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(bytes));
    if (type === 0x004e4942) binary = bytes;
    offset += length + 8;
  }
  if (!json || !binary || json.buffers?.length !== 1 || json.buffers[0].uri) throw new Error('데이터가 포함된 GLB 파일이 필요합니다.');
  const view = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
  const types = { 5120: ['getInt8', 1], 5121: ['getUint8', 1], 5122: ['getInt16', 2], 5123: ['getUint16', 2], 5125: ['getUint32', 4], 5126: ['getFloat32', 4] };
  function accessor(index, components) {
    const a = json.accessors[index], bv = json.bufferViews[a.bufferView];
    if (!bv || a.sparse || bv.extensions?.EXT_meshopt_compression || bv.buffer !== 0) throw new Error('압축을 해제한 GLB로 내보내주세요.');
    const [method, size] = types[a.componentType] || [];
    if (!method) throw new Error('지원하지 않는 모델 좌표 형식입니다.');
    const start = (bv.byteOffset || 0) + (a.byteOffset || 0), stride = bv.byteStride || components * size;
    return Array.from({ length: a.count }, (_, i) => Array.from({ length: components }, (_, c) => view[method](start + i * stride + c * size, true)));
  }
  json.materials ||= [];
  const material = json.materials.length;
  json.materials.push({ name: 'Black model edges', pbrMetallicRoughness: { baseColorFactor: [0, 0, 0, 1], metallicFactor: 0, roughnessFactor: 1 }, doubleSided: true });
  const additions = [];
  let binLength = binary.byteLength, edgeCount = 0;
  function append(array, target, componentType, type, count, extra = {}) {
    const offset = Math.ceil(binLength / 4) * 4;
    const bufferView = json.bufferViews.length;
    json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: array.byteLength, target });
    const index = json.accessors.length;
    json.accessors.push({ bufferView, componentType, count, type, ...extra });
    additions.push({ offset, bytes: new Uint8Array(array.buffer) });
    binLength = offset + array.byteLength;
    return index;
  }
  for (const mesh of json.meshes || []) {
    const lines = [];
    for (const primitive of mesh.primitives) {
      const mode = primitive.mode ?? 4;
      if ([1, 2, 3].includes(mode)) { primitive.material = material; continue; }
      if (![4, 5, 6].includes(mode)) continue;
      if (primitive.extensions?.KHR_draco_mesh_compression) throw new Error('Draco 압축을 해제한 GLB로 내보내주세요.');
      const positions = accessor(primitive.attributes.POSITION, 3);
      const indices = primitive.indices === undefined ? positions.map((_, i) => i) : accessor(primitive.indices, 1).flat();
      const edges = new Map();
      const vertexKey = p => p.map(v => Math.round(v * 1e6)).join(',');
      function triangle(a, b, c) {
        const p = positions[a], q = positions[b], r = positions[c];
        const u = q.map((v, i) => v - p[i]), v = r.map((n, i) => n - p[i]);
        const normal = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
        const length = Math.hypot(...normal);
        if (!length) return;
        const n = normal.map(v => v / length);
        for (const [from, to] of [[a, b], [b, c], [c, a]]) {
          const key = [vertexKey(positions[from]), vertexKey(positions[to])].sort().join('|');
          const edge = edges.get(key);
          if (edge) edge.normals.push(n);
          else edges.set(key, { from, to, normals: [n] });
        }
      }
      if (mode === 4) for (let i = 0; i + 2 < indices.length; i += 3) triangle(indices[i], indices[i+1], indices[i+2]);
      if (mode === 5) for (let i = 2; i < indices.length; i++) triangle(indices[i-2], indices[i % 2 ? i : i-1], indices[i % 2 ? i-1 : i]);
      if (mode === 6) for (let i = 2; i < indices.length; i++) triangle(indices[0], indices[i-1], indices[i]);
      const lineIndices = [], edgePositions = [];
      const min = [0, 1, 2].map(axis => positions.reduce((v, p) => Math.min(v, p[axis]), Infinity));
      const max = [0, 1, 2].map(axis => positions.reduce((v, p) => Math.max(v, p[axis]), -Infinity));
      const bias = Math.max(1e-6, Math.hypot(...max.map((v, i) => v - min[i])) * 1e-4);
      const canOffset = !primitive.targets && primitive.attributes.JOINTS_0 === undefined;
      for (const edge of edges.values()) {
        const n = edge.normals[0];
        if (edge.normals.length === 1 || edge.normals.some(m => Math.abs(m.reduce((sum, v, i) => sum + v*n[i], 0)) < Math.cos(Math.PI / 180))) {
          if (canOffset) {
            const normal = n.map((_, axis) => edge.normals.reduce((sum, m) => sum + m[axis], 0));
            const length = Math.hypot(...normal) || 1;
            for (const vertex of [edge.from, edge.to]) {
              lineIndices.push(edgePositions.length / 3);
              edgePositions.push(...positions[vertex].map((v, axis) => v + normal[axis] / length * bias));
            }
          } else lineIndices.push(edge.from, edge.to);
        }
      }
      if (!lineIndices.length) continue;
      const attributes = { POSITION: primitive.attributes.POSITION };
      if (canOffset) {
        const edgeMin = min.map(v => v - bias), edgeMax = max.map(v => v + bias);
        attributes.POSITION = append(new Float32Array(edgePositions), 34962, 5126, 'VEC3', edgePositions.length / 3, { min: edgeMin, max: edgeMax });
      }
      const vertexCount = canOffset ? edgePositions.length / 3 : positions.length;
      const array = vertexCount <= 65536 ? new Uint16Array(lineIndices) : new Uint32Array(lineIndices);
      const index = append(array, 34963, array.BYTES_PER_ELEMENT === 2 ? 5123 : 5125, 'SCALAR', array.length);
      for (const key of ['JOINTS_0', 'WEIGHTS_0']) if (primitive.attributes[key] !== undefined) attributes[key] = primitive.attributes[key];
      lines.push({ attributes, indices: index, material, mode: 1, ...(primitive.targets ? { targets: primitive.targets } : {}) });
      edgeCount += array.length / 2;
    }
    mesh.primitives.push(...lines);
  }
  binLength = Math.ceil(binLength / 4) * 4;
  json.buffers[0].byteLength = binLength;
  const text = new TextEncoder().encode(JSON.stringify(json)), jsonLength = Math.ceil(text.length / 4) * 4;
  const result = new ArrayBuffer(28 + jsonLength + binLength), out = new DataView(result), bytes = new Uint8Array(result);
  [0x46546c67, 2, result.byteLength, jsonLength, 0x4e4f534a].forEach((n, i) => out.setUint32(i*4, n, true));
  bytes.fill(32, 20, 20 + jsonLength); bytes.set(text, 20);
  out.setUint32(20 + jsonLength, binLength, true); out.setUint32(24 + jsonLength, 0x004e4942, true);
  bytes.set(binary, 28 + jsonLength);
  for (const part of additions) bytes.set(part.bytes, 28 + jsonLength + part.offset);
  return { buffer: result, edgeCount };
}
