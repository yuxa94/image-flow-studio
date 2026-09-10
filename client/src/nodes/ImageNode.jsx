import { useRef } from "react";
import { Handle, Position } from "@xyflow/react";
import NodeShell from "./NodeShell.jsx";
import { useStore, HANDLE_LABELS } from "../lib/store.js";
import { fileToDataUrl } from "../lib/imageUtils.js";
import ImagePreview from "../components/ImagePreview.jsx";

export default function ImageNode({ id, data, selected }) {
  const updateNodeData = useStore((s) => s.updateNodeData);
  const replaceNodeImage = useStore((s) => s.replaceNodeImage);
  const inputRef = useRef(null);

  const roleBadge = useStore((s) => {
    const outgoing = s.edges.filter((e) => e.source === id);
    if (!outgoing.length) return "INPUT";
    const labels = [...new Set(outgoing.map((e) => HANDLE_LABELS[e.targetHandle]).filter(Boolean))];
    return labels.length ? labels.join(" / ") : "INPUT";
  });

  async function handleFile(file) {
    if (!file) return;
    try {
      const dataUrl = await fileToDataUrl(file);
      replaceNodeImage(id, dataUrl);
    } catch {
      updateNodeData(id, { error: "이미지 파일을 읽지 못했습니다. 다른 파일로 다시 시도해주세요." });
    }
  }

  return (
    <NodeShell title={data.generationIndex ? `결과 ${data.generationIndex}` : "Image"} badge={roleBadge} selected={selected}>
      <Handle type="target" position={Position.Left} id="img" />

      <ImagePreview src={data.image} alt="input" empty="No image" downloadable={!!data.generationIndex} filename={`result-${id}.png`} />

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ""; }}
      />
      <button className="btn secondary node-footer-btn" onClick={() => inputRef.current?.click()}>
        {data.image ? "Replace" : "Upload image"}
      </button>

      {data.error ? <div className="error-text">{data.error}</div> : null}
      <Handle type="source" position={Position.Right} id="out" />
    </NodeShell>
  );
}
