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

const DEFAULT_SETTINGS = {
  apiKey: "",
  model: "gemini-3-pro-image-preview",
  openaiApiKey: "",
  openaiModel: "gpt-image-2.5-sunburst",
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    // ignore
  }
  return { ...DEFAULT_SETTINGS };
}

// Prompt library: frequently used Imagine prompts, shared across all nodes
// and projects, kept in this browser's localStorage.
const PROMPT_LIBRARY_KEY = "image-flow-studio:promptLibrary";

const DEFAULT_PROMPT_LIBRARY = [
  { id: "default-facade-style", text: "베이스 이미지에 레퍼런스 이미지 파사드 스타일 적용" },
];

function loadPromptLibrary() {
  try {
    const raw = localStorage.getItem(PROMPT_LIBRARY_KEY);
    if (raw) {
      const list = JSON.parse(raw);
      if (Array.isArray(list)) return list.filter((p) => p && typeof p.text === "string");
    }
  } catch {
    // ignore
  }
  return [...DEFAULT_PROMPT_LIBRARY];
}

function persistPromptLibrary(list) {
  try {
    localStorage.setItem(PROMPT_LIBRARY_KEY, JSON.stringify(list));
  } catch {
    // ignore
  }
}

// Saved projects: a name + full nodes/edges snapshot, keyed by id. The
// currently open one is auto-saved on every change so a page refresh never
// loses work; "Save as" / "Import" create additional named entries.
const PROJECTS_KEY = "image-flow-studio:projects";
const CURRENT_PROJECT_KEY = "image-flow-studio:currentProjectId";

function loadProjects() {
  try {
    const raw = localStorage.getItem(PROJECTS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return {};
}

function persistProjects(projects) {
  try {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
  } catch {
    // storage full or disabled — saved projects just won't survive a refresh
  }
}

function loadCurrentProjectId() {
  try {
    return localStorage.getItem(CURRENT_PROJECT_KEY) || null;
  } catch {
    return null;
  }
}

function persistCurrentProjectId(id) {
  try {
    if (id) localStorage.setItem(CURRENT_PROJECT_KEY, id);
    else localStorage.removeItem(CURRENT_PROJECT_KEY);
  } catch {
    // ignore
  }
}

let idCounter = 1;
export function nextId(prefix) {
  return `${prefix}-${idCounter++}-${Math.floor(Math.random() * 1e6)}`;
}

// Generation edges show provenance, not a live image input. A saved result
// must stay unchanged when its producer generates another image.
export function addGenerationLinks(nodes, edges) {
  const next = [...edges];
  const ids = new Set(nodes.map(n => n.id));
  for (const node of nodes) {
    const source = node.data.generatedFrom;
    if (!source || !ids.has(source) || next.some(e => e.target === node.id && e.targetHandle === 'img')) continue;
    next.push({ id: `generation-${source}-${node.id}`, source, sourceHandle: 'out',
      target: node.id, targetHandle: 'img', data: { generationResult: true },
      label: `결과 ${node.data.generationIndex}`, style: { stroke: '#5ee6a0' } });
  }
  return next;
}

// Synchronize every connected handle, including removed connections. Image
// relay nodes are evaluated upstream first; a visited set bounds legacy cycles.
function syncInputs(nodes, edges, previousEdges = edges) {
  edges = edges.filter(e => !e.data?.generationResult);
  previousEdges = previousEdges.filter(e => !e.data?.generationResult);
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
      // Carries the source's crop region (if any) alongside its image, e.g.
      // `baseRect`/`input1Rect`, so a later Merge can paste a patch back at
      // the exact spot it was cropped from instead of stretching it.
      node.data[`${field}Rect`] = image ? source?.data.rect || null : null;
    }
  }
  nodes.forEach(n => visit(n.id));
  return nodes.map(n => byId.get(n.id));
}

const hotState = import.meta.hot ? window.__imageFlowStore?.getState() : null;

// With no hot-reload state (i.e. a real page load), restore whatever project
// was open last so refreshing the browser doesn't wipe the canvas.
const initialProjects = loadProjects();
const initialProjectId = loadCurrentProjectId();
const restoredProject = !hotState && initialProjectId ? initialProjects[initialProjectId] : null;

export const useStore = create((set, get) => ({
  settings: loadSettings(),
  nodes: hotState?.nodes || restoredProject?.nodes || [],
  edges: hotState
    ? (hotState.generationLinksVersion === 1 ? hotState.edges : addGenerationLinks(hotState.nodes || [], hotState.edges || []))
    : restoredProject?.edges || [],
  generationLinksVersion: 1,
  projects: initialProjects,
  currentProjectId: restoredProject ? initialProjectId : null,
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

  promptLibrary: loadPromptLibrary(),
  addPrompt: (text) => {
    const trimmed = (text || "").trim();
    if (!trimmed) return;
    const list = get().promptLibrary;
    if (list.some((p) => p.text === trimmed)) return;
    const next = [...list, { id: `prompt-${Date.now().toString(36)}`, text: trimmed }];
    set({ promptLibrary: next });
    persistPromptLibrary(next);
  },
  removePrompt: (promptId) => {
    const next = get().promptLibrary.filter((p) => p.id !== promptId);
    set({ promptLibrary: next });
    persistPromptLibrary(next);
  },

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
      edges.filter(e => e.source === id && !e.data?.generationResult).forEach(e => queue.push(e.target));
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
      data: { provider: 'gemini', prompt: '', ratio: 'AUTO', resolution: 'AUTO', output: null } });
    get().onConnect({ source: sourceId, sourceHandle: 'out', target: id, targetHandle: 'base' });
    return id;
  },

  // Save each successful generation as an independent image snapshot. Live
  // connections from Imagine still receive its latest output, but snapshots
  // use provenance-only edges that cannot overwrite their earlier image.
  linkGeneratedImage: (sourceId, image) => {
    const { nodes, edges } = get();
    const source = nodes.find(n => n.id === sourceId);
    if (!source || !image) return;

    // Freeze the companion created by older versions BEFORE publishing the
    // new output. Keeping this atomic prevents propagation from erasing it.
    const legacyId = source.data.linkedImageNodeId;
    const legacy = nodes.find(n => n.id === legacyId && n.type === 'image');
    const nextEdges = edges.filter(e => !(legacy && e.source === sourceId &&
      e.target === legacyId && e.targetHandle === 'img'));
    const generationIndex = Math.max(source.data.generationCount || 0, legacy ? 1 : 0,
      ...nodes.filter(n => n.data.generatedFrom === sourceId).map(n => n.data.generationIndex || 0)) + 1;
    const position = { x: source.position.x + 340, y: source.position.y };
    // Stack in the next free space, including nodes moved by the user.
    let collision;
    do {
      collision = nodes.find(n => position.x < n.position.x + (n.measured?.width || 260) + 24 &&
        position.x + 260 + 24 > n.position.x &&
        position.y < n.position.y + (n.measured?.height || 300) + 24 &&
        position.y + 300 + 24 > n.position.y);
      if (collision) position.y = collision.position.y + (collision.measured?.height || 300) + 24;
    } while (collision);

    const newId = nextId('image');
    const newNode = { id: newId, type: 'image', position,
      data: { image, generatedFrom: sourceId, generationIndex, rect: source.data.rect || null } };
    const nextNodes = nodes.map(n => {
      if (n.id === sourceId) return { ...n, data: { ...n.data, output: image,
        generationCount: generationIndex, linkedImageNodeId: null } };
      if (legacy && n.id === legacyId) return { ...n, data: { ...n.data,
        generatedFrom: sourceId, generationIndex: 1 } };
      return n;
    });
    const savedNodes = [...nextNodes, newNode];
    const linkedEdges = addGenerationLinks(savedNodes.filter(n => n.id === sourceId || n.id === newId || (legacy && n.id === legacyId)), nextEdges);
    set({ nodes: syncInputs(savedNodes, linkedEdges), edges: linkedEdges });
    return newId;
  },

  removeNode: (id) => get().onNodesChange([{ type: 'remove', id }]),

  renameProject: (id, name) => {
    const { projects } = get();
    if (!projects[id] || !name) return;
    const next = { ...projects, [id]: { ...projects[id], name } };
    persistProjects(next);
    set({ projects: next });
  },

  // Saves the current canvas as a brand-new named project and makes it the
  // open one. Saving over an existing one happens automatically as you work.
  saveProjectAs: (name) => {
    const { nodes, edges, projects } = get();
    const id = nextId('project');
    const next = { ...projects, [id]: { id, name: name || '제목 없음', savedAt: Date.now(), nodes, edges } };
    persistProjects(next);
    persistCurrentProjectId(id);
    set({ projects: next, currentProjectId: id });
    return id;
  },

  loadProject: (id) => {
    const entry = get().projects[id];
    if (!entry) return;
    persistCurrentProjectId(id);
    set({ nodes: entry.nodes, edges: entry.edges, currentProjectId: id });
  },

  deleteProject: (id) => {
    const projects = { ...get().projects };
    delete projects[id];
    persistProjects(projects);
    if (get().currentProjectId === id) {
      persistCurrentProjectId(null);
      set({ projects, currentProjectId: null });
    } else {
      set({ projects });
    }
  },

  newProject: () => {
    persistCurrentProjectId(null);
    set({ nodes: [], edges: [], currentProjectId: null });
  },

  exportProject: () => {
    const { nodes, edges, projects, currentProjectId } = get();
    const name = projects[currentProjectId]?.name || 'image-flow-project';
    return { filename: `${name}.flow.json`, json: JSON.stringify({ version: 1, name, nodes, edges }, null, 2) };
  },

  // A loaded file becomes its own new project rather than overwriting
  // whatever was already open.
  importProjectData: (parsed) => {
    const id = nextId('project');
    const entry = { id, name: parsed?.name || 'Imported', savedAt: Date.now(),
      nodes: parsed?.nodes || [], edges: parsed?.edges || [] };
    const next = { ...get().projects, [id]: entry };
    persistProjects(next);
    persistCurrentProjectId(id);
    set({ projects: next, nodes: entry.nodes, edges: entry.edges, currentProjectId: id });
  },
}));

// Auto-save: whenever the open project's nodes/edges actually change,
// persist them under its id (creating an untitled one on the first edit) so
// work is never lost to a refresh. Comparing by reference and skipping runs
// that don't touch nodes/edges keeps this from looping on its own writes.
let autosaveTimer = null;
let lastAutosavedNodes = useStore.getState().nodes;
let lastAutosavedEdges = useStore.getState().edges;
useStore.subscribe((state) => {
  if (state.nodes === lastAutosavedNodes && state.edges === lastAutosavedEdges) return;
  lastAutosavedNodes = state.nodes;
  lastAutosavedEdges = state.edges;
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    const { nodes, edges, projects, currentProjectId } = useStore.getState();
    const id = currentProjectId && projects[currentProjectId] ? currentProjectId : nextId('project');
    const name = projects[id]?.name || '제목 없음';
    const next = { ...projects, [id]: { id, name, savedAt: Date.now(), nodes, edges } };
    persistProjects(next);
    persistCurrentProjectId(id);
    useStore.setState({ projects: next, currentProjectId: id });
  }, 800);
});
