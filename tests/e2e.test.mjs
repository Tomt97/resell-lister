import { chromium } from "playwright";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, updateDoc, getDoc } from "firebase/firestore";
import { readFileSync } from "fs";

const REPO = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const SHOTS = process.env.SHOTS || "/tmp";
const APP = "http://localhost:8766/app/?emulator=1";
let fails = 0;
const check = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? " -> " + extra : ""}`); if (!cond) fails++; };
const env = await initializeTestEnvironment({ projectId: "demo-resell", firestore: { rules: readFileSync(`${REPO}/firestore.rules`, "utf8"), host: "127.0.0.1", port: 8080 } });

const fakeAi = {
  overview: { title: "Levi's 501 Jeans 32x30 Dark Wash", description: "Classic Levi's 501.\nLight wear on hem.", condition: "Good", category: "Men > Jeans", brand: "Levi's", size: "32x30", colors: ["Blue"], style_tags: ["denim"], material: "Cotton", flaws: ["Light wear on hem"] },
  ebay: { title: "Levi's 501 Original Fit Jeans Mens 32x30 Dark Wash", category_path: "Clothing > Men > Jeans", condition: "Pre-owned - Good", item_specifics: [{ name: "Brand", value: "Levi's" }], description: "Levi's 501." },
  poshmark: { title: "Levi's 501 Jeans 32x30", department: "Men", category: "Jeans", subcategory: "Straight", condition: "Good", colors: ["Blue"], style_tags: ["denim"] },
  vinted: { title: "Levi's 501 jeans", category_path: "Men > Jeans", condition: "Good", colors: ["Blue"] },
  pricing: { suggested_price: 30, quick_sale_price: 22, confidence: "medium", reasoning: "Popular style." },
  check_before_posting: ["Measure the inseam"],
  shipping: { estimated_packed_weight_oz: 24, packaging_name: "Poly mailer 14.5×19", ebay_package_type: "Package (or thick envelope)", vinted_parcel_size: "Medium" },
};

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const errors = [];
async function newUser(label, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  await ctx.route("**/app/config.js", (r) => r.fulfill({ contentType: "text/javascript", body: `export const firebaseConfig = { apiKey: "demo-key", authDomain: "demo-resell.firebaseapp.com", projectId: "demo-resell", storageBucket: "", messagingSenderId: "1", appId: "1:1:web:1" };` }));
  // Stand-in for Google Gemini: a model list and a structured-JSON answer. Requests are kept for checks.
  await ctx.route("https://generativelanguage.googleapis.com/**", async (r) => {
    const url = r.request().url();
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
    if (r.request().method() === "OPTIONS") return r.fulfill({ status: 204, headers: cors });
    if (url.includes("/models?")) return r.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify({ models: [
      { name: "models/gemini-2.5-flash", displayName: "Gemini 2.5 Flash", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-3-flash-lite", displayName: "Gemini 3 Flash-Lite", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-3-flash", displayName: "Gemini 3 Flash", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-3-flash-image", displayName: "Gemini 3 Flash Image", supportedGenerationMethods: ["generateContent"] },
      { name: "models/text-embedding-004", displayName: "Embedding", supportedGenerationMethods: ["embedContent"] },
    ] }) });
    globalThis.GEMINI_REQ = { url, headers: r.request().headers(), body: JSON.parse(r.request().postData()) };
    return r.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(fakeAi) }] } }] }) });
  });
  await ctx.route("https://api.anthropic.com/**", (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify({ id: "m", type: "message", role: "assistant", model: "x", stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: JSON.stringify(fakeAi) }] }) }));
  // Stand-in for the Chrome extension's bridge: answers the app and keeps what it was sent.
  await ctx.addInitScript(() => {
    window.__pushed = [];
    window.addEventListener("message", (e) => {
      if (e.source !== window || e.data?.source !== "resell-lister-app") return;
      if (e.data.type === "ping") window.postMessage({ source: "resell-lister-ext", type: "pong" }, location.origin);
      if (e.data.type === "push") { window.__pushed.push(e.data.item); window.postMessage({ source: "resell-lister-ext", type: "pushed", id: e.data.item.id, ok: true }, location.origin); }
    });
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${label}: ${e.message}`));
  // The "wrong" user signs in with a bad password on purpose; the browser logs that 400 itself.
  page.on("console", (m) => { if (m.type() === "error" && !(label === "wrong" && /status of 400/.test(m.text()))) errors.push(`${label} console: ${m.text()}`); });
  return { ctx, page };
}
const toastHas = (page, text, timeout = 10000) => page.waitForFunction((t) => document.getElementById("toast").textContent.includes(t), text, { timeout });
const rows = (page) => page.locator(".grid-row:not(.grid-head)");

// ---------- Tom: sign up, create household, invite ----------
const T = await newUser("tom");
await T.page.goto(APP);
await T.page.waitForSelector("#authForm");
check("signed out: sign-in screen, no nav", await T.page.isHidden(".sidebar"));
await T.page.click("[data-mode=up]");
await T.page.fill("#a-name", "Tom");
await T.page.fill("#a-email", "tom@test.dev");
await T.page.fill("#a-pass", "secret1");
await T.page.click("#authForm button[type=submit]");
await T.page.waitForSelector("#h-me");
check("household setup screen after sign-up, name prefilled", (await T.page.inputValue("#h-me")) === "Tom");
await T.page.fill("#h-name", "Tom & Jane's closet");
await T.page.click("#create");
await T.page.waitForSelector("#newInvite");
check("lands on settings after creating household", await T.page.isVisible(".sidebar"));
await T.page.click("#newInvite");
await T.page.waitForSelector("#inviteCode");
const code = (await T.page.textContent("#inviteCode")).trim();
check("invite code made (10 chars)", /^[A-Z2-9]{10}$/.test(code), code);
await T.page.click("#addPkg");
const newRow = T.page.locator(".pkg-row").last();
await newRow.locator("[data-k=name]").fill("Bubble mailer 9×12");
await newRow.locator("[data-k=length]").fill("12");
await newRow.locator("[data-k=width]").fill("9");
await newRow.locator("[data-k=height]").fill("1");
await newRow.locator("[data-k=vintedSize]").selectOption("Small");
await T.page.click("#savePkg");
await toastHas(T.page, "Packaging saved");
await T.page.click("#addPkg");
await T.page.click("#savePkg");
await toastHas(T.page, "needs a name");
check("empty packaging row is refused", true);
await T.page.locator(".pkg-row").last().locator("[data-pkg-rm]").click();
await T.page.screenshot({ path: `${SHOTS}/s-settings-tom.png`, fullPage: true });

// Wrong-password sign-in message (separate context)
const W = await newUser("wrong");
await W.page.goto(APP);
await W.page.waitForSelector("#authForm");
await W.page.fill("#a-email", "tom@test.dev"); await W.page.fill("#a-pass", "nope123");
await W.page.click("#authForm button[type=submit]");
await W.page.waitForSelector("[role=alert]");
check("wrong password shows friendly message", (await W.page.textContent("[role=alert]")).includes("Wrong email or password"));
await W.ctx.close();

// ---------- Jane: open invite link, sign up, join ----------
const J = await newUser("jane", { width: 390, height: 844 });
await J.page.goto(`${APP}#/join/${code}`);
await J.page.waitForSelector("#authForm");
check("invite link shows 'you've been invited'", (await J.page.textContent("main")).includes("invited to a household"));
await J.page.click("[data-mode=up]");
await J.page.fill("#a-name", "Jane"); await J.page.fill("#a-email", "jane@test.dev"); await J.page.fill("#a-pass", "secret2");
await J.page.click("#authForm button[type=submit]");
await J.page.waitForSelector("#h-code");
check("invite code prefilled for Jane", (await J.page.inputValue("#h-code")) === code);
await J.page.click("#join");
await J.page.waitForSelector(".page-head h1");
check("Jane lands on Home in the household", (await J.page.textContent("main")).includes("Tom & Jane's closet"));
// Tom is still on Settings: the member list should update by itself.
const sawJane = await T.page.waitForFunction(() => document.querySelector(".members")?.textContent.includes("Jane"), null, { timeout: 10000 }).then(() => true, () => false);
check("Tom's open Settings updates to show Jane", sawJane);

// ---------- Tom adds an item with photos + AI ----------
await T.page.goto(APP + "#/settings");
check("AI service defaults to free Gemini", (await T.page.inputValue("#aiProvider")) === "gemini" && await T.page.isHidden("#claudeBox"));
await T.page.fill("#geminiKey", "AIza-test-key");
await T.page.click("#saveGemini");
await toastHas(T.page, "Gemini key saved");
const modelOpts = await T.page.$$eval("#geminiModel option", (os) => os.map((o) => o.value));
check("Gemini models: newest full Flash first, no image/embedding models", modelOpts.join(",") === "gemini-3-flash,gemini-3-flash-lite,gemini-2.5-flash", modelOpts.join(","));
check("recommended model selected", (await T.page.inputValue("#geminiModel")) === "gemini-3-flash");
await T.page.locator("#aiCard").screenshot({ path: `${SHOTS}/s-ai-card.png` });
await T.page.goto(APP + "#/new");
await T.page.waitForSelector("#owner");
check("'Belongs to' defaults to Tom", (await T.page.$eval("#owner", (s) => s.options[s.selectedIndex].text)).includes("Tom"));
await T.page.setInputFiles("#file", [`${REPO}/tests/fixtures/photo.jpg`, `${REPO}/tests/fixtures/photo.jpg`]);
await T.page.waitForFunction(() => document.querySelectorAll(".thumb img").length === 2, null, { timeout: 15000 });
await T.page.waitForFunction(() => location.hash.startsWith("#/item/"), null, { timeout: 10000 });
const itemId = decodeURIComponent((await T.page.evaluate(() => location.hash)).split("/")[2]);
await T.page.fill("#f-overview-price", "25");
await T.page.fill("#f-overview-cost", "5");
await T.page.click("#gen");
await T.page.waitForSelector(".ai-result", { timeout: 15000 });
await T.page.waitForFunction(() => document.getElementById("saveState").textContent.includes("All changes saved"), null, { timeout: 10000 });
check("AI filled title", (await T.page.inputValue("#f-overview-title")) === fakeAi.overview.title);
const gq = globalThis.GEMINI_REQ;
check("Gemini call: chosen model + key header", gq.url.includes("/models/gemini-3-flash:generateContent") && gq.headers["x-goog-api-key"] === "AIza-test-key");
check("Gemini call: 2 photos + instructions + JSON answer", gq.body.contents[0].parts.filter((p) => p.inlineData).length === 2 && gq.body.systemInstruction.parts[0].text.includes("expert US reseller") && gq.body.generationConfig.responseMimeType === "application/json");
check("Gemini schema: capital types, no additionalProperties", gq.body.generationConfig.responseSchema.type === "OBJECT" && !JSON.stringify(gq.body.generationConfig.responseSchema).includes("additionalProperties"));
check("item page says Gemini free tier", (await T.page.textContent(".ai-box")).includes("Gemini's free tier"));
check("AI shipping guess: 1 lb 8 oz", (await T.page.inputValue("#f-shipping-weightLb")) === "1" && (await T.page.inputValue("#f-shipping-weightOz")) === "8");
check("AI picked packaging -> dims 19 × 14.5 × 2", (await T.page.inputValue("#f-shipping-length")) === "19" && (await T.page.inputValue("#f-shipping-width")) === "14.5");
check("AI guess warning shown", (await T.page.textContent("#shipCard")).includes("AI guesses"));
check("Vinted size Medium, eBay type Package", (await T.page.inputValue("#f-shipping-vintedSize")) === "Medium" && (await T.page.inputValue("#f-shipping-ebayPackageType")) === "Package (or thick envelope)");
// Weigh it: 2 lb 4 oz -> AI warning goes, Vinted suggests Large
await T.page.fill("#f-shipping-weightLb", "2");
await T.page.fill("#f-shipping-weightOz", "4");
check("weighing clears the AI-guess warning", !(await T.page.textContent("#shipCard")).includes("AI guesses"));
check("Vinted hint suggests Large for 2 lb 4 oz", (await T.page.textContent("#vintedHint")).includes("Large"));
check("summary shows 2 lb 4 oz · 19 × 14.5 × 2 in", (await T.page.textContent("#shipSummary")).includes("2 lb 4 oz · 19 × 14.5 × 2 in"));
await T.page.selectOption("#f-shipping-vintedSize", "Large");
check("hint disappears once you pick the suggested size", (await T.page.textContent("#vintedHint")) === "");
check("flat-rate charge hidden until chosen", await T.page.isHidden("#flatRow"));
await T.page.selectOption("#f-shipping-ebayCostType", "flat");
check("flat-rate charge appears", await T.page.isVisible("#flatRow"));
await T.page.fill("#f-shipping-ebayFlatCost", "7.50");
await T.page.selectOption("#f-shipping-ebayService", "USPS Ground Advantage");
await T.page.selectOption("#f-shipping-handlingDays", "1");
await T.page.waitForFunction(() => document.getElementById("saveState").textContent.includes("All changes saved"), null, { timeout: 10000 });
await T.page.locator("#shipCard").screenshot({ path: `${SHOTS}/s-shipping-card.png` });
await T.page.click("#send");
await toastHas(T.page, "Sent.");
const pushed = (await T.page.evaluate(() => window.__pushed)).at(-1);
check("extension gets eBay shipping lines", pushed.listing.ebay.package_weight === "2 lb 4 oz" && pushed.listing.ebay.package_dims === "19 × 14.5 × 2 in"
  && pushed.listing.ebay.package_type === "Package (or thick envelope)" && pushed.listing.ebay.shipping_cost === "Flat rate $7.50"
  && pushed.listing.ebay.shipping_service === "USPS Ground Advantage" && pushed.listing.ebay.handling_time === "1 business day", JSON.stringify(pushed.listing.ebay).slice(0, 300));
check("extension gets Vinted parcel size + 2 photos", pushed.listing.vinted.parcel_size === "Large (2 to 5 lb)" && pushed.photos.length === 2);

let stored;
await env.withSecurityRulesDisabled(async (c) => {
  const fs = c.firestore();
  const { getDocs, collection } = await import("firebase/firestore");
  const hh = (await getDocs(collection(fs, "households"))).docs.find((d) => d.data().name === "Tom & Jane's closet");
  globalThis.HID = hh.id;
  stored = (await getDoc(doc(fs, `households/${hh.id}/items/${itemId}`))).data();
  globalThis.PHOTO_COUNT = (await getDocs(collection(fs, `households/${hh.id}/photos`))).size;
});
check("item saved to cloud with owner Tom + price + AI title", stored?.overview?.price === "25" && stored?.overview?.title === fakeAi.overview.title && stored?.ownerUid && stored?.updatedBy === stored?.ownerUid);
check("2 photo docs in cloud, item keeps only ids/sizes + cover", globalThis.PHOTO_COUNT === 2 && stored.photos.length === 2 && !stored.photos[0].dataUrl && stored.photos[0].size > 1000 && stored.cover?.startsWith("data:image/jpeg"));
check("history has created + ai", (stored.history || []).map((h) => h.act).join(",") === "created,ai");
check("shipping saved to cloud", stored.shipping?.weightLb === "2" && stored.shipping?.weightOz === "4" && stored.shipping?.ebayFlatCost === "7.50" && stored.shipping?.vintedSize === "Large" && stored.shipping?.aiGuess === false, JSON.stringify(stored.shipping));

// ---------- Jane opens to her own (empty) inventory, peeks at Tom's, and helps list his item ----------
await J.page.goto(APP + "#/inventory");
await J.page.waitForSelector(".person-filter");
check("Jane's inventory opens to her own (empty)", (await J.page.textContent("main")).includes("Your inventory is empty"));
const switchText = (await J.page.textContent(".person-filter")).replace(/\s+/g, " ");
check("switch offers Mine / Tom's / Both", switchText.includes("Mine") && switchText.includes("Tom's") && switchText.includes("Both"), switchText);
await J.page.locator(".person-filter button", { hasText: "Tom's" }).click();
await J.page.waitForFunction(() => document.querySelectorAll(".grid-row:not(.grid-head)").length === 1, null, { timeout: 10000 });
check("Jane can peek at Tom's inventory", (await J.page.textContent(".grid")).includes("Levi's 501"));
check("banner: looking at Tom's inventory", (await J.page.textContent(".viewing-other")).includes("Tom's"));
await J.page.screenshot({ path: `${SHOTS}/s-peek-phone.png` });
check("no owner badges inside one person's inventory", (await J.page.locator(".grid-row:not(.grid-head) .c-item .avatar").count()) === 0);
await J.page.locator(".person-filter button[data-person=all]").click();
check("Both view shows Tom's badge on his item", (await J.page.locator(".grid-row:not(.grid-head) .c-item .avatar").first().textContent()) === "T");
await J.page.locator(".person-filter button", { hasText: "Tom's" }).click();
await J.page.waitForSelector(".viewing-other");
await rows(J.page).first().locator("[data-mkt=poshmark]").click();
await J.page.locator("dialog.modal button[value=listed]").click();
await toastHas(J.page, "Poshmark: Listed");
await rows(J.page).first().locator("[data-mkt=ebay]").click();
await J.page.locator("dialog.modal button[value=listed]").click();
await toastHas(J.page, "eBay: Listed");

// ---------- Tom has the item open: sees "Jane just changed this item"; his edit doesn't undo hers ----------
await T.page.waitForSelector("#remoteBanner:not([hidden])", { timeout: 10000 });
check("Tom sees 'Jane just changed this item'", (await T.page.textContent("#remoteBanner")).includes("Jane just changed this item"));
await T.page.fill("#f-overview-sku", "BIN1-007");
await T.page.waitForFunction(() => document.getElementById("saveState").textContent.includes("All changes saved"), null, { timeout: 10000 });
await env.withSecurityRulesDisabled(async (c) => { stored = (await getDoc(doc(c.firestore(), `households/${globalThis.HID}/items/${itemId}`))).data(); });
check("Tom's SKU edit kept Jane's listings (no overwrite)", stored.overview.sku === "BIN1-007" && stored.listings.poshmark.status === "listed" && stored.listings.ebay.status === "listed");
await T.page.click("#reload");
await T.page.waitForSelector(".tabs");
check("'Show latest' loads Jane's statuses", (await T.page.textContent(".tabs")).includes("Listed"));

// ---------- Home activity shows who did what ----------
await T.page.goto(APP + "#/");
await T.page.waitForSelector(".activity");
const act = await T.page.textContent(".activity");
check("activity: Jane listed on Poshmark", /Jane\s+listed on Poshmark/.test(act), act.replace(/\s+/g, " ").slice(0, 200));
check("activity: name not repeated for screen readers", !/JaneJane/.test(act.replace(/\s+/g, "")));
check("activity: You (Tom) generated the listing", /You\s+generated the listing/.test(act));

// ---------- Relist: make the Poshmark listing 40 days old ----------
await env.withSecurityRulesDisabled(async (c) => {
  await updateDoc(doc(c.firestore(), `households/${globalThis.HID}/items/${itemId}`), { "listings.poshmark.listedAt": Date.now() - 40 * 864e5, "listings.ebay.listedAt": Date.now() - 70 * 864e5, updatedAt: Date.now() });
});
await T.page.goto(APP + "#/inventory");
await T.page.waitForSelector("[data-filter=relist]");
await T.page.waitForFunction(() => document.querySelector("[data-filter=relist] .n")?.textContent === "1", null, { timeout: 10000 });
check("Needs relist count 1 (Poshmark 40d; eBay 70d ignored since eBay reminders are off)", true);
check("Poshmark cell says Relist 40d", (await rows(T.page).first().locator("[data-mkt=poshmark]").textContent()).includes("Relist 40d"));
await rows(T.page).first().locator("[data-mkt=poshmark]").click();
check("relist tips shown", (await T.page.textContent("dialog.modal")).includes("Share the listing"));
check("drop price button shows $25 → $22", (await T.page.textContent("dialog.modal")).includes("$25.00 → $22.00"));
await T.page.locator("dialog.modal button[value=drop]").click();
await toastHas(T.page, "New Poshmark price $22.00");
await rows(T.page).first().locator("[data-mkt=poshmark]").click();
await T.page.locator("dialog.modal button[value=stats]").click();
await T.page.fill("dialog.modal #m-views", "14"); await T.page.fill("dialog.modal #m-likes", "3");
await T.page.locator("dialog.modal button[value=ok]").click();
await toastHas(T.page, "Saved");
await rows(T.page).first().locator("[data-mkt=poshmark]").click();
check("views/likes shown in modal", (await T.page.textContent("dialog.modal")).includes("Views: 14"));
await T.page.locator("dialog.modal button[value=relisted]").click();
await toastHas(T.page, "Relisted on Poshmark");
check("Needs relist count back to 0", (await T.page.textContent("[data-filter=relist] .n")) === "0");
await T.page.screenshot({ path: `${SHOTS}/s-inventory-tom.png`, fullPage: true });

// eBay reminders on (shared setting) -> eBay 70d now stale, and Jane sees the setting
await T.page.goto(APP + "#/settings");
await T.page.check("[data-relist-on=ebay]");
await T.page.click("#saveRelist");
await toastHas(T.page, "Relist reminders saved");
await J.page.goto(APP + "#/inventory");
await J.page.waitForFunction(() => document.querySelector("[data-filter=relist] .n")?.textContent === "1", null, { timeout: 10000 }).catch(() => {});
check("shared setting: Jane sees eBay listing needing relist", (await J.page.textContent("[data-filter=relist] .n")) === "1");

// ---------- Jane adds her own item; person filter + analytics per person ----------
await J.page.goto(APP + "#/new");
await J.page.waitForSelector("#f-overview-title");
await J.page.fill("#f-overview-title", "Lululemon Align Leggings 6");
await J.page.fill("#f-overview-price", "48");
await J.page.fill("#f-overview-cost", "8");
await J.page.waitForFunction(() => location.hash.startsWith("#/item/"), null, { timeout: 10000 });
check("Jane's item lists the household's custom packaging", (await J.page.textContent("#pkg")).includes("Bubble mailer 9×12"));
await J.page.selectOption("#pkg", { label: "Bubble mailer 9×12 (12×9×1 in)" });
check("picking packaging fills size and Vinted size", (await J.page.inputValue("#f-shipping-length")) === "12" && (await J.page.inputValue("#f-shipping-vintedSize")) === "Small");
await J.page.waitForFunction(() => document.getElementById("saveState").textContent.includes("All changes saved"), null, { timeout: 10000 });
check("no sideways scrolling on phone (item page)", !(await J.page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
await J.page.locator("#shipCard").screenshot({ path: `${SHOTS}/s-shipping-card-phone.png` });
// Jane is still peeking at Tom's inventory: her new item went to her own, not his.
await J.page.goto(APP + "#/inventory");
await J.page.waitForSelector(".viewing-other");
check("Jane's new item isn't in Tom's inventory", !(await J.page.textContent("main")).includes("Lululemon"));
await J.page.click(".viewing-other button");
await J.page.waitForFunction(() => document.querySelectorAll(".grid-row:not(.grid-head)").length === 1 && !document.querySelector(".viewing-other"), null, { timeout: 10000 });
check("'Back to mine' shows only Jane's item", (await J.page.textContent(".grid")).includes("Lululemon") && !(await J.page.textContent(".grid")).includes("Levi's"));
await J.page.goto(APP + "#/");
await J.page.waitForSelector(".attention");
check("draft without weight: 'Add the package weight'", (await J.page.textContent(".attention")).includes("Add the package weight"));
check("Jane's home only lists her own items", !(await J.page.textContent(".attention")).includes("Levi's"));
await J.page.goto(APP + "#/inventory");
await J.page.waitForSelector(".grid-row:not(.grid-head)");
const janeRow = rows(J.page).first();
await janeRow.locator("[data-mkt=vinted]").click();
await J.page.locator("dialog.modal button[value=sold]").click();
await J.page.fill("dialog.modal #m-price", "45");
await J.page.locator("dialog.modal button[value=ok]").click();
await toastHas(J.page, "Sold");
await J.page.locator(".person-filter button[data-person=all]").click();

// Tom sells his on eBay at 30
await T.page.goto(APP + "#/inventory");
await T.page.waitForSelector(".grid-row:has-text(\"Levi's 501\")");
check("Tom's own inventory doesn't show Jane's item", !(await T.page.textContent(".grid")).includes("Lululemon"));
const tomRow = T.page.locator(".grid-row", { hasText: "Levi's 501" });
await tomRow.locator("[data-mkt=ebay]").click();
await T.page.locator("dialog.modal button[value=sold]").click();
await T.page.fill("dialog.modal #m-price", "30");
await T.page.locator("dialog.modal button[value=ok]").click();
await toastHas(T.page, "remove it from Poshmark");
check("sale reminds to delist Poshmark", true);

await T.page.goto(APP + "#/analytics");
await T.page.selectOption("#range", "all");
await T.page.waitForSelector(".hero-num");
// Tom: 30 - (30*13.6% + 0.40) - 5 = 20.52 ; Jane: Vinted 0% fee: 45 - 8 = 37 ; total 57.52
check("Tom's analytics default to his own: $20.52", (await T.page.textContent(".hero-num")).trim() === "$20.52", await T.page.textContent(".hero-num"));
check("no By person table in a single inventory", (await T.page.locator("section", { hasText: "By person" }).count()) === 0);
await T.page.locator(".person-filter button[data-person=all]").click();
check("total profit $57.52", (await T.page.textContent(".hero-num")).trim() === "$57.52", await T.page.textContent(".hero-num"));
const byPerson = await T.page.locator("section", { hasText: "By person" }).textContent();
check("By person table: Tom $20.52, Jane $37.00", byPerson.includes("$20.52") && byPerson.includes("$37.00"), byPerson.replace(/\s+/g, " ").slice(0, 200));
await T.page.locator(".person-filter button", { hasText: "Jane's" }).click();
check("Jane's inventory: profit $37.00", (await T.page.textContent(".hero-num")).trim() === "$37.00");
await T.page.locator(".person-filter button[data-person=all]").click();
await T.page.screenshot({ path: `${SHOTS}/s-analytics.png`, fullPage: true });

// Home attention for Tom shows delist reminder with Tom's badge
await T.page.goto(APP + "#/");
await T.page.waitForSelector(".attention");
check("home: sold - remove from Poshmark", (await T.page.textContent(".attention")).includes("remove it from Poshmark"));

// ---------- Copy item (photos copied in cloud) ----------
await T.page.goto(APP + "#/inventory");
await T.page.locator(".grid-row", { hasText: "Levi's 501" }).locator("[data-menu]").click();
await T.page.locator("dialog.modal button[value=copy]").click();
await T.page.waitForFunction(() => document.querySelectorAll(".thumb img").length === 2, null, { timeout: 15000 });
check("copy has both photos", true);
await env.withSecurityRulesDisabled(async (c) => {
  const { getDocs, collection } = await import("firebase/firestore");
  globalThis.PHOTO_COUNT = (await getDocs(collection(c.firestore(), `households/${globalThis.HID}/photos`))).size;
});
check("4 photo docs after copy", globalThis.PHOTO_COUNT === 4, String(globalThis.PHOTO_COUNT));
await T.page.click("#del");
await T.page.locator("dialog.modal button[value=yes]").click();
await T.page.waitForFunction(() => location.hash === "#/inventory");
await env.withSecurityRulesDisabled(async (c) => {
  const { getDocs, collection } = await import("firebase/firestore");
  globalThis.PHOTO_COUNT = (await getDocs(collection(c.firestore(), `households/${globalThis.HID}/photos`))).size;
});
check("deleting the copy deletes its photos (back to 2)", globalThis.PHOTO_COUNT === 2, String(globalThis.PHOTO_COUNT));

// ---------- Jane's phone layout ----------
await J.page.goto(APP + "#/");
await J.page.waitForSelector(".activity");
check("no sideways scrolling on phone (home)", !(await J.page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
await J.page.screenshot({ path: `${SHOTS}/s-home-jane-phone.png`, fullPage: true });
await J.page.goto(APP + "#/inventory");
await J.page.waitForSelector(".grid-row:not(.grid-head)");
check("no sideways scrolling on phone (inventory)", !(await J.page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
await J.page.screenshot({ path: `${SHOTS}/s-inventory-jane-phone.png`, fullPage: true });
await J.page.goto(APP + "#/settings");
await J.page.waitForSelector(".members");
check("Jane (not creator) has Leave button, no Remove buttons", (await J.page.locator("#leave").count()) === 1 && (await J.page.locator("[data-remove]").count()) === 0);

// ---------- Tom removes Jane: her app drops back to the join screen ----------
await T.page.goto(APP + "#/settings");
await T.page.locator("[data-remove]").click();
await T.page.locator("dialog.modal button[value=yes]").click();
await toastHas(T.page, "Jane removed");
await J.page.waitForSelector("#h-code", { timeout: 15000 });
check("removed Jane sees the join screen", true);

// ---------- Sign out ----------
await T.page.click("#signOut");
await T.page.waitForSelector("#authForm");
check("sign out returns to sign-in", true);

check("no page errors", errors.length === 0, JSON.stringify(errors.slice(0, 5)));
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
await browser.close();
await env.cleanup();
process.exit(fails ? 1 : 0);
