import { useRef, useState } from "react";
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
  const generatingRef = useRef(false);

  async function handleGenerate() {
    if (generatingRef.current) return;
    const baseSrc = data.editedImage || data.baseImage;
    if (!baseSrc) {
      updateNodeData(id, { error: "Connect an image into the base input first." });
      return;
    }

    generatingRef.current = true;
    updateNodeData(id, { loading: true, error: null });

    const images = [];
    const baseRaw = dataUrlToRaw(baseSrc);
    if (baseRaw) images.push({ ...baseRaw, role: "base" });
    if (data.refImage) {
      const refRaw = dataUrlToRaw(data.refImage);
      if (refRaw) images.push({ ...refRaw, role: "reference" });
    }

    try {
      if (!baseRaw) throw new Error("기준 이미지 형식을 읽을 수 없습니다. 다시 캡처하거나 업로드해주세요.");
      const result = await generateImage({
        apiKey: settings.apiKey,
        model: settings.model,
        prompt: data.prompt || "",
        images,
        ratio: data.ratio && data.ratio !== "AUTO" ? data.ratio : data.baseRatio || "AUTO",
        resolution: data.resolution || "AUTO",
      });
      // the annotated edit is a one-shot instruction — clear it once consumed
      updateNodeData(id, { loading: false, error: null, editedImage: null });
      setNodeOutput(id, result.image);
      linkGeneratedImage(id, result.image);
    } catch (err) {
      updateNodeData(id, { loading: false, error: err.message });
    } finally {
      generatingRef.current = false;
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
        src={data.editedImage || data.baseImage}
        alt="base"
        empty="Connect a base image ←"
        downloadable={false}
        filename={`imagine-${id}.png`}
      />

      {data.baseRatio ? <div className="hint">캡처 비율 {data.baseRatio} · AUTO 선택 시 이 비율로 생성합니다.</div> : null}

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

      <button className="btn node-footer-btn" onClick={handleGenerate} disabled={data.loading || !(data.editedImage || data.baseImage)}>
        {data.loading ? "Generating..." : "✨ Generate"}
      </button>

      {data.output ? <><label>생성 결과</label><ImagePreview src={data.output} alt="output" downloadable filename={`imagine-${id}.png`} /></> : null}

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
