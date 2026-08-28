# Image Flow Studio (local)

A node-based canvas for AI image editing, inspired by node-graph image tools.
Drag nodes onto the canvas, wire them together, and generate/edit images with
Gemini image models.

## Stack

- `client/` — React + Vite + React Flow (`@xyflow/react`) canvas UI
- `server/` — small Express proxy that forwards requests to the Gemini API
  (keeps the flow simple; the API key still lives only in your browser's
  localStorage and is sent per-request, never stored on disk)

## Run it

```bash
npm run install:all   # first time only
npm run dev            # starts server (:3001) and client (:5173)
```

Open http://localhost:5173, click **⚙ Settings** (bottom right) and paste your
Gemini API key. Set the **Model** field to whatever exact model ID you have
access to for image generation/editing (defaults to
`gemini-3-pro-image-preview` — change this if your account uses a different
ID).

## Nodes

- **Image** — upload a local image, becomes an input for other nodes.
- **Imagine** — the Gemini node. Connect a base image (required) and
  optionally a reference image, write a prompt, pick ratio/resolution, hit
  Generate.
- **Crop** — drag a rectangle over the connected image, Apply Crop.
- **Merge** — overlay up to 3 images with per-layer opacity sliders.
- **Upscale** — "Fast (local)" does a canvas upscale; "AI (Gemini)" asks the
  model to enhance detail at higher resolution.

Drag a palette item from the left sidebar onto the canvas to add it, then drag
from a node's dot (handle) to another node's input handle to connect them.
Output images propagate automatically down the chain.
