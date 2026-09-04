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

export const useStore = create((set, get) => ({
  settings: loadSettings(),
  nodes: [],
  edges: [],
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
    set({ nodes: applyNodeChanges(changes, get().nodes) });
  },

  onEdgesChange: (changes) => {
    set({ edges: applyEdgeChanges(changes, get().edges) });
  },

  onConnect: (connection) => {
    set({ edges: addEdge({ ...connection, animated: false }, get().edges) });
    get().propagateFrom(connection.source);
  },

  addNode: (node) => {
    set({ nodes: [...get().nodes, node] });
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

  propagateFrom: (sourceId) => {
    const { nodes, edges } = get();
    const source = nodes.find((n) => n.id === sourceId);
    if (!source) return;
    const outputImage = source.data?.output ?? source.data?.image ?? null;
    if (outputImage == null) return;

    const outgoing = edges.filter((e) => e.source === sourceId);
    if (!outgoing.length) return;

    set({
      nodes: get().nodes.map((n) => {
        const edge = outgoing.find((e) => e.target === n.id);
        if (!edge) return n;
        const field = HANDLE_TO_FIELD[edge.targetHandle] || "input";
        return { ...n, data: { ...n.data, [field]: outputImage } };
      }),
    });

    // chain further downstream (e.g. Crop -> Upscale -> Merge)
    for (const edge of outgoing) get().propagateFrom(edge.target);
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

  removeNode: (id) => {
    set({
      nodes: get().nodes.filter((n) => n.id !== id),
      edges: get().edges.filter((e) => e.source !== id && e.target !== id),
    });
  },
}));
