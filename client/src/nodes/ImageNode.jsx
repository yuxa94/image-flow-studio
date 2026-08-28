import { useRef } from "react";
import { Handle, Position } from "@xyflow/react";
import NodeShell from "./NodeShell.jsx";
import { useStore, HANDLE_LABELS } from "../lib/store.js";
import { fileToDataUrl } from "../lib/imageUtils.js";
import ImagePreview from "../components/ImagePreview.jsx";

export default function ImageNode({ id, data, selected }) {
  const updateNodeData = useStore((s) => s.updateNodeData);
  const propagateFrom = useStore((s) => s.propagateFrom);
  const inputRef = useRef(null);

  const roleBadge = useStore((s) => {
    const outgoing = s.edges.filter((e) => e.source === id);
    if (!outgoing.length) return "INPUT";
    const labels = [...new Set(outgoing.map((e) => HANDLE_LABELS[e.targetHandle]).filter(Boolean))];
    return labels.length ? labels.join(" / ") : "INPUT";
  });

  async function handleFile(file) {
    if (!file) return;
    const dataUrl = await fileToDataUrl(file);
    updateNodeData(id, { image: dataUrl });
    // wait a tick so the store update above is committed before we read it
    setTimeout(() => propagateFrom(id), 0);
  }

  return (
    <NodeShell title="Image" badge={roleBadge} selected={selected}>
      <Handle type="target" position={Position.Left} id="img" />

      <ImagePreview src={data.image} alt="input" empty="No image" />

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <button className="btn secondary node-footer-btn" onClick={() => inputRef.current?.click()}>
        {data.image ? "Replace" : "Upload image"}
      </button>

      <Handle type="source" position={Position.Right} id="out" />
    </NodeShell>
  );
}
