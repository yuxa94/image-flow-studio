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

  async function handleMerge() {
    const layers = SLOTS.map((s) => ({
      dataUrl: data[s.field],
      opacity: data[s.opacityField] ?? 1,
    })).filter((l) => l.dataUrl);

    if (!layers.length) return;
    updateNodeData(id, { loading: true, error: null });
    try {
      const out = await mergeImages(layers);
      updateNodeData(id, { loading: false });
      setNodeOutput(id, out);
    } catch (err) {
      updateNodeData(id, { loading: false, error: err.message });
    }
  }

  return (
    <NodeShell title="Merge" badge="TOOL" selected={selected}>
      {SLOTS.map((s) => (
        <Handle key={s.handle} type="target" position={Position.Left} id={s.handle} style={{ top: s.top }} />
      ))}

      {SLOTS.map((s) => (
        <div key={s.field}>
          <label>
            {s.field} {data[s.field] ? "" : "(empty)"}
          </label>
          {data[s.field] ? (
            <ImagePreview src={data[s.field]} alt={s.field} style={{ aspectRatio: "16/6" }} />
          ) : null}
          {data[s.field] ? (
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={data[s.opacityField] ?? 1}
              onChange={(e) => updateNodeData(id, { [s.opacityField]: Number(e.target.value) })}
            />
          ) : null}
        </div>
      ))}

      {data.output ? (
        <ImagePreview src={data.output} alt="merged" downloadable filename={`merge-${id}.png`} />
      ) : null}

      {data.error ? <div className="error-text">{data.error}</div> : null}

      <button className="btn secondary node-footer-btn" onClick={handleMerge} disabled={data.loading}>
        {data.loading ? "Merging..." : "Merge"}
      </button>

      <Handle type="source" position={Position.Right} id="out" />
    </NodeShell>
  );
}
