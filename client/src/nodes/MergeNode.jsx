import { useRef, useState } from "react";
import { Handle, Position } from "@xyflow/react";
import NodeShell from "./NodeShell.jsx";
import { useStore } from "../lib/store.js";
import { mergeImages } from "../lib/imageUtils.js";
import ImagePreview from "../components/ImagePreview.jsx";
import MergeWorkspaceModal from "../components/MergeWorkspaceModal.jsx";

const SLOTS = [
  { field: "input1", handle: "in1", opacityField: "opacity1", top: "20%" },
  { field: "input2", handle: "in2", opacityField: "opacity2", top: "50%" },
  { field: "input3", handle: "in3", opacityField: "opacity3", top: "80%" },
];

export default function MergeNode({ id, data, selected }) {
  const updateNodeData = useStore((s) => s.updateNodeData);
  const setNodeOutput = useStore((s) => s.setNodeOutput);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const mergeSeqRef = useRef(0);

  async function runMerge(patch = {}) {
    const latest = useStore.getState().nodes.find((n) => n.id === id)?.data || data;
    const merged = { ...latest, ...patch };
    const layers = SLOTS.map((s) => ({
      dataUrl: merged[s.field],
      opacity: merged[s.opacityField] ?? 1,
      rect: merged[`${s.field}Rect`] || null,
      offsetX: merged[`${s.field}OffsetX`] || 0,
      offsetY: merged[`${s.field}OffsetY`] || 0,
    })).filter((l) => l.dataUrl);

    if (!layers.length) return;
    // Drops a slower, older merge if a newer one started in the meantime.
    const seq = ++mergeSeqRef.current;
    updateNodeData(id, { loading: true, error: null, ...patch });
    try {
      const out = await mergeImages(layers);
      if (mergeSeqRef.current !== seq) return;
      updateNodeData(id, { loading: false });
      setNodeOutput(id, out);
    } catch (err) {
      if (mergeSeqRef.current !== seq) return;
      updateNodeData(id, { loading: false, error: err.message });
    }
  }

  const workspaceLayers = SLOTS.filter((s) => data[s.field]).map((s) => ({
    field: s.field,
    opacityField: s.opacityField,
    label: data[`${s.field}Rect`] ? `${s.field} · 📍 patch` : s.field,
    src: data[s.field],
    rect: data[`${s.field}Rect`] || null,
    offsetX: data[`${s.field}OffsetX`] || 0,
    offsetY: data[`${s.field}OffsetY`] || 0,
    opacity: data[s.opacityField] ?? 1,
  }));

  function handleWorkspaceApply(edited) {
    const patch = {};
    for (const l of edited) {
      patch[`${l.field}OffsetX`] = l.offsetX;
      patch[`${l.field}OffsetY`] = l.offsetY;
      patch[l.opacityField] = l.opacity;
    }
    setWorkspaceOpen(false);
    runMerge(patch);
  }

  return (
    <NodeShell title="Merge" badge="TOOL" selected={selected}>
      {SLOTS.map((s) => (
        <Handle key={s.handle} type="target" position={Position.Left} id={s.handle} style={{ top: s.top }} />
      ))}

      {SLOTS.map((s) => {
        const offsetX = data[`${s.field}OffsetX`] || 0;
        const offsetY = data[`${s.field}OffsetY`] || 0;
        return (
          <div key={s.field}>
            <label>
              {s.field} {data[s.field] ? "" : "(empty)"}
              {data[`${s.field}Rect`] ? " · 📍 positioned patch" : ""}
            </label>
            {data[s.field] ? (
              <>
                <ImagePreview src={data[s.field]} alt={s.field} style={{ aspectRatio: "16/6" }} />
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={data[s.opacityField] ?? 1}
                  onChange={(e) => updateNodeData(id, { [s.opacityField]: Number(e.target.value) })}
                />
                {offsetX || offsetY ? (
                  <div className="hint">
                    위치 보정 {offsetX}px, {offsetY}px
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        );
      })}

      <div className="hint">
        크롭 없이 연결한 이미지는 원본(캔버스 크기)으로 사용됩니다. 크롭 → Imagine으로 수정한 결과를 다른 슬롯에
        연결하면 같은 위치에 patch됩니다.
      </div>

      <button
        className="btn secondary node-footer-btn"
        onClick={() => setWorkspaceOpen(true)}
        disabled={!workspaceLayers.length}
      >
        🧩 작업 탭에서 위치 조정
      </button>

      {data.output ? (
        <ImagePreview src={data.output} alt="merged" downloadable filename={`merge-${id}.png`} />
      ) : null}

      {data.error ? <div className="error-text">{data.error}</div> : null}

      <button className="btn secondary node-footer-btn" onClick={() => runMerge()} disabled={data.loading}>
        {data.loading ? "Merging..." : "Merge"}
      </button>

      <Handle type="source" position={Position.Right} id="out" />

      {workspaceOpen ? (
        <MergeWorkspaceModal
          layers={workspaceLayers}
          onCancel={() => setWorkspaceOpen(false)}
          onApply={handleWorkspaceApply}
        />
      ) : null}
    </NodeShell>
  );
}
