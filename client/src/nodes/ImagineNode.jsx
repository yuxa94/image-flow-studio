import { Handle, Position } from "@xyflow/react";
import NodeShell from "./NodeShell.jsx";
import { useStore } from "../lib/store.js";
import { generateImage } from "../lib/api.js";
import { dataUrlToRaw } from "../lib/imageUtils.js";
import ImagePreview from "../components/ImagePreview.jsx";

const RATIOS = ["AUTO", "1:1", "16:9", "9:16", "4:3", "3:4"];
const RESOLUTIONS = ["AUTO", "1K", "2K", "4K"];

export default function ImagineNode({ id, data, selected }) {
  const updateNodeData = useStore((s) => s.updateNodeData);
  const setNodeOutput = useStore((s) => s.setNodeOutput);
  const settings = useStore((s) => s.settings);

  async function handleGenerate() {
    if (!settings.apiKey) {
      updateNodeData(id, { error: "Set your Gemini API key in Settings (bottom right)." });
      return;
    }
    if (!data.baseImage) {
      updateNodeData(id, { error: "Connect an image into the base input first." });
      return;
    }

    updateNodeData(id, { loading: true, error: null });

    const images = [dataUrlToRaw(data.baseImage)];
    if (data.refImage) images.push(dataUrlToRaw(data.refImage));

    try {
      const result = await generateImage({
        apiKey: settings.apiKey,
        model: settings.model,
        prompt: data.prompt || "",
        images: images.filter(Boolean),
        ratio: data.ratio || "AUTO",
        resolution: data.resolution || "AUTO",
      });
      updateNodeData(id, { loading: false, error: null });
      setNodeOutput(id, result.image);
    } catch (err) {
      updateNodeData(id, { loading: false, error: err.message });
    }
  }

  return (
    <NodeShell title="Imagine" badge="GEMINI" selected={selected}>
      <Handle type="target" position={Position.Left} id="base" style={{ top: "30%" }} />
      <Handle type="target" position={Position.Left} id="ref" style={{ top: "70%" }} />

      <ImagePreview
        src={data.output}
        alt="output"
        empty={data.baseImage ? "Ready to generate" : "Connect a base image ←"}
        downloadable
        filename={`imagine-${id}.png`}
      />

      <label>Prompt</label>
      <textarea
        className="node-textarea"
        placeholder="Describe the edit or image to generate..."
        value={data.prompt || ""}
        onChange={(e) => updateNodeData(id, { prompt: e.target.value })}
      />

      <div className="row">
        <div>
          <label>Ratio</label>
          <select
            className="node-select"
            value={data.ratio || "AUTO"}
            onChange={(e) => updateNodeData(id, { ratio: e.target.value })}
          >
            {RATIOS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Resolution</label>
          <select
            className="node-select"
            value={data.resolution || "AUTO"}
            onChange={(e) => updateNodeData(id, { resolution: e.target.value })}
          >
            {RESOLUTIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
      </div>

      {data.error ? <div className="error-text">{data.error}</div> : null}

      <button className="btn node-footer-btn" onClick={handleGenerate} disabled={data.loading}>
        {data.loading ? "Generating..." : "✨ Generate"}
      </button>

      <Handle type="source" position={Position.Right} id="out" />
    </NodeShell>
  );
}
