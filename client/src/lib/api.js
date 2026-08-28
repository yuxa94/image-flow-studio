export async function generateImage({ apiKey, model, prompt, images, ratio, resolution }) {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey, model, prompt, images, ratio, resolution }),
  });

  const json = await res.json();
  if (!res.ok) {
    const msg = json?.error || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return json; // { image, text }
}
