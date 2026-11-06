import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const COLORS = ["#ff3b30", "#ff9500", "#ffd60a", "#34c759", "#0a84ff", "#bf5af2", "#ffffff", "#000000"];

let strokeCounter = 1;
function newStrokeId() {
  return `${Date.now().toString(36)}-${strokeCounter++}`;
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function isTypingTarget(el) {
  return el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Strokes are stored in the source image's own pixel space (points and
// width), so they export at full resolution and look identical no matter
// how large the modal happens to render the image.
function traceStroke(ctx, s) {
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = s.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (s.points.length === 1) {
    // canvas prunes zero-length segments, so a single click needs an explicit dot
    ctx.beginPath();
    ctx.arc(s.points[0].x, s.points[0].y, s.width / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(s.points[0].x, s.points[0].y);
  for (const p of s.points.slice(1)) ctx.lineTo(p.x, p.y);
  if (s.closed) ctx.closePath();
  ctx.stroke();
}

function StrokeShape({ s }) {
  if (s.points.length === 1) {
    return <circle cx={s.points[0].x} cy={s.points[0].y} r={s.width / 2} fill={s.color} />;
  }
  const points = s.points.map((p) => `${p.x},${p.y}`).join(" ");
  const common = {
    points,
    fill: "none",
    stroke: s.color,
    strokeWidth: s.width,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  };
  return s.closed ? <polygon {...common} /> : <polyline {...common} />;
}

export default function DrawCanvasModal({ baseSrc, initialStrokes, onCancel, onApply }) {
  const [natural, setNatural] = useState(null);
  const [tool, setTool] = useState("brush");
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(4);
  const [strokes, setStrokes] = useState(initialStrokes || []);
  const [drawing, setDrawing] = useState(null);
  const [penPoints, setPenPoints] = useState([]);
  const [hover, setHover] = useState(null);
  const [nearStart, setNearStart] = useState(false);
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [saving, setSaving] = useState(false);
  const rootRef = useRef(null);
  const stageRef = useRef(null);

  useEffect(() => {
    let alive = true;
    loadImage(baseSrc).then((img) => {
      if (!alive) return;
      const size = { w: img.naturalWidth || 1, h: img.naturalHeight || 1 };
      setNatural(size);
      setWidth(Math.max(2, Math.round(size.w / 250)));
    });
    rootRef.current?.focus();
    return () => {
      alive = false;
    };
  }, [baseSrc]);

  const maxWidth = natural ? Math.max(40, Math.round(natural.w / 10)) : 40;

  // natural-image pixels per on-screen pixel, for screen-sized hit areas
  function pxRatio() {
    const box = stageRef.current?.getBoundingClientRect();
    return natural && box?.width ? natural.w / box.width : 1;
  }

  function pointFromEvent(e) {
    const box = stageRef.current.getBoundingClientRect();
    return {
      x: Math.min(natural.w, Math.max(0, ((e.clientX - box.left) / box.width) * natural.w)),
      y: Math.min(natural.h, Math.max(0, ((e.clientY - box.top) / box.height) * natural.h)),
    };
  }

  function commit(stroke) {
    setUndoStack((s) => [...s, strokes]);
    setRedoStack([]);
    setStrokes((s) => [...s, stroke]);
  }

  function penStroke(closed) {
    return { id: newStrokeId(), tool: "pen", color, width, points: penPoints, closed, visible: true };
  }

  function finishPen(closed = false) {
    if (penPoints.length >= 2) commit(penStroke(closed && penPoints.length >= 3));
    setPenPoints([]);
    setNearStart(false);
  }

  function chooseTool(next) {
    if (next !== "pen" && penPoints.length) finishPen(false);
    setTool(next);
  }

  function handlePointerDown(e) {
    if (!natural || e.button !== 0) return;
    rootRef.current?.focus();
    const p = pointFromEvent(e);

    if (tool === "brush") {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrawing({ id: newStrokeId(), tool: "brush", color, width, points: [p], visible: true });
      return;
    }

    const ratio = pxRatio();
    if (penPoints.length >= 3 && dist(p, penPoints[0]) < 10 * ratio) {
      finishPen(true);
      return;
    }
    // the second click of a double-click lands on the same spot — ignore it
    if (penPoints.length && dist(p, penPoints[penPoints.length - 1]) < 3 * ratio) return;
    setPenPoints((pts) => [...pts, p]);
  }

  function handlePointerMove(e) {
    if (!natural) return;
    const p = pointFromEvent(e);
    setHover(p);
    if (tool === "pen") setNearStart(penPoints.length >= 3 && dist(p, penPoints[0]) < 10 * pxRatio());
    if (drawing) {
      setDrawing((d) => {
        const last = d.points[d.points.length - 1];
        return last.x === p.x && last.y === p.y ? d : { ...d, points: [...d.points, p] };
      });
    }
  }

  function handlePointerUp() {
    if (!drawing) return;
    commit(drawing);
    setDrawing(null);
  }

  function undo() {
    if (penPoints.length) {
      setPenPoints((pts) => pts.slice(0, -1));
      return;
    }
    if (!undoStack.length) return;
    setRedoStack((s) => [...s, strokes]);
    setStrokes(undoStack[undoStack.length - 1]);
    setUndoStack((s) => s.slice(0, -1));
  }

  function redo() {
    if (!redoStack.length) return;
    setUndoStack((s) => [...s, strokes]);
    setStrokes(redoStack[redoStack.length - 1]);
    setRedoStack((s) => s.slice(0, -1));
  }

  function clearAll() {
    if (!strokes.length) return;
    setUndoStack((s) => [...s, strokes]);
    setRedoStack([]);
    setStrokes([]);
  }

  function deleteStroke(strokeId) {
    setUndoStack((s) => [...s, strokes]);
    setRedoStack([]);
    setStrokes((s) => s.filter((st) => st.id !== strokeId));
  }

  function toggleVisible(strokeId) {
    setStrokes((s) => s.map((st) => (st.id === strokeId ? { ...st, visible: !st.visible } : st)));
  }

  function handleKeyDown(e) {
    // keep React Flow (an ancestor in the React tree) from seeing these keys
    e.stopPropagation();
    if (isTypingTarget(e.target)) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (mod) return;
    if (e.key === "Enter" && penPoints.length) {
      e.preventDefault();
      finishPen(false);
    } else if (e.key === "Escape" && penPoints.length) {
      setPenPoints([]);
      setNearStart(false);
    } else if (e.key === "Backspace" && penPoints.length) {
      e.preventDefault();
      setPenPoints((pts) => pts.slice(0, -1));
    } else if (e.key.toLowerCase() === "b") {
      chooseTool("brush");
    } else if (e.key.toLowerCase() === "p") {
      chooseTool("pen");
    } else if (e.key === "[") {
      setWidth((w) => Math.max(1, w - 1));
    } else if (e.key === "]") {
      setWidth((w) => Math.min(maxWidth, w + 1));
    }
  }

  async function handleApply() {
    if (!natural) return;
    setSaving(true);
    const finalStrokes = penPoints.length >= 2 ? [...strokes, penStroke(false)] : strokes;
    try {
      const img = await loadImage(baseSrc);
      const canvas = document.createElement("canvas");
      canvas.width = natural.w;
      canvas.height = natural.h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, natural.w, natural.h);
      for (const s of finalStrokes) if (s.visible) traceStroke(ctx, s);
      onApply({ image: canvas.toDataURL("image/png"), strokes: finalStrokes });
    } finally {
      setSaving(false);
    }
  }

  const anchorR = natural ? Math.max(2, natural.w / 250) : 2;
  let brushCount = 0;
  let penCount = 0;

  return createPortal(
    <div className="editcanvas-overlay">
      <div className="editcanvas-modal" ref={rootRef} tabIndex={-1} onKeyDown={handleKeyDown} style={{ outline: "none" }}>
        <div className="editcanvas-header">
          <button className="editcanvas-close" onClick={onCancel} title="Close">
            ✕
          </button>
          <span>Canvas — 그리기</span>
          {natural ? <span className="hint">{natural.w} × {natural.h}px</span> : null}
        </div>

        <div className="editcanvas-body">
          <div className="editcanvas-layers">
            <div className="layers-title">Layers</div>
            <div className="layer-row">
              <span className="layer-swatch" style={{ background: "#555" }} />
              <span className="layer-name">Source image</span>
            </div>
            {strokes.map((s) => (
              <div className="layer-row" key={s.id}>
                <span className="layer-swatch" style={{ background: s.color }} />
                <span className="layer-name">
                  {s.tool === "pen" ? `Pen ${++penCount}${s.closed ? " (closed)" : ""}` : `Brush ${++brushCount}`}
                </span>
                <button className="layer-btn" onClick={() => toggleVisible(s.id)} title="Toggle visibility">
                  {s.visible ? "👁" : "🚫"}
                </button>
                <button className="layer-btn" onClick={() => deleteStroke(s.id)} title="Delete">
                  🗑
                </button>
              </div>
            ))}
          </div>

          <div className="editcanvas-canvas-wrap">
            <div className="editcanvas-toolbar">
              <button className={tool === "brush" ? "active" : ""} onClick={() => chooseTool("brush")} title="Brush (B)">
                🖌
              </button>
              <button className={tool === "pen" ? "active" : ""} onClick={() => chooseTool("pen")} title="Pen (P)">
                ✒
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
              <input
                type="color"
                className="toolbar-color-input"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                title="Custom color"
              />
              <span className="toolbar-sep" />
              <label className="toolbar-width" title="Size ([ / ])">
                <span>{width}px</span>
                <input
                  type="range"
                  min="1"
                  max={maxWidth}
                  value={width}
                  onChange={(e) => setWidth(Number(e.target.value))}
                />
              </label>
              <span className="toolbar-sep" />
              <button onClick={undo} disabled={!undoStack.length && !penPoints.length} title="Undo (⌘Z)">
                ↩
              </button>
              <button onClick={redo} disabled={!redoStack.length} title="Redo (⇧⌘Z)">
                ↪
              </button>
              <button className="toolbar-text-btn" onClick={clearAll} disabled={!strokes.length} title="Clear all">
                Clear
              </button>
              {penPoints.length ? (
                <button
                  className="toolbar-text-btn active"
                  onClick={() => finishPen(false)}
                  disabled={penPoints.length < 2}
                  title="Finish path (Enter)"
                >
                  경로 완료
                </button>
              ) : null}
            </div>

            <div className="editcanvas-stage">
              <div
                ref={stageRef}
                className="editcanvas-canvas"
                style={natural ? { aspectRatio: `${natural.w} / ${natural.h}` } : undefined}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onPointerLeave={() => setHover(null)}
                onDoubleClick={() => tool === "pen" && finishPen(false)}
              >
                <img src={baseSrc} alt="drawing" draggable={false} />
                {natural ? (
                  <svg
                    className="editcanvas-svg"
                    viewBox={`0 0 ${natural.w} ${natural.h}`}
                    preserveAspectRatio="none"
                  >
                    {strokes.filter((s) => s.visible).map((s) => (
                      <StrokeShape key={s.id} s={s} />
                    ))}
                    {drawing ? <StrokeShape s={drawing} /> : null}

                    {penPoints.length ? (
                      <>
                        {penPoints.length > 1 ? (
                          <StrokeShape s={{ color, width, points: penPoints }} />
                        ) : null}
                        {hover ? (
                          <line
                            x1={penPoints[penPoints.length - 1].x}
                            y1={penPoints[penPoints.length - 1].y}
                            x2={nearStart ? penPoints[0].x : hover.x}
                            y2={nearStart ? penPoints[0].y : hover.y}
                            stroke={color}
                            strokeWidth={1.5}
                            strokeDasharray="4 3"
                            vectorEffect="non-scaling-stroke"
                          />
                        ) : null}
                        {penPoints.map((p, i) => (
                          <rect
                            key={i}
                            x={p.x - anchorR}
                            y={p.y - anchorR}
                            width={anchorR * 2}
                            height={anchorR * 2}
                            fill={i === 0 && nearStart ? color : "#fff"}
                            stroke="#000"
                            strokeWidth={1}
                            vectorEffect="non-scaling-stroke"
                          />
                        ))}
                      </>
                    ) : null}

                    {tool === "brush" && hover && !drawing ? (
                      <circle
                        cx={hover.x}
                        cy={hover.y}
                        r={width / 2}
                        fill="none"
                        stroke="#fff"
                        strokeWidth={1}
                        vectorEffect="non-scaling-stroke"
                      />
                    ) : null}
                  </svg>
                ) : null}
              </div>
            </div>
          </div>

          <div className="editcanvas-side">
            <label>도구</label>
            <div className="hint" style={{ lineHeight: 1.7 }}>
              <b>🖌 브러쉬 (B)</b> — 드래그해서 자유롭게 그리기
              <br />
              <b>✒ 펜 (P)</b> — 클릭할 때마다 점을 찍어 직선 경로를 만듭니다. 더블클릭이나 Enter로 완료, 첫
              점을 다시 클릭하면 닫힌 도형이 됩니다. Backspace로 마지막 점 삭제, Esc로 취소.
              <br />
              <b>[ / ]</b> — 크기 조절 · <b>⌘Z / ⇧⌘Z</b> — 실행 취소 / 다시 실행
            </div>

            <div className="editcanvas-side-actions">
              <button className="btn secondary" onClick={onCancel}>
                Cancel
              </button>
              <button className="btn" onClick={handleApply} disabled={saving || !natural}>
                {saving ? "Saving..." : "Apply"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
