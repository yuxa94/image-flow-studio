import { useState } from "react";
import { Handle, Position } from "@xyflow/react";
import NodeShell from "./NodeShell.jsx";
import { useStore } from "../lib/store.js";
import ImagePreview from "../components/ImagePreview.jsx";
import DrawCanvasModal from "../components/DrawCanvasModal.jsx";

export default function CanvasNode({ id, data, selected }) {
  const updateNodeData = useStore((s) => s.updateNodeData);
  const setNodeOutput = useStore((s) => s.setNodeOutput);
  const [open, setOpen] = useState(false);
  const strokeCount = data.strokes?.length || 0;

  function handleApply({ image, strokes }) {
    // Strokes stay editable on reopen. The input's crop rect passes through
    // so a drawn-on crop can still be pasted back in place by Merge.
    updateNodeData(id, { strokes, rect: data.inputRect || null });
    setNodeOutput(id, image);
    setOpen(false);
  }

  return (
    <NodeShell title="Canvas" badge="DRAW" selected={selected}>
      <Handle type="target" position={Position.Left} id="in" />

      <ImagePreview
        src={data.output || data.input}
        alt="canvas"
        empty="Connect an image ←"
        downloadable={!!data.output}
        filename={`canvas-${id}.png`}
      />

      {strokeCount ? <div className="hint">그린 획 {strokeCount}개 · 다시 열면 이어서 수정할 수 있습니다.</div> : null}
      {data.output && strokeCount ? (
        <div className="hint">입력 이미지가 바뀌면 다시 열어 Apply하면 새 이미지에 반영됩니다.</div>
      ) : null}

      <button className="btn secondary node-footer-btn" onClick={() => setOpen(true)} disabled={!data.input}>
        🖌 그리기
      </button>

      <Handle type="source" position={Position.Right} id="out" />

      {open ? (
        <DrawCanvasModal
          baseSrc={data.input}
          initialStrokes={data.strokes || []}
          onCancel={() => setOpen(false)}
          onApply={handleApply}
        />
      ) : null}
    </NodeShell>
  );
}
