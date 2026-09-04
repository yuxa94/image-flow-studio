import "dotenv/config";
import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

const ROLE_LABELS = {
  base: "Base image",
  reference: "Reference image",
};

// Body: { apiKey, model, prompt, images: [{ data (base64, no prefix), mimeType, role? }], ratio, resolution }
app.post("/api/generate", async (req, res) => {
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

// Proxies VWorld's WMS tile GetMap requests (used for the cadastral map
// overlay) — VWorld's WMS endpoint doesn't send CORS headers, so Cesium's
// own tile fetch (which needs real pixel data for a WebGL texture, unlike
// a plain <img> tag) fails outright when called directly from the browser.
app.get("/api/vworld/wms", async (req, res) => {
  const apiKey = process.env.VWORLD_API_KEY;
  if (!apiKey) return res.status(400).json({ error: "VWORLD_API_KEY is not set in server/.env" });

  const url = new URL("https://api.vworld.kr/req/wms");
  for (const [k, v] of Object.entries(req.query)) url.searchParams.set(k, v);
  url.searchParams.set("key", apiKey);

  try {
    const vworldRes = await fetch(url.toString());
    const buf = Buffer.from(await vworldRes.arrayBuffer());
    res.set("Content-Type", vworldRes.headers.get("content-type") || "image/png");
    return res.send(buf);
  } catch (err) {
    return res.status(500).json({ error: err.message || "VWorld WMS request failed" });
  }
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`[server] listening on http://localhost:${PORT}`));
