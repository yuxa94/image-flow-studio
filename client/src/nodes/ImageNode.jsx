import { useRef } from "react";
import { Handle, Position } from "@xyflow/react";
import NodeShell from "./NodeShell.jsx";
import { useStore } from "../lib/store.js";
import { fileToDataUrl } from "../lib/imageUtils.js";

export default function ImageNode({ id, data, selected }) {
  const updateNodeData = useStore((s) => s.updateNodeData);
  const propagateFrom = useStore((s) => s.propagateFrom);
  const inputRef = useRef(null);

  async function handleFile(file) {
    if (!file) return;
    const dataUrl = await fileToDataUrl(file);
    updateNodeData(id, { image: dataUrl });
    // wait a tick so the store update above is committed before we read it
    setTimeout(() => propagateFrom(id), 0);
  }

  return (
    <NodeShell title="Image" badge="INPUT" selected={selected}>
      {data.image ? (
        <div className="image-preview">
          <img src={data.image} alt="input" />
        </div>
      ) : (
        <div className="image-preview empty">No image</div>
      )}

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
