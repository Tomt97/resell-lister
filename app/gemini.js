// Google Gemini (free tier) for writing listings. Plain REST calls from the browser with the
// user's own key, kept only on this device. Google renames models often, so the model is picked
// from the list Google returns for the key instead of being hard-coded.
const BASE = "https://generativelanguage.googleapis.com/v1beta";

async function call(path, key, init = {}) {
  let res;
  try {
    res = await fetch(`${BASE}/${path}`, {
      ...init,
      headers: { "x-goog-api-key": key, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    });
  } catch {
    throw new Error("Couldn't reach Google Gemini. Check your internet connection.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(explain(res.status, body?.error));
  return body;
}

function explain(status, error = {}) {
  const reason = (error.details || []).map((d) => d.reason).find(Boolean) || "";
  const msg = error.message || "";
  if (reason === "API_KEY_INVALID" || /api key not valid/i.test(msg)) return "Your Gemini key was rejected. Check it in Settings.";
  if (status === 429) return "Gemini's free limit is used up for now. Wait a minute (or until tomorrow if it's the daily limit) and try again.";
  if (status === 403) return "This Gemini key isn't allowed to do that. Make a new key at aistudio.google.com.";
  if (status === 404) return "That Gemini model isn't available any more. Pick another in Settings.";
  if (status >= 500) return "Gemini is having trouble right now. Try again in a minute.";
  return `Gemini error (${status}): ${msg || "unknown"}`;
}

// Text models that can write listings, best first: newest version, full Flash before Flash-Lite,
// stable before preview. Skips image, audio, embedding and live models.
export async function listModels(key) {
  const body = await call("models?pageSize=1000", key);
  const version = (id) => parseFloat((id.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || "0");
  return (body.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
    .map((m) => ({ id: m.name.replace(/^models\//, ""), label: m.displayName || m.name }))
    .filter((m) => /^gemini-/.test(m.id) && /flash/.test(m.id) && !/image|tts|audio|live|embed|thinking-exp|robotics|computer/.test(m.id))
    .sort((a, b) =>
      version(b.id) - version(a.id)
      || /lite/.test(a.id) - /lite/.test(b.id)
      || /preview|exp/.test(a.id) - /preview|exp/.test(b.id)
      || a.id.localeCompare(b.id));
}

// Gemini's schema format is a subset of JSON Schema: no additionalProperties.
function toGeminiSchema(s) {
  if (Array.isArray(s)) return s.map(toGeminiSchema);
  if (!s || typeof s !== "object") return s;
  const out = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === "additionalProperties") continue;
    // Google's own examples write types in capitals ("STRING", "OBJECT").
    if (k === "type" && typeof v === "string") { out.type = v.toUpperCase(); continue; }
    out[k] = k === "properties" ? Object.fromEntries(Object.entries(v).map(([p, ps]) => [p, toGeminiSchema(ps)])) : toGeminiSchema(v);
  }
  return out;
}

export async function generateJson({ key, model, system, userText, images, schema }) {
  const body = await call(`models/${encodeURIComponent(model)}:generateContent`, key, {
    method: "POST",
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{
        role: "user",
        parts: [
          ...images.map(({ mimeType, data }) => ({ inlineData: { mimeType, data } })),
          { text: userText },
        ],
      }],
      generationConfig: { responseMimeType: "application/json", responseSchema: toGeminiSchema(schema), maxOutputTokens: 8192 },
    }),
  });
  if (body.promptFeedback?.blockReason) throw new Error("Gemini declined to describe this item. Try different photos or add notes.");
  const cand = body.candidates?.[0];
  if (!cand) throw new Error("Gemini returned no listing. Please try again.");
  if (cand.finishReason === "SAFETY" || cand.finishReason === "PROHIBITED_CONTENT") throw new Error("Gemini declined to describe this item. Try different photos or add notes.");
  if (cand.finishReason === "MAX_TOKENS") throw new Error("Gemini's answer was cut off. Please try again.");
  const text = (cand.content?.parts || []).map((p) => p.text || "").join("");
  if (!text) throw new Error("Gemini returned no listing. Please try again.");
  try { return JSON.parse(text); }
  catch { throw new Error("Gemini's answer wasn't in the expected format. Please try again."); }
}
