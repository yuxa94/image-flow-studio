import { Handle, Position, useReactFlow } from "@xyflow/react";
import NodeShell from "./NodeShell.jsx";
import { useStore } from "../lib/store.js";
import ImagePreview from "../components/ImagePreview.jsx";

export default function VWorldNode({ id, data, selected }) {
  const openVWorldMap = useStore((s) => s.openVWorldMap);

  const connectToImagine = useStore((s) => s.connectToImagine);
  const { fitView } = useReactFlow();

  return (
    <NodeShell title="VWorld" badge="CONTEXT" selected={selected}>
      <ImagePreview src={data.output} alt="capture" empty="No capture yet" downloadable filename={`vworld-${id}.png`} />

      <button className="btn secondary node-footer-btn" onClick={() => openVWorldMap(id)}>
        🌍 Open 3D Map
      </button>

      {data.captureRatio ? <div className="hint">캡처 비율 {data.captureRatio}</div> : null}
      <button className="btn node-footer-btn" disabled={!data.output} onClick={() => {
        const target = connectToImagine(id);
        requestAnimationFrame(() => fitView({ nodes: [{ id }, { id: target }], padding: 0.2, maxZoom: 1 }));
      }}>Imagine에 연결</button>
      <Handle type="source" position={Position.Right} id="out" />
    </NodeShell>
  );
}
