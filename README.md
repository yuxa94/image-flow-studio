# Image Flow Studio (local)

A node-based canvas for AI image editing, inspired by node-graph image tools.
Drag nodes onto the canvas, wire them together, and generate/edit images with
Gemini image models.

## Stack

- `client/` — React + Vite + React Flow (`@xyflow/react`) canvas UI
- `server/` — small Express server: proxies Gemini image requests and VWorld
  address search, and (in dev) serves `VWORLD_API_KEY` into `index.html` at
  serve time so it never sits in committed source

## Setup

```bash
npm run install:all   # first time only
cp server/.env.example server/.env   # then fill in your keys
npm run dev            # starts server (:3001) and client (:5173)
```

`server/.env` holds three keys (gitignored, never committed):

```
GEMINI_API_KEY=
VWORLD_API_KEY=
REPLICATE_API_TOKEN=
```

- **GEMINI_API_KEY** — used automatically if set; you can also paste a key
  into **⚙ Settings** (bottom right) in the app instead, which takes
  precedence. Set the **Model** field there to whatever exact model ID you
  have access to for image generation/editing (defaults to
  `gemini-3-pro-image-preview`).
- **VWORLD_API_KEY** — required for the VWorld node's 3D map. It has to be
  registered for the domain you're running on (`localhost`) in VWorld's
  MyPortal, or the map will refuse to load. Restart `npm run dev` after
  changing this one, since it's baked into `index.html` at Vite serve time.
- **REPLICATE_API_TOKEN** — loaded but not wired to any node yet.

## Nodes

- **Image** — upload a local image, becomes an input for other nodes.
- **VWorld** — opens a 3D map (real VWorld imagery/buildings). Search an
  address or pan/zoom manually, place `.glb` models by clicking the globe
  (each gets a black CAD-style edge outline, a yellow selection silhouette,
  and a Rhino-Gumball-style move/rotate gizmo centered on it), toggle the
  cadastral map (지적도, proxied through the server since VWorld's WMS has
  no CORS headers), and Capture writes the screenshot as this node's
  output at any of the same ratio presets Crop/Imagine use.
  Building-name/POI label visibility isn't exposed anywhere in VWorld's
  public SDK (checked scene primitives, ground primitives, the DOM, and
  3D-tileset styling) — no toggle for it exists here.
- **Imagine** — the Gemini node. Connect a base image (required) and
  optionally a reference image, write a prompt, pick ratio/resolution, hit
  Generate. The "Edit" button opens a canvas to mark up the image
  (rectangle/brush, adjustable stroke width) before generating.
- **Crop** — opens a ratio-locked crop modal (1:1 through 21:9 presets,
  drag-to-move, corner-handle resize), Apply.
- **Merge** — overlay up to 3 images with per-layer opacity sliders.
- **Upscale** — "Fast (local)" does a canvas upscale; "AI (Gemini)" asks the
  model to enhance detail at higher resolution.

Drag a palette item from the left sidebar onto the canvas to add it, then drag
from a node's dot (handle) to another node's input handle to connect them.
Output images propagate automatically down the chain.
