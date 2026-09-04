import { useCallback, useRef } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useReactFlow,
} from "@xyflow/react";
import { useStore, nextId } from "./lib/store.js";
import { PALETTE } from "./nodeConfig.js";
import SettingsPanel from "./SettingsPanel.jsx";
import Lightbox from "./components/Lightbox.jsx";
import VWorldMapModal from "./components/VWorldMapModal.jsx";

import ImageNode from "./nodes/ImageNode.jsx";
import ImagineNode from "./nodes/ImagineNode.jsx";
import CropNode from "./nodes/CropNode.jsx";
import MergeNode from "./nodes/MergeNode.jsx";
import UpscaleNode from "./nodes/UpscaleNode.jsx";
import VWorldNode from "./nodes/VWorldNode.jsx";

const nodeTypes = {
  image: ImageNode,
  imagine: ImagineNode,
  crop: CropNode,
  merge: MergeNode,
  upscale: UpscaleNode,
  vworld: VWorldNode,
};

function Sidebar() {
  return (
    <div className="sidebar">
      <h1>Image Flow Studio</h1>
      {PALETTE.map((section) => (
        <div className="sidebar-section" key={section.section}>
          <h2>{section.section}</h2>
          {section.items.map((item) => (
            <div
              key={item.type}
              className="palette-item"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("application/x-flow-node", item.type);
                e.dataTransfer.effectAllowed = "move";
              }}
            >
              <span className="title">{item.title}</span>
              <span className="subtitle">{item.subtitle}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Canvas() {
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const onNodesChange = useStore((s) => s.onNodesChange);
  const onEdgesChange = useStore((s) => s.onEdgesChange);
  const onConnect = useStore((s) => s.onConnect);
  const addNode = useStore((s) => s.addNode);
  const { screenToFlowPosition } = useReactFlow();
  const wrapperRef = useRef(null);

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      const type = e.dataTransfer.getData("application/x-flow-node");
      if (!type) return;
      const item = PALETTE.flatMap((s) => s.items).find((i) => i.type === type);
      if (!item) return;

      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      addNode({
        id: nextId(type),
        type,
        position,
        data: item.defaultData(),
      });
    },
    [screenToFlowPosition, addNode]
  );

  const onDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  return (
    <div className="canvas-wrap" ref={wrapperRef} onDrop={onDrop} onDragOver={onDragOver}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        fitView
      >
        <Background gap={20} size={1} color="#22252b" />
        <Controls />
        <MiniMap pannable zoomable style={{ background: "#16181c" }} />
      </ReactFlow>
      <SettingsPanel />
    </div>
  );
}

export default function App() {
  return (
    <div className="app">
      <Sidebar />
      <ReactFlowProvider>
        <Canvas />
      </ReactFlowProvider>
      <Lightbox />
      <VWorldMapModal />
    </div>
  );
}
