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

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
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

// layers: [{ dataUrl, opacity }]
export async function mergeImages(layers) {
  const loaded = await Promise.all(
    layers.filter((l) => l.dataUrl).map(async (l) => ({ img: await loadImage(l.dataUrl), opacity: l.opacity ?? 1 }))
  );
  if (!loaded.length) return null;

  const width = Math.max(...loaded.map((l) => l.img.width));
  const height = Math.max(...loaded.map((l) => l.img.height));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  for (const { img, opacity } of loaded) {
    ctx.globalAlpha = opacity;
    ctx.drawImage(img, 0, 0, width, height);
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
