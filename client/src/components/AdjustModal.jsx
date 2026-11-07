import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { adjustImage, DEFAULT_ADJUSTMENTS, isNeutralAdjustment } from "../lib/imageUtils.js";
import AdjustControls from "./AdjustControls.jsx";

const STAGE_MAX_SIDE = 1600;

// Enlarged Adjust workspace: big live preview on the left, the same sliders
// on the right. Edits go straight to the node (so the node and downstream
// update as you drag); "취소" restores the settings the modal opened with.
export default function AdjustModal({ input, adjustments, onChange, onClose }) {
  const adj = { ...DEFAULT_ADJUSTMENTS, ...(adjustments || {}) };
  const adjKey = JSON.stringify(adj);
  const initialRef = useRef(adj);
  const rootRef = useRef(null);
  const seqRef = useRef(0);
  const [rendered, setRendered] = useState(null);
  const [showOriginal, setShowOriginal] = useState(false);

  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  useEffect(() => {
    const seq = ++seqRef.current;
    if (!input || isNeutralAdjustment(adj)) {
      setRendered(null);
      return;
    }
    adjustImage(input, adj, STAGE_MAX_SIDE)
      .then((img) => { if (seq === seqRef.current) setRendered(img); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, adjKey]);

  function handleKeyDown(e) {
    // Keep keys from reaching React Flow (which would move/delete the node).
    e.stopPropagation();
    if (e.key === "Escape") onClose();
  }

  function cancel() {
    onChange({ ...initialRef.current });
    onClose();
  }

  const shown = showOriginal || !rendered ? input : rendered;

  return createPortal(
    <div className="editcanvas-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="editcanvas-modal adjust-modal"
        ref={rootRef}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        style={{ outline: "none" }}
      >
        <div className="editcanvas-header">
          <span>Adjust</span>
          <span className="adjust-modal-hint">{showOriginal ? "원본 보는 중" : "조절 결과"}</span>
          <span style={{ flex: 1 }} />
          <button className="editcanvas-close" onClick={onClose} title="닫기 (Esc)">✕</button>
        </div>
        <div className="adjust-modal-body">
          <div className="editcanvas-canvas-wrap">
            <div className="editcanvas-stage">
              {shown ? <img className="adjust-modal-image" src={shown} alt="adjust preview" /> : null}
            </div>
          </div>
          <div className="editcanvas-side">
            <AdjustControls adj={adj} onChange={(patch) => onChange({ ...adj, ...patch })} disabled={!input} />
            <button
              type="button"
              className="btn secondary"
              onMouseDown={() => setShowOriginal(true)}
              onMouseUp={() => setShowOriginal(false)}
              onMouseLeave={() => setShowOriginal(false)}
              onTouchStart={() => setShowOriginal(true)}
              onTouchEnd={() => setShowOriginal(false)}
              disabled={!input || isNeutralAdjustment(adj)}
            >
              👁 누르고 있으면 원본 보기
            </button>
            <div className="editcanvas-side-actions">
              <button
                className="btn secondary"
                onClick={() => onChange({ ...DEFAULT_ADJUSTMENTS })}
                disabled={isNeutralAdjustment(adj)}
              >
                ↺ Reset
              </button>
              <button className="btn secondary" onClick={cancel}>취소</button>
              <button className="btn" onClick={onClose}>완료</button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
