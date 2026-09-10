// Shared aspect-ratio presets used by both the Imagine node (as generation
// hints) and the Crop modal (as hard crop constraints), so the two stay
// in sync.
export const ASPECT_RATIOS = [
  { label: "1:1", value: 1 / 1 },
  { label: "2:3", value: 2 / 3 },
  { label: "3:2", value: 3 / 2 },
  { label: "3:4", value: 3 / 4 },
  { label: "4:3", value: 4 / 3 },
  { label: "4:5", value: 4 / 5 },
  { label: "5:4", value: 5 / 4 },
  { label: "9:16", value: 9 / 16 },
  { label: "16:9", value: 16 / 9 },
  { label: "21:9", value: 21 / 9 },
];

export const ASPECT_RATIO_LABELS = ASPECT_RATIOS.map((r) => r.label);

// Percent coordinates relative to the actual map viewport, not a square.
export function fitCaptureRect(ratio, width, height) {
  if (!ratio || width <= 0 || height <= 0) return { xPct: 0, yPct: 0, wPct: 1, hPct: 1 };
  const w = Math.min(width, height * ratio);
  const h = w / ratio;
  return { xPct: (width - w) / 2 / width, yPct: (height - h) / 2 / height, wPct: w / width, hPct: h / height };
}
