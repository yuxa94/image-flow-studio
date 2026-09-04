import { Handle, Position } from "@xyflow/react";
import NodeShell from "./NodeShell.jsx";
import { useStore } from "../lib/store.js";
import ImagePreview from "../components/ImagePreview.jsx";

export default function VWorldNode({ id, data, selected }) {
  const openVWorldMap = useStore((s) => s.openVWorldMap);

  return (
    <NodeShell title="VWorld" badge="CONTEXT" selected={selected}>
      <ImagePreview src={data.output} alt="capture" empty="No capture yet" downloadable filename={`vworld-${id}.png`} />

      <button className="btn secondary node-footer-btn" onClick={() => openVWorldMap(id)}>
        🌍 Open 3D Map
      </button>

      <Handle type="source" position={Position.Right} id="out" />
    </NodeShell>
  );
}
