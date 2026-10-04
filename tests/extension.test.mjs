// Loads the real Chrome extension, hands it an item through the app bridge, then checks the
// sell-page panel on stand-in eBay and Vinted pages (the real pages need a login).
import { chromium } from "playwright";
import { readFileSync } from "fs";

const REPO = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const EXT = `${REPO}/extension`;
let fails = 0;
const check = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? " -> " + extra : ""}`); if (!cond) fails++; };
const photo = `data:image/jpeg;base64,${readFileSync(`${REPO}/tests/fixtures/photo.jpg`).toString("base64")}`;

const item = {
  id: "t1", title: "Levi's 501 Jeans", photos: [photo, photo], price: "25", sentAt: Date.now(),
  prices: { ebay: "25", vinted: "22" },
  listing: {
    ebay: { title: "Levi's 501 Jeans 32x30", category_path: "Clothing > Men > Jeans", condition: "Pre-owned - Good", item_specifics: "", description: "Classic jeans.",
      package_weight: "2 lb 4 oz", package_dims: "19 × 14.5 × 2 in", package_type: "Package (or thick envelope)", shipping_service: "USPS Ground Advantage",
      shipping_cost: "Flat rate $7.50", handling_time: "1 business day" },
    vinted: { title: "Levi's 501 jeans", category_path: "Men > Jeans", condition: "Good", brand: "Levi's", size: "32", colors: "Blue", material: "", description: "Classic jeans.",
      parcel_size: "Large (2 to 5 lb)", package_weight: "2 lb 4 oz" },
  },
};

const ctx = await chromium.launchPersistentContext("/tmp/rl-ext-" + Date.now(), {
  headless: true, ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}),
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--headless=new"],
});
const errors = [];
const form = (fields) => `<!doctype html><html><body><input type="file" accept="image/*" multiple id="up">${fields}
<script>window.events=[];document.getElementById('up').addEventListener('change',e=>window.events.push('files:'+e.target.files.length));</script></body></html>`;
await ctx.route("https://www.ebay.com/**", (r) => r.fulfill({ contentType: "text/html", body: form(`<input name="title" id="t"><input name="price" id="p"><textarea name="description" id="d"></textarea>`) }));
await ctx.route("https://www.vinted.com/**", (r) => r.fulfill({ contentType: "text/html", body: form(`<label for="t">Title</label><input id="t"><label for="d">Describe your item</label><textarea id="d"></textarea><label for="b">Brand</label><input id="b"><label for="p">Price</label><input id="p">`) }));

const app = await ctx.newPage();
app.on("pageerror", (e) => errors.push(e.message));
await app.addInitScript((it) => { window.TEST_ITEM = it; }, item);
await app.goto("http://localhost:8766/tests/fixtures/bridge.html");
await app.waitForFunction(() => document.getElementById("out").textContent === "pushed", null, { timeout: 10000 });
check("bridge stored the item in the extension", true);

const eb = await ctx.newPage();
eb.on("pageerror", (e) => errors.push("ebay: " + e.message));
await eb.goto("https://www.ebay.com/sl/list?mode=AddItem");
await eb.locator("#resell-lister-root button.launch").click();
const panel = eb.locator("#resell-lister-root .panel");
const text = await panel.textContent();
for (const label of ["Package weight", "Package size (L × W × H)", "eBay package type", "Shipping service", "Who pays shipping", "Handling time"]) check(`eBay panel shows ${label}`, text.includes(label));
check("eBay panel values", text.includes("2 lb 4 oz") && text.includes("19 × 14.5 × 2 in") && text.includes("Flat rate $7.50"));
check("blank fields hidden (no empty Item specifics row)", !text.includes("Item specifics"));
check("fields in order: Title before Package weight", text.indexOf("Title") < text.indexOf("Package weight"));
await eb.locator("#resell-lister-root button.fill").click();
await eb.waitForTimeout(500);
check("eBay form filled + 2 photos", (await eb.inputValue("#t")) === "Levi's 501 Jeans 32x30" && (await eb.inputValue("#p")) === "25" && (await eb.evaluate(() => window.events)).includes("files:2"));

const vi = await ctx.newPage();
await vi.goto("https://www.vinted.com/items/new");
await vi.locator("#resell-lister-root button.launch").click();
const vtext = await vi.locator("#resell-lister-root .panel").textContent();
check("Vinted panel shows parcel size", vtext.includes("Vinted parcel size") && vtext.includes("Large (2 to 5 lb)"));
await vi.locator("#resell-lister-root button.fill").click();
await vi.waitForTimeout(500);
check("Vinted form filled (price 22, brand)", (await vi.inputValue("#p")) === "22" && (await vi.inputValue("#b")) === "Levi's");

check("no page errors", errors.length === 0, JSON.stringify(errors));
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
await ctx.close();
process.exit(fails ? 1 : 0);
