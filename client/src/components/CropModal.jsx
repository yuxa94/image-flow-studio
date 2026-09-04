import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { loadNaturalSize } from "../lib/imageUtils.js";
import { ASPECT_RATIOS as RATIOS } from "../lib/ratios.js";

const CORNERS = ["nw", "ne", "sw", "se"];

function centeredRectForRatio(ratio, natural) {
  let cropW = natural.h * ratio;
  let cropH = natural.h;
  if (cropW > natural.w) {
    cropW = natural.w;
    cropH = natural.w / ratio;
  }
  return {
    xPct: (natural.w - cropW) / 2 / natural.w,
    yPct: (natural.h - cropH) / 2 / natural.h,
    wPct: cropW / natural.w,
    hPct: cropH / natural.h,
  };
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

export default function CropModal({ baseSrc, initialRatioLabel, onCancel, onApply }) {
  const [natural, setNatural] = useState({ w: 1, h: 1 });
  const [ratioLabel, setRatioLabel] = useState(initialRatioLabel || "1:1");
  const [rect, setRect] = useState(null);
  const dragRef = useRef(null); // { mode: 'move'|'resize', corner?, startPointer, startRect }
  const containerRef = useRef(null);

  const ratio = RATIOS.find((r) => r.label === ratioLabel)?.value || 1;

  useEffect(() => {
    let alive = true;
    loadNaturalSize(baseSrc).then((size) => {
      if (!alive) return;
      setNatural(size);
      setRect(centeredRectForRatio(ratio, size));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseSrc]);

  function changeRatio(label) {
    setRatioLabel(label);
    const r = RATIOS.find((x) => x.label === label)?.value || 1;
    setRect(centeredRectForRatio(r, natural));
  }

  function pointFromEvent(e) {
    const box = containerRef.current.getBoundingClientRect();
    return {
      x: clamp((e.clientX - box.left) / box.width, 0, 1),
      y: clamp((e.clientY - box.top) / box.height, 0, 1),
    };
  }

  function startMove(e) {
    e.stopPropagation();
    dragRef.current = { mode: "move", startPointer: pointFromEvent(e), startRect: rect };
  }

  function startResize(corner) {
    return (e) => {
      e.stopPropagation();
      const anchor = {
        x: corner.includes("w") ? rect.xPct + rect.wPct : rect.xPct,
        y: corner.includes("n") ? rect.yPct + rect.hPct : rect.yPct,
      };
      dragRef.current = { mode: "resize", corner, anchor };
    };
  }

  function handlePointerMove(e) {
    const drag = dragRef.current;
    if (!drag || !rect) return;
    const p = pointFromEvent(e);

    if (drag.mode === "move") {
      const dx = p.x - drag.startPointer.x;
      const dy = p.y - drag.startPointer.y;
      setRect({
        ...drag.startRect,
        xPct: clamp(drag.startRect.xPct + dx, 0, 1 - drag.startRect.wPct),
        yPct: clamp(drag.startRect.yPct + dy, 0, 1 - drag.startRect.hPct),
      });
      return;
    }

    // resize, anchored at the opposite corner, ratio-locked
    const { anchor, corner } = drag;
    const dirX = corner.includes("w") ? -1 : 1;
    const dirY = corner.includes("n") ? -1 : 1;

    const maxWidthPx = (dirX > 0 ? 1 - anchor.x : anchor.x) * natural.w;
    const maxHeightPx = (dirY > 0 ? 1 - anchor.y : anchor.y) * natural.h;

    let widthPx = Math.abs(p.x - anchor.x) * natural.w;
    let heightPx = widthPx / ratio;

    if (heightPx > maxHeightPx) {
      heightPx = maxHeightPx;
      widthPx = heightPx * ratio;
    }
    if (widthPx > maxWidthPx) {
      widthPx = maxWidthPx;
      heightPx = widthPx / ratio;
    }
    if (widthPx < natural.w * 0.02) return;

    const wPct = widthPx / natural.w;
    const hPct = heightPx / natural.h;

    setRect({
      wPct,
      hPct,
      xPct: dirX > 0 ? anchor.x : anchor.x - wPct,
      yPct: dirY > 0 ? anchor.y : anchor.y - hPct,
    });
  }

  function endDrag() {
    dragRef.current = null;
  }

  function handleApply() {
    if (!rect) return;
    onApply(rect, ratioLabel);
  }

  return createPortal(
    <div className="cropmodal-overlay">
      <div className="cropmodal-modal">
        <div className="cropmodal-header">
          <span>Crop Image</span>
          <button className="editcanvas-close" onClick={onCancel} title="Close">
            ✕
          </button>
        </div>

        <div className="cropmodal-ratios">
          <span className="cropmodal-ratios-label">Ratio</span>
          {RATIOS.map((r) => (
            <button
              key={r.label}
              className={`cropmodal-ratio-btn${ratioLabel === r.label ? " active" : ""}`}
              onClick={() => changeRatio(r.label)}
            >
              {r.label}
            </button>
          ))}
        </div>

        <div className="cropmodal-stage">
          <div
            className="cropmodal-imgwrap"
            ref={containerRef}
            style={{ aspectRatio: `${natural.w} / ${natural.h}` }}
            onPointerMove={handlePointerMove}
            onPointerUp={endDrag}
            onPointerLeave={endDrag}
          >
            <img src={baseSrc} alt="to crop" draggable={false} />
            {rect ? (
              <div
                className="crop-rect"
                onPointerDown={startMove}
                style={{
                  left: `${rect.xPct * 100}%`,
                  top: `${rect.yPct * 100}%`,
                  width: `${rect.wPct * 100}%`,
                  height: `${rect.hPct * 100}%`,
                }}
              >
                {CORNERS.map((c) => (
                  <span
                    key={c}
                    className={`crop-handle crop-handle-${c}`}
                    onPointerDown={startResize(c)}
                  />
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="cropmodal-actions">
          <button className="btn secondary" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn" onClick={handleApply} disabled={!rect}>
            Apply
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
