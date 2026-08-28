import { useState } from "react";
import { useStore } from "./lib/store.js";

export default function SettingsPanel() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const [open, setOpen] = useState(false);

  return (
    <>
      {open ? (
        <div className="settings-panel">
          <h3>Settings</h3>
          <label>Gemini API key</label>
          <input
            className="node-input"
            type="password"
            placeholder="Paste your API key"
            value={settings.apiKey}
            onChange={(e) => setSettings({ apiKey: e.target.value })}
          />
          <label>Model</label>
          <input
            className="node-input"
            type="text"
            placeholder="gemini-3-pro-image-preview"
            value={settings.model}
            onChange={(e) => setSettings({ model: e.target.value })}
          />
          <div className="hint">
            Stored only in this browser's local storage. Never sent anywhere except your local
            server, which forwards it to Google's API.
          </div>
        </div>
      ) : null}
      <button className="settings-fab" onClick={() => setOpen((v) => !v)}>
        ⚙ Settings
      </button>
    </>
  );
}
