import { useState } from "react";
import { Handle, Position } from "@xyflow/react";
import NodeShell from "./NodeShell.jsx";
import { useStore } from "../lib/store.js";
import { cropImage } from "../lib/imageUtils.js";
import ImagePreview from "../components/ImagePreview.jsx";
import CropModal from "../components/CropModal.jsx";

export default function CropNode({ id, data, selected }) {
  const updateNodeData = useStore((s) => s.updateNodeData);
  const setNodeOutput = useStore((s) => s.setNodeOutput);
  const [modalOpen, setModalOpen] = useState(false);

  async function handleApply(rect, ratioLabel) {
    updateNodeData(id, { loading: true, error: null, ratio: ratioLabel });
    try {
      const out = await cropImage(data.input, rect);
      updateNodeData(id, { loading: false });
      setNodeOutput(id, out);
    } catch (err) {
      updateNodeData(id, { loading: false, error: err.message });
    } finally {
      setModalOpen(false);
    }
  }

  return (
    <NodeShell title="Crop" badge="TOOL" selected={selected}>
      <Handle type="target" position={Position.Left} id="in" />

      <ImagePreview src={data.input} alt="input" empty="Connect an image ←" />

      <div className="hint">Ratio: {data.ratio || "1:1"}</div>

      {data.output ? (
        <ImagePreview src={data.output} alt="cropped" downloadable filename={`crop-${id}.png`} />
      ) : null}

      {data.error ? <div className="error-text">{data.error}</div> : null}

      <button
        className="btn secondary node-footer-btn"
        onClick={() => setModalOpen(true)}
        disabled={!data.input || data.loading}
      >
        {data.loading ? "Cropping..." : "Crop Image"}
      </button>

      <Handle type="source" position={Position.Right} id="out" />

      {modalOpen ? (
        <CropModal
          baseSrc={data.input}
          initialRatioLabel={data.ratio || "1:1"}
          onCancel={() => setModalOpen(false)}
          onApply={handleApply}
        />
      ) : null}
    </NodeShell>
  );
}
