import { useEffect, useRef, useState } from "react";
import { Handle, Position } from "@xyflow/react";
import NodeShell from "./NodeShell.jsx";
import { useStore } from "../lib/store.js";
import { adjustImage, DEFAULT_ADJUSTMENTS, isNeutralAdjustment } from "../lib/imageUtils.js";
import ImagePreview from "../components/ImagePreview.jsx";
import AdjustControls from "../components/AdjustControls.jsx";
import AdjustModal from "../components/AdjustModal.jsx";

// Photoshop-style color/tone adjustments. Changes apply automatically:
// a small preview renders right away while dragging, and the full-resolution
// result is rendered shortly after the last change and pushed downstream.
// Clicking the preview (or "⤢ 크게 조절") opens the enlarged AdjustModal.
const PREVIEW_MAX_SIDE = 480;
const FULL_RENDER_DELAY_MS = 350;

export default function AdjustNode({ id, data, selected }) {
  const updateNodeData = useStore((s) => s.updateNodeData);
  const setNodeOutput = useStore((s) => s.setNodeOutput);
  const [preview, setPreview] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const renderSeq = useRef(0);

  const adj = { ...DEFAULT_ADJUSTMENTS, ...(data.adjustments || {}) };
  const adjKey = JSON.stringify(adj);

  useEffect(() => {
    const seq = ++renderSeq.current;
    if (!data.input) {
      setPreview(null);
      if (data.output) setNodeOutput(id, null);
      return;
    }

    // Untouched settings: pass the input straight through.
    if (isNeutralAdjustment(adj)) {
      setPreview(null);
      if (data.output !== data.input) {
        updateNodeData(id, { rect: data.inputRect || null, error: null });
        setNodeOutput(id, data.input);
      }
      return;
    }

    adjustImage(data.input, adj, PREVIEW_MAX_SIDE)
      .then((small) => { if (seq === renderSeq.current) setPreview(small); })
      .catch(() => {});

    const timer = setTimeout(async () => {
      try {
        const full = await adjustImage(data.input, adj);
        if (seq !== renderSeq.current) return;
        updateNodeData(id, { rect: data.inputRect || null, error: null });
        setNodeOutput(id, full);
        setPreview(null);
      } catch (err) {
        if (seq === renderSeq.current) updateNodeData(id, { error: err.message || "Adjust failed" });
      }
    }, FULL_RENDER_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.input, adjKey]);

  function setAdjustments(next) {
    updateNodeData(id, { adjustments: { ...DEFAULT_ADJUSTMENTS, ...next } });
  }

  const shown = preview || data.output;
  const neutral = isNeutralAdjustment(adj);

  return (
    <NodeShell title="Adjust" badge="TOOL" selected={selected}>
      <Handle type="target" position={Position.Left} id="in" />

      <ImagePreview
        src={data.input ? shown || data.input : null}
        alt="adjusted"
        empty="Connect an image ←"
        downloadable={!!data.output && !preview}
        filename={`adjust-${id}.png`}
        onOpen={() => setModalOpen(true)}
      />

      <button
        className="btn secondary node-footer-btn"
        onClick={() => setModalOpen(true)}
        disabled={!data.input}
      >
        ⤢ 크게 조절
      </button>

      <AdjustControls adj={adj} onChange={(patch) => setAdjustments({ ...adj, ...patch })} disabled={!data.input} />

      {data.error ? <div className="error-text">{data.error}</div> : null}

      <button
        className="btn secondary node-footer-btn"
        onClick={() => setAdjustments(DEFAULT_ADJUSTMENTS)}
        disabled={neutral}
      >
        ↺ Reset all
      </button>
      <div className="hint">슬라이더를 더블클릭하거나 값을 클릭하면 그 항목만 0으로 돌아갑니다.</div>

      <Handle type="source" position={Position.Right} id="out" />

      {modalOpen && data.input ? (
        <AdjustModal
          input={data.input}
          adjustments={adj}
          onChange={setAdjustments}
          onClose={() => setModalOpen(false)}
        />
      ) : null}
    </NodeShell>
  );
}
