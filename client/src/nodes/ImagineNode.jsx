import { useState } from "react";
import { Handle, Position } from "@xyflow/react";
import NodeShell from "./NodeShell.jsx";
import { useStore } from "../lib/store.js";
import { generateImage } from "../lib/api.js";
import { dataUrlToRaw } from "../lib/imageUtils.js";
import ImagePreview from "../components/ImagePreview.jsx";
import EditCanvasModal from "../components/EditCanvasModal.jsx";
import { ASPECT_RATIO_LABELS } from "../lib/ratios.js";

const RATIOS = ["AUTO", ...ASPECT_RATIO_LABELS];
const RESOLUTIONS = ["AUTO", "1K", "2K", "4K"];

export default function ImagineNode({ id, data, selected }) {
  const updateNodeData = useStore((s) => s.updateNodeData);
  const setNodeOutput = useStore((s) => s.setNodeOutput);
  const linkGeneratedImage = useStore((s) => s.linkGeneratedImage);
  const settings = useStore((s) => s.settings);
  const [editorOpen, setEditorOpen] = useState(false);

  async function handleGenerate() {
    if (!settings.apiKey) {
      updateNodeData(id, { error: "Set your Gemini API key in Settings (bottom right)." });
      return;
    }
    const baseSrc = data.editedImage || data.baseImage;
    if (!baseSrc) {
      updateNodeData(id, { error: "Connect an image into the base input first." });
      return;
    }

    updateNodeData(id, { loading: true, error: null });

    const images = [];
    const baseRaw = dataUrlToRaw(baseSrc);
    if (baseRaw) images.push({ ...baseRaw, role: "base" });
    if (data.refImage) {
      const refRaw = dataUrlToRaw(data.refImage);
      if (refRaw) images.push({ ...refRaw, role: "reference" });
    }

    try {
      const result = await generateImage({
        apiKey: settings.apiKey,
        model: settings.model,
        prompt: data.prompt || "",
        images,
        ratio: data.ratio || "AUTO",
        resolution: data.resolution || "AUTO",
      });
      // the annotated edit is a one-shot instruction — clear it once consumed
      updateNodeData(id, { loading: false, error: null, editedImage: null });
      setNodeOutput(id, result.image);
      linkGeneratedImage(id, result.image);
    } catch (err) {
      updateNodeData(id, { loading: false, error: err.message });
    }
  }

  const editorBaseSrc = data.output || data.editedImage || data.baseImage;

  return (
    <NodeShell title="Imagine" badge="GEMINI" selected={selected}>
      <div className="handle-row">
        <Handle type="target" position={Position.Left} id="base" />
        <span className="handle-row-label">Base</span>
      </div>

      <ImagePreview
        src={data.output || data.baseImage}
        alt={data.output ? "output" : "base"}
        empty="Connect a base image ←"
        downloadable={!!data.output}
        filename={`imagine-${id}.png`}
      />

      <div className="handle-row">
        <Handle type="target" position={Position.Left} id="ref" />
        <span className="handle-row-label">Reference (optional)</span>
      </div>
      <ImagePreview src={data.refImage} alt="reference" empty="Connect a reference image ←" />

      <button
        className="btn secondary node-footer-btn"
        onClick={() => setEditorOpen(true)}
        disabled={!editorBaseSrc}
      >
        ✏ Edit
      </button>
      {data.editedImage ? (
        <div className="hint">
          Edit region marked — will be used on next Generate.{" "}
          <a href="#" onClick={(e) => { e.preventDefault(); updateNodeData(id, { editedImage: null }); }}>
            Clear
          </a>
        </div>
      ) : null}

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

      {editorOpen ? (
        <EditCanvasModal
          baseSrc={editorBaseSrc}
          initialPrompt={data.prompt}
          initialRefImage={data.refImage}
          onCancel={() => setEditorOpen(false)}
          onSave={({ editedImage, prompt, refImage }) => {
            updateNodeData(id, { editedImage, prompt, refImage });
            setEditorOpen(false);
          }}
        />
      ) : null}
    </NodeShell>
  );
}
