import "dotenv/config";
import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const OPENAI_BASE = "https://api.openai.com/v1";

const ROLE_LABELS = {
  base: "Base image",
  reference: "Reference image",
};

// gpt-image-1 only accepts three fixed non-auto sizes; pick whichever is
// closest in aspect ratio to what the app's Ratio dropdown asked for.
const OPENAI_LEGACY_SIZES = [
  { size: "1024x1024", ratio: 1 },
  { size: "1536x1024", ratio: 1536 / 1024 },
  { size: "1024x1536", ratio: 1024 / 1536 },
];

// gpt-image-2+ (including 2.5 flare/sunburst) takes a free-form
// WIDTHxHEIGHT instead, as long as both edges are multiples of 16, each
// edge is <=3840px, the long/short ratio is <=3:1, and total pixels fall
// within [655360, 8294400]. Targeting a fixed ~2MP area keeps every ratio
// (the app's Ratio dropdown is "W:H") comfortably inside those bounds.
const OPENAI_TARGET_AREA = 2_000_000;

function round16(n) {
  return Math.max(16, Math.round(n / 16) * 16);
}

function parseRatio(ratio) {
  if (!ratio || ratio === "AUTO") return null;
  const [w, h] = ratio.split(":").map(Number);
  if (!w || !h) return null;
  return w / h;
}

function legacyOpenAISize(ratio) {
  const target = parseRatio(ratio);
  if (!target) return "auto";
  let best = OPENAI_LEGACY_SIZES[0];
  let bestDiff = Infinity;
  for (const opt of OPENAI_LEGACY_SIZES) {
    const diff = Math.abs(Math.log(opt.ratio / target));
    if (diff < bestDiff) {
      bestDiff = diff;
      best = opt;
    }
  }
  return best.size;
}

function customOpenAISize(ratio) {
  const target = parseRatio(ratio);
  if (!target) return "auto";
  const width = Math.min(3840, round16(Math.sqrt(OPENAI_TARGET_AREA * target)));
  const height = Math.min(3840, round16(Math.sqrt(OPENAI_TARGET_AREA / target)));
  return `${width}x${height}`;
}

const OPENAI_QUALITY_BY_RESOLUTION = {
  AUTO: "auto",
  "1K": "low",
  "2K": "medium",
  "4K": "high",
};

function isLegacyOpenAIModel(model) {
  return /^gpt-image-1(\b|[-_]|$)/i.test(model || "");
}

async function handleGemini(req, res) {
  const { model, prompt, images = [], ratio, resolution } = req.body || {};
  // A key typed into Settings (client) wins; otherwise fall back to the
  // server's own .env so the app can be used without pasting a key each run.
  const apiKey = req.body?.apiKey || process.env.GEMINI_API_KEY;

  if (!apiKey) return res.status(400).json({ error: "Missing API key" });
  if (!model) return res.status(400).json({ error: "Missing model name" });

  // The prompt sent to the model is exactly what the user typed — no
  // hardcoded text is appended to it. Ratio/resolution are passed as
  // structured generationConfig fields instead. Each image gets its own
  // small label part (e.g. "Base image:") so the model can tell base and
  // reference images apart — the inlineData part itself has no filename.
  const parts = [{ text: prompt || "" }];
  for (const img of images) {
    if (img?.data && img?.mimeType) {
      if (img.role && ROLE_LABELS[img.role]) {
        parts.push({ text: `${ROLE_LABELS[img.role]}:` });
      }
      parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
    }
  }

  const generationConfig = { responseModalities: ["IMAGE", "TEXT"] };
  const imageConfig = {};
  if (ratio && ratio !== "AUTO") imageConfig.aspectRatio = ratio;
  if (resolution && resolution !== "AUTO") imageConfig.imageSize = resolution;
  if (Object.keys(imageConfig).length) generationConfig.imageConfig = imageConfig;

  const url = `${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  try {
    const geminiRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig,
      }),
    });

    const json = await geminiRes.json();

    if (!geminiRes.ok) {
      return res.status(geminiRes.status).json({ error: json?.error?.message || "Gemini API error", details: json });
    }

    const candidateParts = json?.candidates?.[0]?.content?.parts || [];
    const imagePart = candidateParts.find((p) => p.inlineData?.data);
    const textPart = candidateParts.find((p) => p.text)?.text;

    if (!imagePart) {
      return res.status(502).json({ error: "Model did not return an image", text: textPart, details: json });
    }

    return res.json({
      image: `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`,
      text: textPart || null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Request failed" });
  }
}

async function handleOpenAI(req, res) {
  const { model, prompt, images = [], ratio, resolution } = req.body || {};
  const apiKey = req.body?.apiKey || process.env.OPENAI_API_KEY;

  if (!apiKey) return res.status(400).json({ error: "Missing API key" });
  if (!model) return res.status(400).json({ error: "Missing model name" });

  const size = isLegacyOpenAIModel(model) ? legacyOpenAISize(ratio) : customOpenAISize(ratio);
  const quality = OPENAI_QUALITY_BY_RESOLUTION[resolution] || "auto";
  const usableImages = images.filter((img) => img?.data && img?.mimeType);

  // gpt-image models have no per-image role labels like Gemini — when
  // there's more than one input image, say in plain text which one is which
  // so ordering (base first, reference after) still carries meaning.
  let promptText = prompt || "";
  if (usableImages.length > 1) {
    promptText += "\n\n(The first image is the base to edit; the following image(s) are reference only.)";
  }

  try {
    let openaiRes;
    if (usableImages.length === 0) {
      openaiRes = await fetch(`${OPENAI_BASE}/images/generations`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, prompt: promptText, size, quality, n: 1 }),
      });
    } else {
      const form = new FormData();
      form.append("model", model);
      form.append("prompt", promptText);
      form.append("size", size);
      form.append("quality", quality);
      for (const img of usableImages) {
        const ext = img.mimeType.split("/")[1] || "png";
        const blob = new Blob([Buffer.from(img.data, "base64")], { type: img.mimeType });
        form.append("image[]", blob, `image.${ext}`);
      }
      openaiRes = await fetch(`${OPENAI_BASE}/images/edits`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });
    }

    const json = await openaiRes.json();

    if (!openaiRes.ok) {
      return res.status(openaiRes.status).json({ error: json?.error?.message || "OpenAI API error", details: json });
    }

    const b64 = json?.data?.[0]?.b64_json;
    if (!b64) {
      return res.status(502).json({ error: "Model did not return an image", details: json });
    }

    return res.json({ image: `data:image/png;base64,${b64}`, text: null });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Request failed" });
  }
}

// Body: { provider?, apiKey, model, prompt, images: [{ data (base64, no prefix), mimeType, role? }], ratio, resolution }
app.post("/api/generate", async (req, res) => {
  const provider = req.body?.provider || "gemini";
  if (provider === "openai") return handleOpenAI(req, res);
  return handleGemini(req, res);
});

// Proxies VWorld's address search/geocoding API so the browser doesn't hit
// CORS issues calling api.vworld.kr directly, and the key stays server-side.
app.get("/api/vworld/search", async (req, res) => {
  const apiKey = process.env.VWORLD_API_KEY;
  if (!apiKey) return res.status(400).json({ error: "VWORLD_API_KEY is not set in server/.env" });

  const query = req.query.query;
  if (!query) return res.status(400).json({ error: "Missing query" });

  const type = req.query.type === "place" ? "place" : "address";
  const url = new URL("https://api.vworld.kr/req/search");
  url.searchParams.set("service", "search");
  url.searchParams.set("request", "search");
  url.searchParams.set("version", "2.0");
  url.searchParams.set("crs", "EPSG:4326");
  url.searchParams.set("size", "10");
  url.searchParams.set("page", "1");
  url.searchParams.set("query", query);
  url.searchParams.set("type", type);
  if (type === "address") url.searchParams.set("category", "road");
  url.searchParams.set("format", "json");
  url.searchParams.set("errorformat", "json");
  url.searchParams.set("key", apiKey);

  try {
    const vworldRes = await fetch(url.toString());
    const json = await vworldRes.json();
    return res.json(json);
  } catch (err) {
    return res.status(500).json({ error: err.message || "VWorld search request failed" });
  }
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`[server] listening on http://localhost:${PORT}`));
