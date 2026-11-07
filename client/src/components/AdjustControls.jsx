// Slider/toggle panel shared by the Adjust node and its enlarged modal.
export const ADJUST_GROUPS = [
  {
    title: "Light",
    sliders: [
      { key: "exposure", label: "노출 Exposure", min: -3, max: 3, step: 0.05 },
      { key: "brightness", label: "밝기 Brightness", min: -100, max: 100, step: 1 },
      { key: "contrast", label: "대비 Contrast", min: -100, max: 100, step: 1 },
      { key: "highlights", label: "하이라이트 Highlights", min: -100, max: 100, step: 1 },
      { key: "shadows", label: "섀도 Shadows", min: -100, max: 100, step: 1 },
    ],
  },
  {
    title: "Color",
    sliders: [
      { key: "saturation", label: "채도 Saturation", min: -100, max: 100, step: 1 },
      { key: "vibrance", label: "생동감 Vibrance", min: -100, max: 100, step: 1 },
      { key: "hue", label: "색조 Hue", min: -180, max: 180, step: 1 },
      { key: "temperature", label: "색온도 Temperature", min: -100, max: 100, step: 1 },
      { key: "tint", label: "틴트 Tint", min: -100, max: 100, step: 1 },
    ],
  },
];

function formatValue(key, v) {
  if (key === "exposure") return `${v > 0 ? "+" : ""}${Number(v).toFixed(2)} EV`;
  if (key === "hue") return `${v > 0 ? "+" : ""}${v}°`;
  return `${v > 0 ? "+" : ""}${v}`;
}

export default function AdjustControls({ adj, onChange, disabled = false }) {
  return (
    <>
      {ADJUST_GROUPS.map((group) => (
        <div key={group.title} className="adjust-group">
          <div className="adjust-group-title">{group.title}</div>
          {group.sliders.map((s) => (
            <div key={s.key} className="adjust-slider">
              <div className="adjust-slider-head">
                <span>{s.label}</span>
                <button
                  type="button"
                  className={`adjust-value${adj[s.key] !== 0 ? " changed" : ""}`}
                  title="클릭하면 0으로 되돌립니다"
                  onClick={() => onChange({ [s.key]: 0 })}
                >
                  {formatValue(s.key, adj[s.key])}
                </button>
              </div>
              <input
                type="range"
                min={s.min}
                max={s.max}
                step={s.step}
                value={adj[s.key]}
                disabled={disabled}
                onChange={(e) => onChange({ [s.key]: Number(e.target.value) })}
                onDoubleClick={() => onChange({ [s.key]: 0 })}
              />
            </div>
          ))}
        </div>
      ))}

      <label className="adjust-toggle">
        <input
          type="checkbox"
          checked={adj.invert}
          disabled={disabled}
          onChange={(e) => onChange({ invert: e.target.checked })}
        />
        반전 Invert
      </label>
    </>
  );
}
