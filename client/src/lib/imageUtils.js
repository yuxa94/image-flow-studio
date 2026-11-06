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

// layers: [{ dataUrl, opacity, rect? }]. `rect` ({ xPct, yPct, wPct, hPct }, all
// 0..1) is the region of the base canvas this layer represents, e.g. a crop
// that was edited elsewhere and needs to go back into the exact spot it came
// from. A layer without `rect` is treated as a full-canvas layer; the first
// such layer sets the output canvas size, so connecting the original image
// into one slot and a positioned patch into another pastes the patch back in
// place instead of stretching it across the whole image.
export async function mergeImages(layers) {
  const loaded = await Promise.all(
    layers
      .filter((l) => l.dataUrl)
      .map(async (l) => ({ img: await loadImage(l.dataUrl), opacity: l.opacity ?? 1, rect: l.rect || null }))
  );
  if (!loaded.length) return null;

  const base = loaded.find((l) => !l.rect) || loaded[0];
  const width = base.img.width;
  const height = base.img.height;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  for (const { img, opacity, rect } of loaded) {
    ctx.globalAlpha = opacity;
    if (rect) {
      ctx.drawImage(img, rect.xPct * width, rect.yPct * height, rect.wPct * width, rect.hPct * height);
    } else {
      ctx.drawImage(img, 0, 0, width, height);
    }
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
