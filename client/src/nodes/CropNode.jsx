import { useRef, useState } from "react";
import { Handle, Position } from "@xyflow/react";
import NodeShell from "./NodeShell.jsx";
import { useStore } from "../lib/store.js";
import { cropImage } from "../lib/imageUtils.js";

const DEFAULT_CROP = { xPct: 0.1, yPct: 0.1, wPct: 0.8, hPct: 0.8 };

export default function CropNode({ id, data, selected }) {
  const updateNodeData = useStore((s) => s.updateNodeData);
  const setNodeOutput = useStore((s) => s.setNodeOutput);
  const containerRef = useRef(null);
  const [dragStart, setDragStart] = useState(null);

  const crop = data.crop || DEFAULT_CROP;

  function clamp01(v) {
    return Math.min(1, Math.max(0, v));
  }

  function pointToPct(e) {
    const rect = containerRef.current.getBoundingClientRect();
    return {
      x: clamp01((e.clientX - rect.left) / rect.width),
      y: clamp01((e.clientY - rect.top) / rect.height),
    };
  }

  function onPointerDown(e) {
    if (!data.input) return;
    e.stopPropagation();
    setDragStart(pointToPct(e));
  }

  function onPointerMove(e) {
    if (!dragStart) return;
    e.stopPropagation();
    const cur = pointToPct(e);
    const xPct = Math.min(dragStart.x, cur.x);
    const yPct = Math.min(dragStart.y, cur.y);
    const wPct = Math.abs(cur.x - dragStart.x);
    const hPct = Math.abs(cur.y - dragStart.y);
    updateNodeData(id, { crop: { xPct, yPct, wPct, hPct } });
  }

  function onPointerUp(e) {
    e.stopPropagation();
    setDragStart(null);
  }

  async function handleApply() {
    if (!data.input) return;
    updateNodeData(id, { loading: true, error: null });
    try {
      const out = await cropImage(data.input, crop);
      updateNodeData(id, { loading: false });
      setNodeOutput(id, out);
    } catch (err) {
      updateNodeData(id, { loading: false, error: err.message });
    }
  }

  return (
    <NodeShell title="Crop" badge="TOOL" selected={selected}>
      <Handle type="target" position={Position.Left} id="in" />

      {data.input ? (
        <div
          className="image-preview crop-overlay nodrag"
          ref={containerRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          style={{ cursor: "crosshair" }}
        >
          <img src={data.input} alt="input" style={{ pointerEvents: "none" }} />
          <div
            className="crop-box"
            style={{
              left: `${crop.xPct * 100}%`,
              top: `${crop.yPct * 100}%`,
              width: `${crop.wPct * 100}%`,
              height: `${crop.hPct * 100}%`,
            }}
          />
        </div>
      ) : (
        <div className="image-preview empty">Connect an image ←</div>
      )}

      <div className="hint">Drag on the image to select a crop area.</div>

      {data.output ? (
        <div className="image-preview">
          <img src={data.output} alt="cropped" />
        </div>
      ) : null}

      {data.error ? <div className="error-text">{data.error}</div> : null}

      <button className="btn secondary node-footer-btn" onClick={handleApply} disabled={!data.input || data.loading}>
        {data.loading ? "Cropping..." : "Apply Crop"}
      </button>

      <Handle type="source" position={Position.Right} id="out" />
    </NodeShell>
  );
}
