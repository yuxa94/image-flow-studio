export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function dataUrlToRaw(dataUrl) {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl || "");
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

export function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

export function loadNaturalSize(dataUrl) {
  return loadImage(dataUrl)
    .then((img) => ({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 }))
    .catch(() => ({ w: 1, h: 1 }));
}

// crop: { xPct, yPct, wPct, hPct } all 0..1, relative to the source image
export async function cropImage(dataUrl, crop) {
  const img = await loadImage(dataUrl);
  const sx = crop.xPct * img.width;
  const sy = crop.yPct * img.height;
  const sw = crop.wPct * img.width;
  const sh = crop.hPct * img.height;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw));
  canvas.height = Math.max(1, Math.round(sh));
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

// layers: [{ dataUrl, opacity, rect?, offsetX?, offsetY? }]. `rect` ({ xPct,
// yPct, wPct, hPct }, all 0..1) is the region of the base canvas this layer
// represents, e.g. a crop that was edited elsewhere and needs to go back into
// the exact spot it came from. A layer without `rect` is treated as a
// full-canvas layer; the first such layer sets the output canvas size, so
// connecting the original image into one slot and a positioned patch into
// another pastes the patch back in place instead of stretching it across the
// whole image. `offsetX`/`offsetY` (pixels, in the base canvas's own
// resolution) nudge a layer away from its rect to correct for generation
// drift, independent of rect/opacity.
export async function mergeImages(layers) {
  const loaded = await Promise.all(
    layers.filter((l) => l.dataUrl).map(async (l) => ({
      img: await loadImage(l.dataUrl),
      opacity: l.opacity ?? 1,
      rect: l.rect || null,
      offsetX: l.offsetX || 0,
      offsetY: l.offsetY || 0,
    }))
  );
  if (!loaded.length) return null;

  const base = loaded.find((l) => !l.rect) || loaded[0];
  const width = base.img.width;
  const height = base.img.height;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  for (const { img, opacity, rect, offsetX, offsetY } of loaded) {
    ctx.globalAlpha = opacity;
    const dw = rect ? rect.wPct * width : width;
    const dh = rect ? rect.hPct * height : height;
    const dx = (rect ? rect.xPct * width : 0) + offsetX;
    const dy = (rect ? rect.yPct * height : 0) + offsetY;
    ctx.drawImage(img, dx, dy, dw, dh);
  }
  ctx.globalAlpha = 1;
  return canvas.toDataURL("image/png");
}

export async function upscaleImageCanvas(dataUrl, factor = 2) {
  const img = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * factor);
  canvas.height = Math.round(img.height * factor);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

// Photoshop-style color adjustments, applied per pixel on a canvas.
// All params default to 0 (no change); `invert` is a boolean.
//   exposure    -3..3   EV stops (×2^ev in linear-ish space)
//   brightness  -100..100
//   contrast    -100..100
//   highlights  -100..100  (lifts/pulls only the bright tones)
//   shadows     -100..100  (lifts/pulls only the dark tones)
//   saturation  -100..100  (-100 = grayscale)
//   vibrance    -100..100  (saturation weighted toward muted colors)
//   hue         -180..180  degrees
//   temperature -100..100  (+ warmer / − cooler)
//   tint        -100..100  (+ magenta / − green)
export const DEFAULT_ADJUSTMENTS = {
  exposure: 0,
  brightness: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  saturation: 0,
  vibrance: 0,
  hue: 0,
  temperature: 0,
  tint: 0,
  invert: false,
};

export function isNeutralAdjustment(adj) {
  return Object.keys(DEFAULT_ADJUSTMENTS).every((k) => (adj?.[k] ?? DEFAULT_ADJUSTMENTS[k]) === DEFAULT_ADJUSTMENTS[k]);
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// Per-channel tone curve: exposure → brightness → contrast → shadows/highlights.
function buildToneLut(adj) {
  const lut = new Float32Array(256);
  const expMul = Math.pow(2, adj.exposure || 0);
  const bright = (adj.brightness || 0) / 100;
  const k = (adj.contrast || 0) / 100;
  const contrastMul = k >= 0 ? 1 / Math.max(0.01, 1 - k * 0.99) : 1 + k;
  const sh = (adj.shadows || 0) / 100;
  const hl = (adj.highlights || 0) / 100;
  for (let i = 0; i < 256; i++) {
    let v = i / 255;
    // exposure in approximate linear light (gamma 2.2)
    v = Math.pow(clamp01(Math.pow(v, 2.2) * expMul), 1 / 2.2);
    v = v + bright * 0.5 * (bright >= 0 ? 1 - v : v);
    v = (v - 0.5) * contrastMul + 0.5;
    v = clamp01(v);
    const shadowW = (1 - v) * (1 - v);
    const highW = v * v;
    v = v + sh * 0.5 * shadowW + hl * 0.5 * highW;
    lut[i] = clamp01(v);
  }
  return lut;
}

// Standard luminance-preserving hue-rotation matrix (same as CSS hue-rotate).
function hueMatrix(deg) {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [
    0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
    0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283,
    0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072,
  ];
}

export function applyAdjustmentsToPixels(px, adjustments) {
  const adj = { ...DEFAULT_ADJUSTMENTS, ...adjustments };
  const lut = buildToneLut(adj);
  const temp = adj.temperature / 100;
  const tint = adj.tint / 100;
  const rOff = temp * 0.12 + tint * 0.04;
  const gOff = -tint * 0.1;
  const bOff = -temp * 0.12 + tint * 0.04;
  const sat = 1 + adj.saturation / 100;
  const vib = adj.vibrance / 100;
  const doHue = adj.hue !== 0;
  const m = doHue ? hueMatrix(adj.hue) : null;
  const doColor = doHue || sat !== 1 || vib !== 0;
  const inv = !!adj.invert;

  for (let i = 0; i < px.length; i += 4) {
    let r = lut[px[i]] + rOff;
    let g = lut[px[i + 1]] + gOff;
    let b = lut[px[i + 2]] + bOff;

    if (doColor) {
      if (doHue) {
        const nr = m[0] * r + m[1] * g + m[2] * b;
        const ng = m[3] * r + m[4] * g + m[5] * b;
        const nb = m[6] * r + m[7] * g + m[8] * b;
        r = nr; g = ng; b = nb;
      }
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      let s = sat;
      if (vib !== 0) {
        const mx = Math.max(r, g, b);
        const mn = Math.min(r, g, b);
        const curSat = mx - mn; // 0 = gray, 1 = fully saturated
        s *= 1 + vib * (1 - curSat);
      }
      r = lum + (r - lum) * s;
      g = lum + (g - lum) * s;
      b = lum + (b - lum) * s;
    }

    r = clamp01(r); g = clamp01(g); b = clamp01(b);
    if (inv) { r = 1 - r; g = 1 - g; b = 1 - b; }
    px[i] = r * 255;
    px[i + 1] = g * 255;
    px[i + 2] = b * 255;
  }
  return px;
}

export async function adjustImage(dataUrl, adjustments, maxSide = 0) {
  const img = await loadImage(dataUrl);
  let w = img.naturalWidth;
  let h = img.naturalHeight;
  if (maxSide && Math.max(w, h) > maxSide) {
    const s = maxSide / Math.max(w, h);
    w = Math.round(w * s);
    h = Math.round(h * s);
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);
  applyAdjustmentsToPixels(imageData.data, adjustments);
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}
