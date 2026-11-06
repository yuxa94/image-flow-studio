import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { loadNaturalSize } from "../lib/imageUtils.js";

const FULL = { xPct: 0, yPct: 0, wPct: 1, hPct: 1 };
const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

// Same placement math as mergeImages, as fractions of the base canvas, so
// what's shown here is exactly what Apply will composite.
function boxOf(layer, base) {
  const r = layer.rect || FULL;
  return {
    left: r.xPct + layer.offsetX / base.w,
    top: r.yPct + layer.offsetY / base.h,
    width: r.wPct,
    height: r.hPct,
  };
}

function isTypingTarget(el) {
  return el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");
}

// layers: [{ field, opacityField, label, src, rect, offsetX, offsetY, opacity }], bottom → top
export default function MergeWorkspaceModal({ layers: initialLayers, onCancel, onApply }) {
  const baseLayer = initialLayers.find((l) => !l.rect) || initialLayers[0];
  // The base is locked by default (like Photoshop's Background layer) so a
  // stray click outside the patch can't drag the whole original around.
  const [layers, setLayers] = useState(() =>
    initialLayers.map((l) => ({ ...l, locked: l.field === baseLayer.field }))
  );
  const [selected, setSelected] = useState(
    () => (initialLayers.find((l) => l.rect) || initialLayers[initialLayers.length - 1]).field
  );
  const [base, setBase] = useState(null);
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const dragRef = useRef(null);

  useEffect(() => {
    let alive = true;
    loadNaturalSize(baseLayer.src).then((size) => alive && setBase(size));
    rootRef.current?.focus();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = layers.find((l) => l.field === selected);

  function updateLayer(field, patch) {
    setLayers((ls) => ls.map((l) => (l.field === field ? { ...l, ...patch } : l)));
  }

  function handleKeyDown(e) {
    // Portal events still bubble through the React tree to the React Flow
    // node, whose own arrow-key handler would otherwise move the node itself.
    e.stopPropagation();
    if (isTypingTarget(e.target)) return;
    const dir = ARROWS[e.key];
    if (!dir || !current || current.locked) return;
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    setLayers((ls) =>
      ls.map((l) =>
        l.field === selected ? { ...l, offsetX: l.offsetX + dir[0] * step, offsetY: l.offsetY + dir[1] * step } : l
      )
    );
  }

  function handlePointerDown(e) {
    if (!base || e.button !== 0) return;
    rootRef.current?.focus();
    const box = stageRef.current.getBoundingClientRect();
    const px = (e.clientX - box.left) / box.width;
    const py = (e.clientY - box.top) / box.height;
    const contains = (l) => {
      const b = boxOf(l, base);
      return px >= b.left && px <= b.left + b.width && py >= b.top && py <= b.top + b.height;
    };
    // Keep dragging the selected layer if the click is on it (even if it's
    // underneath another), otherwise pick the topmost unlocked layer hit.
    const target =
      current && !current.locked && contains(current)
        ? current
        : [...layers].reverse().find((l) => !l.locked && contains(l));
    if (!target) return;
    setSelected(target.field);
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      field: target.field,
      x: e.clientX,
      y: e.clientY,
      ox: target.offsetX,
      oy: target.offsetY,
      sx: base.w / box.width,
      sy: base.h / box.height,
    };
  }

  function handlePointerMove(e) {
    const d = dragRef.current;
    if (!d) return;
    updateLayer(d.field, {
      offsetX: d.ox + Math.round((e.clientX - d.x) * d.sx),
      offsetY: d.oy + Math.round((e.clientY - d.y) * d.sy),
    });
  }

  function endDrag() {
    dragRef.current = null;
  }

  const selectionBox = base && current ? boxOf(current, base) : null;

  return createPortal(
    <div className="editcanvas-overlay">
      <div className="editcanvas-modal" ref={rootRef} tabIndex={-1} onKeyDown={handleKeyDown} style={{ outline: "none" }}>
        <div className="editcanvas-header">
          <button className="editcanvas-close" onClick={onCancel} title="Close">
            ✕
          </button>
          <span>Merge — 작업 탭</span>
          {base ? <span className="hint">{base.w} × {base.h}px</span> : null}
        </div>

        <div className="editcanvas-body">
          <div className="editcanvas-layers">
            <div className="layers-title">Layers</div>
            {[...layers].reverse().map((l) => (
              <div
                key={l.field}
                className={`layer-row selectable${l.field === selected ? " active" : ""}`}
                onClick={() => setSelected(l.field)}
              >
                <img className="layer-thumb" src={l.src} alt="" />
                <span className="layer-name">{l.label}</span>
                <button
                  className="layer-btn"
                  title={l.locked ? "잠금 해제" : "잠금"}
                  onClick={(e) => {
                    e.stopPropagation();
                    updateLayer(l.field, { locked: !l.locked });
                  }}
                >
                  {l.locked ? "🔒" : "🔓"}
                </button>
              </div>
            ))}
          </div>

          <div className="editcanvas-canvas-wrap">
            <div className="editcanvas-stage">
              <div
                ref={stageRef}
                className="editcanvas-canvas merge-stage"
                style={base ? { aspectRatio: `${base.w} / ${base.h}` } : undefined}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              >
                <img src={baseLayer.src} alt="" draggable={false} style={{ visibility: "hidden" }} />
                {base
                  ? layers.map((l) => {
                      const b = boxOf(l, base);
                      return (
                        <img
                          key={l.field}
                          src={l.src}
                          alt=""
                          draggable={false}
                          className="merge-stage-layer"
                          style={{
                            left: `${b.left * 100}%`,
                            top: `${b.top * 100}%`,
                            width: `${b.width * 100}%`,
                            height: `${b.height * 100}%`,
                            opacity: l.opacity,
                          }}
                        />
                      );
                    })
                  : null}
                {selectionBox ? (
                  <div
                    className={`merge-stage-selection${current.locked ? " locked" : ""}`}
                    style={{
                      left: `${selectionBox.left * 100}%`,
                      top: `${selectionBox.top * 100}%`,
                      width: `${selectionBox.width * 100}%`,
                      height: `${selectionBox.height * 100}%`,
                    }}
                  />
                ) : null}
              </div>
            </div>
          </div>

          <div className="editcanvas-side">
            {current ? (
              <>
                <label>선택된 레이어</label>
                <div className="hint">
                  {current.label}
                  {current.locked ? " · 🔒 잠김" : ""}
                </div>
                <div className="row">
                  <div>
                    <label>X (px)</label>
                    <input
                      className="node-input"
                      type="number"
                      value={current.offsetX}
                      disabled={current.locked}
                      onChange={(e) => updateLayer(current.field, { offsetX: Math.round(Number(e.target.value) || 0) })}
                    />
                  </div>
                  <div>
                    <label>Y (px)</label>
                    <input
                      className="node-input"
                      type="number"
                      value={current.offsetY}
                      disabled={current.locked}
                      onChange={(e) => updateLayer(current.field, { offsetY: Math.round(Number(e.target.value) || 0) })}
                    />
                  </div>
                </div>
                <label>Opacity {Math.round(current.opacity * 100)}%</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={current.opacity}
                  onChange={(e) => updateLayer(current.field, { opacity: Number(e.target.value) })}
                />
                <button
                  className="btn secondary"
                  disabled={current.locked || (!current.offsetX && !current.offsetY)}
                  onClick={() => updateLayer(current.field, { offsetX: 0, offsetY: 0 })}
                >
                  위치 초기화
                </button>
              </>
            ) : null}

            <div className="hint" style={{ lineHeight: 1.6 }}>
              레이어를 클릭해 선택하고 드래그하거나 방향키(1px) / Shift+방향키(10px)로 이동하세요. 원본
              레이어는 기본으로 잠겨 있어요 — 🔒를 누르면 풀립니다. 투명도를 낮추면 아래 레이어와 비교하며
              맞추기 쉬워요.
            </div>

            <div className="editcanvas-side-actions">
              <button className="btn secondary" onClick={onCancel}>
                Cancel
              </button>
              <button className="btn" onClick={() => onApply(layers)}>
                Apply
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
