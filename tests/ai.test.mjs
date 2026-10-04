// Quick checks on the Gemini client and the listing writer, with Google's replies simulated.
import { listModels, generateJson } from "../app/gemini.js";
import { writeListings, LISTING_SCHEMA } from "../app/ai.js";

let fails = 0;
const check = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? " -> " + extra : ""}`); if (!cond) fails++; };
const reply = (status, body) => (globalThis.fetch = async (url, init) => { globalThis.LAST = { url, init }; return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); });
const errorOf = async (p) => { try { await p; return ""; } catch (e) { return e.message; } };
const args = { key: "k", model: "gemini-x", system: "s", userText: "u", images: [{ mimeType: "image/jpeg", data: "AAA" }], schema: LISTING_SCHEMA };

reply(200, { models: [
  { name: "models/gemini-2.0-flash", displayName: "2.0 Flash", supportedGenerationMethods: ["generateContent"] },
  { name: "models/gemini-3.5-flash-preview", displayName: "3.5 Flash Preview", supportedGenerationMethods: ["generateContent"] },
  { name: "models/gemini-3.5-flash", displayName: "3.5 Flash", supportedGenerationMethods: ["generateContent"] },
  { name: "models/gemini-3.5-flash-lite", displayName: "3.5 Flash-Lite", supportedGenerationMethods: ["generateContent"] },
  { name: "models/gemini-3.5-flash-tts", displayName: "TTS", supportedGenerationMethods: ["generateContent"] },
  { name: "models/gemini-3.5-pro", displayName: "Pro", supportedGenerationMethods: ["generateContent"] },
  { name: "models/gemini-3.5-flash-live", displayName: "Live", supportedGenerationMethods: ["bidiGenerateContent"] },
] });
const ids = (await listModels("k")).map((m) => m.id);
check("model order: stable full Flash, preview, Lite, older", ids.join(",") === "gemini-3.5-flash,gemini-3.5-flash-preview,gemini-3.5-flash-lite,gemini-2.0-flash", ids.join(","));
check("key sent in header, not URL", LAST.init.headers["x-goog-api-key"] === "k" && !LAST.url.includes("key="));

reply(400, { error: { code: 400, message: "API key not valid. Please pass a valid API key.", details: [{ reason: "API_KEY_INVALID" }] } });
check("bad key message", (await errorOf(listModels("bad"))).includes("Gemini key was rejected"));
reply(429, { error: { code: 429, message: "Resource has been exhausted" } });
check("free limit message", (await errorOf(generateJson(args))).includes("free limit is used up"));
reply(404, { error: { code: 404, message: "models/gemini-x is not found" } });
check("retired model message", (await errorOf(generateJson(args))).includes("Pick another in Settings"));
reply(200, { promptFeedback: { blockReason: "SAFETY" } });
check("blocked prompt message", (await errorOf(generateJson(args))).includes("declined"));
reply(200, { candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "{" }] } }] });
check("cut-off answer message", (await errorOf(generateJson(args))).includes("cut off"));
reply(200, { candidates: [{ finishReason: "STOP", content: { parts: [{ text: "not json" }] } }] });
check("non-JSON answer message", (await errorOf(generateJson(args))).includes("expected format"));

// A partial answer is filled out so the form never breaks.
reply(200, { candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ overview: { title: "Levi's 501", condition: "Weird" }, pricing: { suggested_price: "28" } }) }] } }] });
const ai = await writeListings({ provider: "gemini", geminiKey: "k", geminiModel: "gemini-x", photos: [{ dataUrl: "data:image/jpeg;base64,AAA" }], price: "25", notes: "", packaging: ["Poly mailer"] });
check("partial answer: title kept", ai.overview.title === "Levi's 501");
check("partial answer: unknown condition blanked", ai.overview.condition === "");
check("partial answer: missing sections filled", ai.ebay.title === "" && Array.isArray(ai.ebay.item_specifics) && ai.vinted.colors.length === 0 && ai.shipping.estimated_packed_weight_oz === 0);
check("partial answer: number text becomes a number", ai.pricing.suggested_price === 28);
const sent = JSON.parse(LAST.init.body);
check("request: image + text parts, schema without additionalProperties", sent.contents[0].parts[0].inlineData.mimeType === "image/jpeg" && sent.contents[0].parts[1].text.includes("Poly mailer") && !JSON.stringify(sent).includes("additionalProperties"));
check("request: enum kept, types in capitals", sent.generationConfig.responseSchema.properties.vinted.properties.condition.enum.includes("Very good") && sent.generationConfig.responseSchema.properties.overview.type === "OBJECT");

check("missing key message", (await errorOf(writeListings({ provider: "gemini", geminiKey: "", geminiModel: "m", photos: [{ dataUrl: "data:image/jpeg;base64,A" }] }))).includes("Gemini key"));
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
