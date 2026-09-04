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

app.get("/api/health", (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`[server] listening on http://localhost:${PORT}`));
