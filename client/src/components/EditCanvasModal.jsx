import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fileToDataUrl, loadNaturalSize } from "../lib/imageUtils.js";

const COLORS = ["#ff3b30", "#ffd60a", "#34c759", "#0a84ff"];

export default function EditCanvasModal({ baseSrc, initialPrompt, initialRefImage, onCancel, onSave }) {
  const [natural, setNatural] = useState({ w: 1, h: 1 });
  const [tool, setTool] = useState("rect");
  const [color, setColor] = useState(COLORS[0]);
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [shapes, setShapes] = useState([]);
  const [drawing, setDrawing] = useState(null);
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [prompt, setPrompt] = useState(initialPrompt || "");
  const [refImage, setRefImage] = useState(initialRefImage || null);
  const [saving, setSaving] = useState(false);

  const containerRef = useRef(null);
  const refInputRef = useRef(null);
  const shapeCounter = useRef(1);

  useEffect(() => {
    let alive = true;
    loadNaturalSize(baseSrc).then((size) => {
      if (alive) setNatural(size);
    });
    return () => {
      alive = false;
    };
  }, [baseSrc]);

  function pushHistory() {
    setUndoStack((s) => [...s, shapes]);
    setRedoStack([]);
  }

  function pointFromEvent(e) {
    const rect = containerRef.current.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  }

  function handlePointerDown(e) {
    if (tool === "select") return;
    e.preventDefault();
    const p = pointFromEvent(e);
    const id = `s${shapeCounter.current++}`;
    if (tool === "rect") {
      setDrawing({ id, type: "rect", color, width: strokeWidth, x: p.x, y: p.y, w: 0, h: 0 });
    } else {
      setDrawing({ id, type: "path", color, width: strokeWidth, points: [p] });
    }
  }

  function handlePointerMove(e) {
    if (!drawing) return;
    const p = pointFromEvent(e);
    if (drawing.type === "rect") {
      setDrawing((d) => ({ ...d, w: p.x - d.x, h: p.y - d.y }));
    } else {
      setDrawing((d) => ({ ...d, points: [...d.points, p] }));
    }
  }

  function handlePointerUp() {
    if (!drawing) return;
    let finalShape = drawing;
    if (drawing.type === "rect") {
      const x = Math.min(drawing.x, drawing.x + drawing.w);
      const y = Math.min(drawing.y, drawing.y + drawing.h);
      const w = Math.abs(drawing.w);
      const h = Math.abs(drawing.h);
      if (w < 0.01 || h < 0.01) {
        setDrawing(null);
        return;
      }
      finalShape = { id: drawing.id, type: "rect", color: drawing.color, width: drawing.width, x, y, w, h };
    } else if (drawing.points.length < 2) {
      setDrawing(null);
      return;
    }
    pushHistory();
    setShapes((s) => [...s, { ...finalShape, visible: true }]);
    setDrawing(null);
  }

  function undo() {
    if (!undoStack.length) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack((s) => s.slice(0, -1));
    setRedoStack((s) => [...s, shapes]);
    setShapes(prev);
  }

  function redo() {
    if (!redoStack.length) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack((s) => s.slice(0, -1));
    setUndoStack((s) => [...s, shapes]);
    setShapes(next);
  }

  function deleteShape(shapeId) {
    pushHistory();
    setShapes((s) => s.filter((sh) => sh.id !== shapeId));
  }

  function toggleVisible(shapeId) {
    setShapes((s) => s.map((sh) => (sh.id === shapeId ? { ...sh, visible: !sh.visible } : sh)));
  }

  function clearAll() {
    if (!shapes.length) return;
    pushHistory();
    setShapes([]);
  }

  async function handleRefFile(file) {
    if (!file) return;
    setRefImage(await fileToDataUrl(file));
  }

  async function handleSave() {
    setSaving(true);
    const canvas = document.createElement("canvas");
    canvas.width = natural.w;
    canvas.height = natural.h;
    const ctx = canvas.getContext("2d");
    const img = new Image();
    await new Promise((resolve) => {
      img.onload = resolve;
      img.src = baseSrc;
    });
    ctx.drawImage(img, 0, 0, natural.w, natural.h);

    // shapes were drawn at the on-screen container size, in CSS pixels —
    // scale their stroke width up to the natural resolution being exported.
    const displayedWidth = containerRef.current?.getBoundingClientRect().width || natural.w;
    const scale = natural.w / displayedWidth;

    for (const shape of shapes) {
      if (!shape.visible) continue;
      ctx.strokeStyle = shape.color;
      ctx.lineWidth = (shape.width || 4) * scale;
      if (shape.type === "rect") {
        ctx.strokeRect(shape.x * natural.w, shape.y * natural.h, shape.w * natural.w, shape.h * natural.h);
      } else if (shape.type === "path" && shape.points.length > 1) {
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(shape.points[0].x * natural.w, shape.points[0].y * natural.h);
        for (const pt of shape.points.slice(1)) ctx.lineTo(pt.x * natural.w, pt.y * natural.h);
        ctx.stroke();
      }
    }

    onSave({ editedImage: canvas.toDataURL("image/png"), prompt, refImage });
  }

  return createPortal(
    <div className="editcanvas-overlay">
      <div className="editcanvas-modal">
        <div className="editcanvas-header">
          <button className="editcanvas-close" onClick={onCancel} title="Close">
            ✕
          </button>
          <span>Imagine — Edit Canvas</span>
        </div>

        <div className="editcanvas-body">
          <div className="editcanvas-layers">
            <div className="layers-title">Layers</div>
            <div className="layer-row">
              <span className="layer-swatch" style={{ background: "#555" }} />
              <span className="layer-name">Source image</span>
            </div>
            {shapes.map((s, i) => (
              <div className="layer-row" key={s.id}>
                <span className="layer-swatch" style={{ background: s.color }} />
                <span className="layer-name">{s.type === "rect" ? `Rectangle ${i + 1}` : `Brush ${i + 1}`}</span>
                <button className="layer-btn" onClick={() => toggleVisible(s.id)} title="Toggle visibility">
                  {s.visible ? "👁" : "🚫"}
                </button>
                <button className="layer-btn" onClick={() => deleteShape(s.id)} title="Delete">
                  🗑
                </button>
              </div>
            ))}
          </div>

          <div className="editcanvas-canvas-wrap">
            <div className="editcanvas-toolbar">
              <button className={tool === "select" ? "active" : ""} onClick={() => setTool("select")} title="Select">
                ↖
              </button>
              <button className={tool === "rect" ? "active" : ""} onClick={() => setTool("rect")} title="Rectangle">
                ▭
              </button>
              <button className={tool === "brush" ? "active" : ""} onClick={() => setTool("brush")} title="Brush">
                ✏
              </button>
              <span className="toolbar-sep" />
              {COLORS.map((c) => (
                <button
                  key={c}
                  className={`color-swatch${color === c ? " active" : ""}`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                  title={c}
                />
              ))}
              <span className="toolbar-sep" />
              <label className="toolbar-width">
                <span>{strokeWidth}px</span>
                <input
                  type="range"
                  min="1"
                  max="20"
                  value={strokeWidth}
                  onChange={(e) => setStrokeWidth(Number(e.target.value))}
                />
              </label>
              <span className="toolbar-sep" />
              <button onClick={undo} disabled={!undoStack.length} title="Undo">
                ↩
              </button>
              <button onClick={redo} disabled={!redoStack.length} title="Redo">
                ↪
              </button>
              <button onClick={clearAll} disabled={!shapes.length} title="Clear all">
                Clear
              </button>
            </div>

            <div className="editcanvas-stage">
            <div
              className="editcanvas-canvas"
              ref={containerRef}
              style={{ aspectRatio: `${natural.w} / ${natural.h}` }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
            >
              <img src={baseSrc} alt="editing" draggable={false} />
              <svg className="editcanvas-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
                {shapes
                  .filter((s) => s.visible)
                  .map((s) =>
                    s.type === "rect" ? (
                      <rect
                        key={s.id}
                        x={s.x * 100}
                        y={s.y * 100}
                        width={s.w * 100}
                        height={s.h * 100}
                        fill="none"
                        stroke={s.color}
                        strokeWidth={s.width || 4}
                        vectorEffect="non-scaling-stroke"
                      />
                    ) : (
                      <polyline
                        key={s.id}
                        points={s.points.map((p) => `${p.x * 100},${p.y * 100}`).join(" ")}
                        fill="none"
                        stroke={s.color}
                        strokeWidth={s.width || 4}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        vectorEffect="non-scaling-stroke"
                      />
                    )
                  )}
                {drawing?.type === "rect" ? (
                  <rect
                    x={Math.min(drawing.x, drawing.x + drawing.w) * 100}
                    y={Math.min(drawing.y, drawing.y + drawing.h) * 100}
                    width={Math.abs(drawing.w) * 100}
                    height={Math.abs(drawing.h) * 100}
                    fill="none"
                    stroke={drawing.color}
                    strokeDasharray="2 1"
                    strokeWidth={drawing.width || 4}
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}
                {drawing?.type === "path" ? (
                  <polyline
                    points={drawing.points.map((p) => `${p.x * 100},${p.y * 100}`).join(" ")}
                    fill="none"
                    stroke={drawing.color}
                    strokeWidth={drawing.width || 4}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}
              </svg>
            </div>
            </div>
          </div>

          <div className="editcanvas-side">
            <label>Prompt</label>
            <textarea
              className="node-textarea"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the edit for the marked region..."
              style={{ minHeight: 90 }}
            />

            <label>Reference image</label>
            {refImage ? (
              <div className="image-preview" style={{ aspectRatio: "4 / 3" }}>
                <img src={refImage} alt="reference" />
              </div>
            ) : (
              <div className="image-preview empty" style={{ aspectRatio: "4 / 3" }}>
                None
              </div>
            )}
            <input
              ref={refInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => handleRefFile(e.target.files?.[0])}
            />
            <button className="btn secondary" onClick={() => refInputRef.current?.click()}>
              {refImage ? "Replace reference" : "Upload reference"}
            </button>

            <div className="editcanvas-side-actions">
              <button className="btn secondary" onClick={onCancel}>
                Cancel
              </button>
              <button className="btn" onClick={handleSave} disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
