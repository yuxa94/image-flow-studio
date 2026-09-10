import { create } from "zustand";
import {
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
} from "@xyflow/react";

// Maps a target node's handle id -> the data field on that node that should
// receive the upstream image when an edge feeds it.
const HANDLE_TO_FIELD = {
  base: "baseImage",
  ref: "refImage",
  in: "input",
  in1: "input1",
  in2: "input2",
  in3: "input3",
  img: "image",
};

// Human-readable badge shown on the source node's header for each handle
// it's currently feeding, e.g. an Image node wired into Imagine's "base"
// input shows a "BASE" badge instead of the generic "INPUT" one.
export const HANDLE_LABELS = {
  base: "BASE",
  ref: "REFERENCE",
  in: "INPUT",
  in1: "INPUT 1",
  in2: "INPUT 2",
  in3: "INPUT 3",
  img: "LINKED",
};

const SETTINGS_KEY = "image-flow-studio:settings";

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return { apiKey: "", model: "gemini-3-pro-image-preview" };
}

let idCounter = 1;
export function nextId(prefix) {
  return `${prefix}-${idCounter++}-${Math.floor(Math.random() * 1e6)}`;
}

// Synchronize every connected handle, including removed connections. Image
// relay nodes are evaluated upstream first; a visited set bounds legacy cycles.
function syncInputs(nodes, edges, previousEdges = edges) {
  const byId = new Map(nodes.map(n => [n.id, { ...n, data: { ...n.data } }]));
  const visited = new Set();
  function visit(id) {
    if (visited.has(id)) return;
    visited.add(id);
    const node = byId.get(id);
    if (!node) return;
    const handles = new Set([...edges, ...previousEdges].filter(e => e.target === id).map(e => e.targetHandle));
    for (const handle of handles) {
      const edge = edges.find(e => e.target === id && e.targetHandle === handle);
      if (edge) visit(edge.source);
      const source = edge && byId.get(edge.source);
      const image = source?.data.output ?? source?.data.image ?? null;
      const field = HANDLE_TO_FIELD[handle] || 'input';
      if (field === 'baseImage') {
        if (node.data[field] !== image) node.data.editedImage = null;
        node.data.baseRatio = image ? source?.data.captureRatio || null : null;
      }
      node.data[field] = image;
    }
  }
  nodes.forEach(n => visit(n.id));
  return nodes.map(n => byId.get(n.id));
}

const hotState = import.meta.hot ? window.__imageFlowStore?.getState() : null;

export const useStore = create((set, get) => ({
  settings: loadSettings(),
  nodes: hotState?.nodes || [],
  edges: hotState?.edges || [],
  lightboxImage: null,

  openLightbox: (image) => set({ lightboxImage: image }),
  closeLightbox: () => set({ lightboxImage: null }),

  // The VWorld 3D map is a page-wide singleton (its SDK can't be
  // reinitialized once started), so the modal is mounted once at the App
  // level and just toggled visible/hidden here rather than mounted per node.
  vworldOpen: false,
  vworldTargetNodeId: null,
  openVWorldMap: (nodeId) => set({ vworldOpen: true, vworldTargetNodeId: nodeId }),
  closeVWorldMap: () => set({ vworldOpen: false }),

  setSettings: (patch) => {
    const next = { ...get().settings, ...patch };
    set({ settings: next });
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  },

  onNodesChange: (changes) => {
    const state = get();
    const nodes = applyNodeChanges(changes, state.nodes);
    const ids = new Set(nodes.map(n => n.id));
    const edges = state.edges.filter(e => ids.has(e.source) && ids.has(e.target));
    set({ nodes: syncInputs(nodes, edges, state.edges), edges });
  },

  onEdgesChange: (changes) => {
    const state = get();
    const edges = applyEdgeChanges(changes, state.edges);
    set({ edges, nodes: syncInputs(state.nodes, edges, state.edges) });
  },

  isValidConnection: ({ source, target }) => {
    const { nodes, edges } = get();
    if (source === target || !nodes.some(n => n.id === source) || !nodes.some(n => n.id === target)) return false;
    const seen = new Set();
    const queue = [target];
    while (queue.length) {
      const id = queue.pop();
      if (id === source) return false;
      if (seen.has(id)) continue;
      seen.add(id);
      edges.filter(e => e.source === id).forEach(e => queue.push(e.target));
    }
    return true;
  },

  onConnect: (connection) => {
    if (!get().isValidConnection(connection)) return;
    const state = get();
    const edges = addEdge({ ...connection, animated: false }, state.edges.filter(e =>
      e.target !== connection.target || e.targetHandle !== connection.targetHandle));
    set({ edges, nodes: syncInputs(state.nodes, edges, state.edges) });
  },

  addNode: (node) => {
    set({ nodes: [...get().nodes, node] });
  },

  // A manual upload takes ownership of this Image node's contents.
  replaceNodeImage: (id, image) => {
    const state = get();
    const edges = state.edges.filter(e => !(e.target === id && e.targetHandle === 'img'));
    const nodes = state.nodes.map(n => ({ ...n, data: {
      ...n.data,
      ...(n.id === id ? { image, error: null } : {}),
      ...(n.data.linkedImageNodeId === id ? { linkedImageNodeId: null } : {}),
    } }));
    set({ nodes: syncInputs(nodes, edges), edges });
  },

  updateNodeData: (id, patch) => {
    set({
      nodes: get().nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, ...patch } } : n
      ),
    });
  },

  // Sets a node's output image, then pushes it downstream to every
  // connected target node's matching input field.
  setNodeOutput: (id, image) => {
    get().updateNodeData(id, { output: image });
    get().propagateFrom(id);
  },

  propagateFrom: () => {
    const { nodes, edges } = get();
    set({ nodes: syncInputs(nodes, edges) });
  },

  connectToImagine: (sourceId) => {
    const source = get().nodes.find(n => n.id === sourceId);
    if (!source) return;
    const existing = get().edges.find(e => e.source === sourceId && e.targetHandle === 'base' &&
      get().nodes.some(n => n.id === e.target && n.type === 'imagine'));
    if (existing) { get().propagateFrom(sourceId); return existing.target; }
    const id = nextId('imagine');
    get().addNode({ id, type: 'imagine', position: { x: source.position.x + 360, y: source.position.y },
      data: { prompt: '', ratio: 'AUTO', resolution: 'AUTO', output: null } });
    get().onConnect({ source: sourceId, sourceHandle: 'out', target: id, targetHandle: 'base' });
    return id;
  },

  // After an Imagine node generates an image, drop (or update) a companion
  // Image node right next to it, wired from its output, so the user can
  // immediately feed the result back into another Imagine node to keep
  // iterating.
  linkGeneratedImage: (sourceId, image) => {
    const { nodes, edges } = get();
    const source = nodes.find((n) => n.id === sourceId);
    if (!source) return;

    const existingId = source.data?.linkedImageNodeId;
    const existing = existingId && nodes.find((n) => n.id === existingId);

    if (existing) {
      get().updateNodeData(existing.id, { image });
      get().propagateFrom(existing.id);
      return;
    }

    const newId = nextId("image");
    const newNode = {
      id: newId,
      type: "image",
      position: { x: source.position.x + 340, y: source.position.y },
      data: { image },
    };
    const newEdge = {
      id: nextId("edge"),
      source: sourceId,
      sourceHandle: "out",
      target: newId,
      targetHandle: "img",
    };

    set({ nodes: [...get().nodes, newNode], edges: [...edges, newEdge] });
    get().updateNodeData(sourceId, { linkedImageNodeId: newId });
  },

  removeNode: (id) => get().onNodesChange([{ type: 'remove', id }]),
}));
