import { useRef, useState } from "react";
import { Handle, Position } from "@xyflow/react";
import NodeShell from "./NodeShell.jsx";
import { useStore } from "../lib/store.js";
import { mergeImages } from "../lib/imageUtils.js";
import ImagePreview from "../components/ImagePreview.jsx";

const SLOTS = [
  { field: "input1", handle: "in1", opacityField: "opacity1", top: "20%" },
  { field: "input2", handle: "in2", opacityField: "opacity2", top: "50%" },
  { field: "input3", handle: "in3", opacityField: "opacity3", top: "80%" },
];

export default function MergeNode({ id, data, selected }) {
  const updateNodeData = useStore((s) => s.updateNodeData);
  const setNodeOutput = useStore((s) => s.setNodeOutput);
  const [activeSlot, setActiveSlot] = useState(null);
  const focusRef = useRef(null);
  const mergeSeqRef = useRef(0);

  // Reads the store directly (not the `data` prop) so a burst of rapid key
  // presses — each firing before React re-renders this node — still
  // accumulates onto the actual latest offset instead of a stale closure value.
  function currentData() {
    return useStore.getState().nodes.find((n) => n.id === id)?.data || data;
  }

  async function runMerge(patch = {}) {
    const merged = { ...currentData(), ...patch };
    const layers = SLOTS.map((s) => ({
      dataUrl: merged[s.field],
      opacity: merged[s.opacityField] ?? 1,
      rect: merged[`${s.field}Rect`] || null,
      offsetX: merged[`${s.field}OffsetX`] || 0,
      offsetY: merged[`${s.field}OffsetY`] || 0,
    })).filter((l) => l.dataUrl);

    if (!layers.length) return;
    // Guards against an older, slower-resolving merge overwriting a newer
    // one's result when nudges fire faster than mergeImages can resolve.
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

  function nudge(field, dx, dy) {
    const xField = `${field}OffsetX`;
    const yField = `${field}OffsetY`;
    const current = currentData();
    runMerge({ [xField]: (current[xField] || 0) + dx, [yField]: (current[yField] || 0) + dy });
  }

  function selectSlot(field) {
    setActiveSlot((current) => (current === field ? null : field));
    requestAnimationFrame(() => focusRef.current?.focus());
  }

  function handleKeyDown(e) {
    if (!activeSlot) return;
    const step = e.shiftKey ? 10 : 1;
    let dx = 0, dy = 0;
    if (e.key === "ArrowLeft") dx = -step;
    else if (e.key === "ArrowRight") dx = step;
    else if (e.key === "ArrowUp") dy = -step;
    else if (e.key === "ArrowDown") dy = step;
    else return;
    e.preventDefault();
    e.stopPropagation();
    nudge(activeSlot, dx, dy);
  }

  return (
    <NodeShell title="Merge" badge="TOOL" selected={selected}>
      {SLOTS.map((s) => (
        <Handle key={s.handle} type="target" position={Position.Left} id={s.handle} style={{ top: s.top }} />
      ))}

      <div
        ref={focusRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onBlur={() => setActiveSlot(null)}
        style={{ outline: "none" }}
      >
        {SLOTS.map((s) => {
          const offsetX = data[`${s.field}OffsetX`] || 0;
          const offsetY = data[`${s.field}OffsetY`] || 0;
          const isActive = activeSlot === s.field;
          return (
            <div key={s.field} className={`merge-slot${isActive ? " active" : ""}`}>
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
                  <div className="merge-slot-position">
                    <button
                      type="button"
                      className={`btn secondary merge-position-btn${isActive ? " active" : ""}`}
                      onClick={() => selectSlot(s.field)}
                    >
                      {isActive ? "⌖ 방향키로 이동 (Shift=10px)" : "🎯 위치 조정"}
                    </button>
                    {(offsetX || offsetY) ? (
                      <span className="hint merge-offset-readout">
                        {offsetX}px, {offsetY}px
                        <a
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            runMerge({ [`${s.field}OffsetX`]: 0, [`${s.field}OffsetY`]: 0 });
                          }}
                        >
                          초기화
                        </a>
                      </span>
                    ) : null}
                  </div>
                </>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="hint">
        크롭 없이 연결한 이미지는 원본(캔버스 크기)으로 사용됩니다. 크롭 → Imagine으로 수정한 결과를 다른 슬롯에
        연결하면 같은 위치에 patch됩니다. 경계가 살짝 어긋나면 "위치 조정"을 누르고 방향키로 픽셀 단위로 맞추세요.
      </div>

      {data.output ? (
        <ImagePreview src={data.output} alt="merged" downloadable filename={`merge-${id}.png`} />
      ) : null}

      {data.error ? <div className="error-text">{data.error}</div> : null}

      <button className="btn secondary node-footer-btn" onClick={() => runMerge()} disabled={data.loading}>
        {data.loading ? "Merging..." : "Merge"}
      </button>

      <Handle type="source" position={Position.Right} id="out" />
    </NodeShell>
  );
}
