import { useState } from "react";
import { useStore } from "../lib/store.js";

// Saved-prompt picker for the Imagine node. Clicking a saved prompt replaces
// the node's prompt with it; "현재 프롬프트 저장" adds whatever is typed now.
// The library is shared by every node and kept in localStorage.
export default function PromptLibrary({ currentPrompt, onSelect }) {
  const promptLibrary = useStore((s) => s.promptLibrary);
  const addPrompt = useStore((s) => s.addPrompt);
  const removePrompt = useStore((s) => s.removePrompt);
  const [open, setOpen] = useState(false);

  const trimmed = (currentPrompt || "").trim();
  const alreadySaved = promptLibrary.some((p) => p.text === trimmed);

  return (
    <div className="prompt-library nodrag nowheel">
      <button type="button" className="btn secondary prompt-library-toggle" onClick={() => setOpen((v) => !v)}>
        📚 프롬프트 라이브러리 ({promptLibrary.length}) {open ? "▲" : "▼"}
      </button>

      {open ? (
        <div className="prompt-library-panel">
          {promptLibrary.length === 0 ? (
            <div className="hint">저장된 프롬프트가 없습니다.</div>
          ) : (
            <ul className="prompt-library-list">
              {promptLibrary.map((p) => (
                <li key={p.id} className={p.text === trimmed ? "active" : ""}>
                  <button
                    type="button"
                    className="prompt-library-item"
                    title="클릭하면 프롬프트에 넣습니다"
                    onClick={() => {
                      onSelect(p.text);
                      setOpen(false);
                    }}
                  >
                    {p.text}
                  </button>
                  <button
                    type="button"
                    className="prompt-library-delete"
                    title="라이브러리에서 삭제"
                    onClick={() => removePrompt(p.id)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className="btn secondary prompt-library-save"
            disabled={!trimmed || alreadySaved}
            onClick={() => addPrompt(trimmed)}
          >
            {alreadySaved ? "✓ 이미 저장된 프롬프트" : "＋ 현재 프롬프트 저장"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
