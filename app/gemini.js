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
  if (!res.ok) {
    const err = new Error(explain(res.status, body?.error));
    err.status = res.status;
    err.googleMessage = body?.error?.message || "";
    throw err;
  }
  return body;
}

function explain(status, error = {}) {
  const reason = (error.details || []).map((d) => d.reason).find(Boolean) || "";
  const msg = error.message || "";
  if (reason === "API_KEY_INVALID" || /api key not valid/i.test(msg)) return "Your Gemini key was rejected. Check it in Settings.";
  if (status === 429) return "Gemini's free limit is used up for now. Wait a minute (or until tomorrow if it's the daily limit) and try again.";
  if (status === 403) return "This Gemini key isn't allowed to do that. Make a new key at aistudio.google.com.";
  if (status === 404) return "That Gemini model isn't available any more. Pick another in Settings.";
  if (status >= 500) return `Gemini is having trouble right now. Try again in a minute.${msg ? ` (Google said: ${msg.slice(0, 160)})` : ""}`;
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

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// One request. withSchema: ask Gemini to enforce the answer format; without it, the format is
// described in the prompt instead (a fallback, because very detailed formats can make Gemini fail).
async function requestOnce({ key, model, system, userText, images, schema, withSchema }) {
  const text = withSchema ? userText
    : `${userText}\n\nReply with only a JSON object that matches this JSON Schema exactly (same keys, no extra text):\n${JSON.stringify(schema)}`;
  const body = await call(`models/${encodeURIComponent(model)}:generateContent`, key, {
    method: "POST",
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{
        role: "user",
        parts: [
          ...images.map(({ mimeType, data }) => ({ inlineData: { mimeType, data } })),
          { text },
        ],
      }],
      // Newer Flash models think before answering, and that counts toward the output limit.
      generationConfig: { responseMimeType: "application/json", ...(withSchema ? { responseSchema: toGeminiSchema(schema) } : {}), maxOutputTokens: 32768 },
    }),
  });
  if (body.promptFeedback?.blockReason) throw new Error("Gemini declined to describe this item. Try different photos or add notes.");
  const cand = body.candidates?.[0];
  if (!cand) throw new Error("Gemini returned no listing. Please try again.");
  if (cand.finishReason === "SAFETY" || cand.finishReason === "PROHIBITED_CONTENT") throw new Error("Gemini declined to describe this item. Try different photos or add notes.");
  if (cand.finishReason === "MAX_TOKENS") throw new Error("Gemini's answer was cut off. Please try again.");
  const out = (cand.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || "").join("").trim();
  if (!out) throw new Error("Gemini returned no listing. Please try again.");
  // Without enforced formatting the JSON can come wrapped in ``` fences.
  const json = out.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(json); }
  catch { const e = new Error("Gemini's answer wasn't in the expected format. Please try again."); e.retryable = true; throw e; }
}

// Tries, in order: the chosen model with enforced formatting, the same model with the format in the
// prompt, then up to two other models. Moves on only after server trouble, a retired model or a
// garbled answer; a bad key, the free limit or a blocked item stops straight away.
export async function generateJson({ key, model, system, userText, images, schema, fallbackModels = [] }) {
  const attempts = [
    { model, withSchema: true },
    { model, withSchema: false },
    ...fallbackModels.filter((m) => m && m !== model).slice(0, 2).map((m) => ({ model: m, withSchema: false })),
  ];
  let last;
  for (const [i, a] of attempts.entries()) {
    try {
      return await requestOnce({ key, system, userText, images, schema, ...a });
    } catch (err) {
      last = err;
      const moveOn = err.status >= 500 || err.status === 404 || err.retryable;
      if (!moveOn) throw err;
      if (i < attempts.length - 1 && err.status >= 500) await wait(1500);
    }
  }
  throw last;
}
