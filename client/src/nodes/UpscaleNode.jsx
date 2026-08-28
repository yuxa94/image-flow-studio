import { Handle, Position } from "@xyflow/react";
import NodeShell from "./NodeShell.jsx";
import { useStore } from "../lib/store.js";
import { upscaleImageCanvas, dataUrlToRaw } from "../lib/imageUtils.js";
import { generateImage } from "../lib/api.js";
import ImagePreview from "../components/ImagePreview.jsx";

export default function UpscaleNode({ id, data, selected }) {
  const updateNodeData = useStore((s) => s.updateNodeData);
  const setNodeOutput = useStore((s) => s.setNodeOutput);
  const settings = useStore((s) => s.settings);

  const mode = data.mode || "fast";

  async function handleUpscale() {
    if (!data.input) return;
    updateNodeData(id, { loading: true, error: null });
    try {
      let out;
      if (mode === "ai") {
        if (!settings.apiKey) throw new Error("Set your Gemini API key in Settings first.");
        const result = await generateImage({
          apiKey: settings.apiKey,
          model: settings.model,
          prompt:
            "Upscale this image to a higher resolution. Enhance sharpness and fine detail without changing the content, composition, or colors.",
          images: [dataUrlToRaw(data.input)],
          ratio: "AUTO",
          resolution: "4K",
        });
        out = result.image;
      } else {
        out = await upscaleImageCanvas(data.input, Number(data.factor) || 2);
      }
      updateNodeData(id, { loading: false });
      setNodeOutput(id, out);
    } catch (err) {
      updateNodeData(id, { loading: false, error: err.message });
    }
  }

  return (
    <NodeShell title="Upscale" badge="4K" selected={selected}>
      <Handle type="target" position={Position.Left} id="in" />

      <ImagePreview src={data.input} alt="input" empty="Connect an image ←" />

      <div className="row">
        <div>
          <label>Mode</label>
          <select className="node-select" value={mode} onChange={(e) => updateNodeData(id, { mode: e.target.value })}>
            <option value="fast">Fast (local)</option>
            <option value="ai">AI (Gemini)</option>
          </select>
        </div>
        {mode === "fast" ? (
          <div>
            <label>Factor</label>
            <select
              className="node-select"
              value={data.factor || 2}
              onChange={(e) => updateNodeData(id, { factor: e.target.value })}
            >
              <option value="2">2x</option>
              <option value="3">3x</option>
              <option value="4">4x</option>
            </select>
          </div>
        ) : null}
      </div>

      {data.output ? (
        <ImagePreview src={data.output} alt="upscaled" downloadable filename={`upscale-${id}.png`} />
      ) : null}

      {data.error ? <div className="error-text">{data.error}</div> : null}

      <button className="btn secondary node-footer-btn" onClick={handleUpscale} disabled={!data.input || data.loading}>
        {data.loading ? "Working..." : "Upscale"}
      </button>

      <Handle type="source" position={Position.Right} id="out" />
    </NodeShell>
  );
}
