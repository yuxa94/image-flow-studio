import { useEffect, useRef, useState } from "react";
import { Handle, Position } from "@xyflow/react";
import NodeShell from "./NodeShell.jsx";
import { useStore } from "../lib/store.js";
import { adjustImage, DEFAULT_ADJUSTMENTS, isNeutralAdjustment } from "../lib/imageUtils.js";
import ImagePreview from "../components/ImagePreview.jsx";

// Photoshop-style color/tone adjustments. Changes apply automatically:
// a small preview renders right away while dragging, and the full-resolution
// result is rendered shortly after the last change and pushed downstream.
const GROUPS = [
  {
    title: "Light",
    sliders: [
      { key: "exposure", label: "노출 Exposure", min: -3, max: 3, step: 0.05 },
      { key: "brightness", label: "밝기 Brightness", min: -100, max: 100, step: 1 },
      { key: "contrast", label: "대비 Contrast", min: -100, max: 100, step: 1 },
      { key: "highlights", label: "하이라이트 Highlights", min: -100, max: 100, step: 1 },
      { key: "shadows", label: "섀도 Shadows", min: -100, max: 100, step: 1 },
    ],
  },
  {
    title: "Color",
    sliders: [
      { key: "saturation", label: "채도 Saturation", min: -100, max: 100, step: 1 },
      { key: "vibrance", label: "생동감 Vibrance", min: -100, max: 100, step: 1 },
      { key: "hue", label: "색조 Hue", min: -180, max: 180, step: 1 },
      { key: "temperature", label: "색온도 Temperature", min: -100, max: 100, step: 1 },
      { key: "tint", label: "틴트 Tint", min: -100, max: 100, step: 1 },
    ],
  },
];

const PREVIEW_MAX_SIDE = 480;
const FULL_RENDER_DELAY_MS = 350;

function formatValue(key, v) {
  if (key === "exposure") return `${v > 0 ? "+" : ""}${Number(v).toFixed(2)} EV`;
  if (key === "hue") return `${v > 0 ? "+" : ""}${v}°`;
  return `${v > 0 ? "+" : ""}${v}`;
}

export default function AdjustNode({ id, data, selected }) {
  const updateNodeData = useStore((s) => s.updateNodeData);
  const setNodeOutput = useStore((s) => s.setNodeOutput);
  const [preview, setPreview] = useState(null);
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

  function setAdj(patch) {
    updateNodeData(id, { adjustments: { ...adj, ...patch } });
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
      />

      {GROUPS.map((group) => (
        <div key={group.title} className="adjust-group">
          <div className="adjust-group-title">{group.title}</div>
          {group.sliders.map((s) => (
            <div key={s.key} className="adjust-slider">
              <div className="adjust-slider-head">
                <span>{s.label}</span>
                <button
                  type="button"
                  className={`adjust-value${adj[s.key] !== 0 ? " changed" : ""}`}
                  title="클릭하면 0으로 되돌립니다"
                  onClick={() => setAdj({ [s.key]: 0 })}
                >
                  {formatValue(s.key, adj[s.key])}
                </button>
              </div>
              <input
                type="range"
                min={s.min}
                max={s.max}
                step={s.step}
                value={adj[s.key]}
                disabled={!data.input}
                onChange={(e) => setAdj({ [s.key]: Number(e.target.value) })}
                onDoubleClick={() => setAdj({ [s.key]: 0 })}
              />
            </div>
          ))}
        </div>
      ))}

      <label className="adjust-toggle">
        <input
          type="checkbox"
          checked={adj.invert}
          disabled={!data.input}
          onChange={(e) => setAdj({ invert: e.target.checked })}
        />
        반전 Invert
      </label>

      {data.error ? <div className="error-text">{data.error}</div> : null}

      <button
        className="btn secondary node-footer-btn"
        onClick={() => updateNodeData(id, { adjustments: { ...DEFAULT_ADJUSTMENTS } })}
        disabled={neutral}
      >
        ↺ Reset all
      </button>
      <div className="hint">슬라이더를 더블클릭하거나 값을 클릭하면 그 항목만 0으로 돌아갑니다.</div>

      <Handle type="source" position={Position.Right} id="out" />
    </NodeShell>
  );
}
