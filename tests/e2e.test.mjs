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
};

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const errors = [];
async function newUser(label, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  await ctx.route("**/app/config.js", (r) => r.fulfill({ contentType: "text/javascript", body: `export const firebaseConfig = { apiKey: "demo-key", authDomain: "demo-resell.firebaseapp.com", projectId: "demo-resell", storageBucket: "", messagingSenderId: "1", appId: "1:1:web:1" };` }));
  await ctx.route("https://api.anthropic.com/**", (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify({ id: "m", type: "message", role: "assistant", model: "x", stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: JSON.stringify(fakeAi) }] }) }));
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
await T.page.fill("#key", "sk-ant-test"); await T.page.click("#saveKey");
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

// ---------- Jane sees it live, with Tom's badge, and lists it ----------
await J.page.goto(APP + "#/inventory");
await J.page.waitForFunction(() => document.querySelectorAll(".grid-row:not(.grid-head)").length === 1, null, { timeout: 10000 });
check("Jane sees Tom's item", (await J.page.textContent(".grid")).includes("Levi's 501"));
check("item shows Tom's badge", (await J.page.locator(".grid-row:not(.grid-head) .avatar").first().textContent()) === "T");
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
await J.page.click("#done");
await J.page.waitForSelector(".grid-row:not(.grid-head)");
await J.page.waitForFunction(() => document.querySelectorAll(".grid-row:not(.grid-head)").length === 2, null, { timeout: 10000 });
await J.page.click("[data-person]:not([data-person=all]) >> text=Me");
check("Jane 'Me' filter shows only her item", (await rows(J.page).count()) === 1 && (await J.page.textContent(".grid")).includes("Lululemon"));
const janeRow = rows(J.page).first();
await janeRow.locator("[data-mkt=vinted]").click();
await J.page.locator("dialog.modal button[value=sold]").click();
await J.page.fill("dialog.modal #m-price", "45");
await J.page.locator("dialog.modal button[value=ok]").click();
await toastHas(J.page, "Sold");
await J.page.click("[data-person=all]");

// Tom sells his on eBay at 30
await T.page.goto(APP + "#/inventory");
await T.page.waitForFunction(() => document.querySelectorAll(".grid-row:not(.grid-head)").length === 2, null, { timeout: 10000 });
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
check("total profit $57.52", (await T.page.textContent(".hero-num")).trim() === "$57.52", await T.page.textContent(".hero-num"));
const byPerson = await T.page.locator("section", { hasText: "By person" }).textContent();
check("By person table: Tom $20.52, Jane $37.00", byPerson.includes("$20.52") && byPerson.includes("$37.00"), byPerson.replace(/\s+/g, " ").slice(0, 200));
await T.page.click("[data-person]:not([data-person=all]) >> text=Jane");
check("Jane filter: profit $37.00", (await T.page.textContent(".hero-num")).trim() === "$37.00");
await T.page.click("[data-person=all]");
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
