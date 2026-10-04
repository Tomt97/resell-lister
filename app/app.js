import { allItems, getItem, putItem, deleteItem } from "./db.js";
import { writeListings } from "./ai.js";

// ---------- platforms ----------
// Field kinds: "line" (one line), "text" (multi-line).
const PLATFORMS = {
  ebay: {
    name: "eBay",
    sellUrl: "https://www.ebay.com/sl/prelist/suggest",
    fields: [
      ["title", "Title", "line", 80],
      ["category_path", "Category", "line"],
      ["condition", "Condition", "line"],
      ["item_specifics", "Item specifics (one per line, Name: Value)", "text"],
      ["description", "Description", "text"],
    ],
  },
  poshmark: {
    name: "Poshmark",
    sellUrl: "https://poshmark.com/create-listing",
    fields: [
      ["title", "Title", "line", 80],
      ["department", "Department", "line"],
      ["category", "Category", "line"],
      ["subcategory", "Subcategory", "line"],
      ["condition", "Condition", "line"],
      ["brand", "Brand", "line"],
      ["size", "Size", "line"],
      ["colors", "Colors (up to 2)", "line"],
      ["style_tags", "Style tags (up to 3)", "line"],
      ["description", "Description", "text"],
    ],
  },
  vinted: {
    name: "Vinted",
    sellUrl: "https://www.vinted.com/items/new",
    fields: [
      ["title", "Title", "line"],
      ["category_path", "Category", "line"],
      ["condition", "Condition", "line"],
      ["brand", "Brand", "line"],
      ["size", "Size", "line"],
      ["colors", "Colors (up to 2)", "line"],
      ["material", "Material", "line"],
      ["description", "Description", "text"],
    ],
  },
};
const PIDS = Object.keys(PLATFORMS);
const STATUS_LABEL = { none: "Not listed", listed: "Listed", sold: "Sold", delist: "Remove listing" };

// Fee estimates (US). Editable in Settings because marketplaces change them.
const DEFAULT_FEES = {
  ebay: { pct: 13.6, fixed: 0.4 },
  poshmark: { pct: 20, fixed: 0, flatUnder15: 2.95 },
  vinted: { pct: 0, fixed: 0 },
};

// ---------- settings (this browser only) ----------
const settings = {
  get apiKey() { return safeGet("rl.apiKey") || ""; },
  set apiKey(v) { safeSet("rl.apiKey", v); },
  get fees() {
    try { return { ...DEFAULT_FEES, ...JSON.parse(safeGet("rl.fees") || "{}") }; } catch { return DEFAULT_FEES; }
  },
  set fees(v) { safeSet("rl.fees", JSON.stringify(v)); },
};
function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch {} }

// ---------- helpers ----------
const $view = document.getElementById("view");
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const money = (n) => (Number.isFinite(+n) && n !== "" ? `$${(+n).toFixed(2)}` : "—");
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

function toast(msg, ms = 2200) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), ms);
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied");
  } catch {
    toast("Couldn't copy - select the text and copy it instead");
  }
}

export function netAfterFees(pid, price, fees = settings.fees) {
  const p = +price;
  if (!Number.isFinite(p) || p <= 0) return null;
  const f = fees[pid] || { pct: 0, fixed: 0 };
  if (f.flatUnder15 && p < 15) return Math.max(0, p - f.flatUnder15);
  return Math.max(0, p - (p * f.pct) / 100 - (f.fixed || 0));
}

const titleOf = (item) =>
  item.listing?.ebay?.title || item.listing?.poshmark?.title || item.listing?.vinted?.title || "Untitled item";
const priceFor = (item, pid) => item.prices?.[pid] || item.price;

// Shrink photos so they store well and stay inside Claude's preferred image size.
async function fileToPhoto(file, maxSide = 1568) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    return { id: uid(), dataUrl: canvas.toDataURL("image/jpeg", 0.85) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Turn the AI answer into plain, editable text fields.
function toEditable(ai) {
  const join = (a) => (Array.isArray(a) ? a.filter(Boolean).join(", ") : a || "");
  return {
    ebay: {
      ...ai.ebay,
      item_specifics: (ai.ebay.item_specifics || []).map((s) => `${s.name}: ${s.value}`).join("\n"),
    },
    poshmark: { ...ai.poshmark, colors: join(ai.poshmark.colors), style_tags: join(ai.poshmark.style_tags) },
    vinted: { ...ai.vinted, colors: join(ai.vinted.colors) },
  };
}

function blankItem() {
  return {
    id: uid(),
    createdAt: Date.now(),
    photos: [],
    price: "",
    cost: "",
    notes: "",
    ai: null,
    listing: null,
    prices: {},
    status: { ebay: "none", poshmark: "none", vinted: "none" },
  };
}

// ---------- extension bridge ----------
// The Chrome extension's content script answers on this page; it then shows
// the item in a fill-in panel on the eBay / Poshmark / Vinted sell pages.
let extensionReady = false;
window.addEventListener("message", (e) => {
  if (e.source !== window || e.data?.source !== "resell-lister-ext") return;
  if (e.data.type === "pong") {
    extensionReady = true;
    document.querySelectorAll("[data-ext-hint]").forEach((el) => (el.hidden = true));
  }
});
window.postMessage({ source: "resell-lister-app", type: "ping" }, location.origin);

function sendToExtension(item) {
  return new Promise((resolve, reject) => {
    if (!extensionReady) return reject(new Error("The Resell Lister extension isn't installed in this browser."));
    const payload = {
      id: item.id,
      title: titleOf(item),
      photos: item.photos.map((p) => p.dataUrl),
      price: item.price,
      prices: Object.fromEntries(PIDS.map((pid) => [pid, priceFor(item, pid)])),
      listing: item.listing,
      sentAt: Date.now(),
    };
    const onMsg = (e) => {
      if (e.source !== window || e.data?.source !== "resell-lister-ext") return;
      if (e.data.type === "pushed" && e.data.id === item.id) {
        window.removeEventListener("message", onMsg);
        e.data.ok ? resolve() : reject(new Error(e.data.error || "The extension couldn't save the item."));
      }
    };
    window.addEventListener("message", onMsg);
    window.postMessage({ source: "resell-lister-app", type: "push", item: payload }, location.origin);
    setTimeout(() => {
      window.removeEventListener("message", onMsg);
      reject(new Error("The extension didn't answer. Reload this page and try again."));
    }, 8000);
  });
}

// ---------- router ----------
async function route() {
  const hash = location.hash || "#/";
  const [, page, id] = hash.split("/");
  document.querySelectorAll("[data-nav]").forEach((a) => {
    const on = (a.dataset.nav === "inventory" && !page) || a.dataset.nav === page;
    a.classList.toggle("active", on);
  });
  try {
    if (page === "settings") return renderSettings();
    if (page === "new") return renderItem(blankItem(), true);
    if (page === "item" && id) {
      const item = await getItem(id);
      if (!item) return (location.hash = "#/");
      return renderItem(item, false);
    }
    return renderInventory();
  } catch (err) {
    $view.innerHTML = `<div class="card"><h2>Something went wrong</h2><p>${esc(err.message)}</p></div>`;
  }
}
window.addEventListener("hashchange", route);

// ---------- inventory ----------
async function renderInventory() {
  const items = await allItems();
  const toDelist = items.filter((it) => PIDS.some((p) => it.status?.[p] === "delist"));
  const active = items.filter((it) => !PIDS.some((p) => it.status?.[p] === "sold"));
  const sold = items.filter((it) => PIDS.some((p) => it.status?.[p] === "sold"));
  const soldValue = sold.reduce((s, it) => {
    const pid = PIDS.find((p) => it.status[p] === "sold");
    return s + (netAfterFees(pid, priceFor(it, pid)) || 0) - (+it.cost || 0);
  }, 0);

  const card = (it) => `
    <a class="item" href="#/item/${esc(it.id)}">
      ${it.photos[0] ? `<img src="${esc(it.photos[0].dataUrl)}" alt="">` : `<img alt="">`}
      <div class="body">
        <div class="t">${esc(titleOf(it))}</div>
        <div class="muted small">${money(it.price)}${it.cost ? ` · cost ${money(it.cost)}` : ""}</div>
        <div class="chips">${PIDS.map(
          (p) => `<span class="chip ${esc(it.status?.[p] || "none")}">${PLATFORMS[p].name}: ${STATUS_LABEL[it.status?.[p] || "none"]}</span>`
        ).join("")}</div>
      </div>
    </a>`;

  $view.innerHTML = `
    ${!settings.apiKey ? `<div class="alert"><strong>Set up first:</strong> add your Claude API key in <a href="#/settings">Settings</a> so the AI can write your listings.</div>` : ""}
    ${toDelist.length ? `<div class="alert"><strong>Remove these listings:</strong> ${toDelist.length} item${toDelist.length > 1 ? "s" : ""} sold on one site and still listed elsewhere.
      <ul class="todo">${toDelist.map((it) => `<li><a href="#/item/${esc(it.id)}">${esc(titleOf(it))}</a> - remove from ${PIDS.filter((p) => it.status[p] === "delist").map((p) => PLATFORMS[p].name).join(", ")}</li>`).join("")}</ul></div>` : ""}
    <div class="card"><div class="stats">
      <div class="stat"><span class="muted small">Active items</span><b>${active.length}</b></div>
      <div class="stat"><span class="muted small">Sold</span><b>${sold.length}</b></div>
      <div class="stat"><span class="muted small">Profit from sales (est.)</span><b>${money(soldValue)}</b></div>
    </div></div>
    ${items.length ? `
      <h2>Active</h2><div class="items">${active.map(card).join("") || `<p class="muted">Nothing active.</p>`}</div>
      ${sold.length ? `<h2 style="margin-top:20px">Sold</h2><div class="items">${sold.map(card).join("")}</div>` : ""}`
    : `<div class="card empty"><h2>No items yet</h2><p class="muted">Add photos and a price. The AI writes your eBay, Poshmark and Vinted listings.</p><a class="btn primary" href="#/new">+ New item</a></div>`}
  `;
}

// ---------- item editor ----------
function renderItem(item, isNew) {
  let tab = "ebay";
  let busy = false;

  const draw = () => {
    const L = item.listing;
    const ai = item.ai;
    $view.innerHTML = `
      <h1>${isNew ? "New item" : esc(titleOf(item))}</h1>

      <div class="card">
        <h2>Photos</h2>
        <div class="drop" id="drop" tabindex="0" role="button">
          <strong>Add photos</strong><br><span class="small">Tap to choose or drag them here. The first photo is the cover.</span>
          <input id="file" type="file" accept="image/*" multiple hidden>
        </div>
        <div class="thumbs">${item.photos.map((p, i) => `
          <div class="thumb">
            <img src="${esc(p.dataUrl)}" alt="Photo ${i + 1}">
            ${i === 0 ? `<span class="cover">Cover</span>` : `<button class="tiny mk" data-cover="${i}">Make cover</button>`}
            <button class="tiny x" data-rm="${i}" aria-label="Remove photo">×</button>
          </div>`).join("")}</div>
      </div>

      <div class="card">
        <div class="row">
          <div class="grow"><label for="price">Your price ($)</label><input id="price" type="number" inputmode="decimal" min="0" step="0.01" value="${esc(item.price)}"></div>
          <div class="grow"><label for="cost">What you paid ($, optional)</label><input id="cost" type="number" inputmode="decimal" min="0" step="0.01" value="${esc(item.cost)}"></div>
        </div>
        <label for="notes">Notes for the AI (optional)</label>
        <textarea id="notes" placeholder="Anything the photos don't show: measurements, flaws, brand if the tag is hard to read, smoke-free home…">${esc(item.notes)}</textarea>
        <div class="row" style="margin-top:12px">
          <button class="primary" id="gen" ${busy ? "disabled" : ""}>${busy ? `<span class="spinner"></span> Writing listings…` : ai ? "Rewrite listings with AI" : "Write my listings with AI"}</button>
          <span class="muted small">Uses your Claude API key. About 2 to 5 cents per item.</span>
        </div>
      </div>

      ${ai ? `
      <div class="card">
        <h2>AI notes</h2>
        <div class="stats">
          <div class="stat"><span class="muted small">AI price idea</span><b>${money(ai.pricing.suggested_price)}</b><span class="small muted">quick sale ${money(ai.pricing.quick_sale_price)} · ${esc(ai.pricing.confidence)} confidence</span></div>
          ${PIDS.map((p) => `<div class="stat"><span class="muted small">You keep on ${PLATFORMS[p].name} (est.)</span><b>${money(netAfterFees(p, priceFor(item, p)))}</b></div>`).join("")}
        </div>
        <p class="small muted">${esc(ai.pricing.reasoning)} This is an estimate from the photos, not live sold prices.</p>
        ${ai.check_before_posting?.length ? `<strong>Check before posting</strong><ul class="todo">${ai.check_before_posting.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}
        ${ai.item?.flaws?.length ? `<p><strong>Flaws spotted:</strong> ${esc(ai.item.flaws.join("; "))}</p>` : ""}
      </div>` : ""}

      ${L ? `
      <div class="card">
        <div class="tabs" role="tablist">${PIDS.map((p) => `<button role="tab" data-tab="${p}" class="${p === tab ? "on" : ""}">${PLATFORMS[p].name}</button>`).join("")}</div>
        ${platformPanel(tab)}
      </div>` : ""}

      ${L ? `
      <div class="card">
        <h2>Post it</h2>
        <p class="small muted">Send the item to the Chrome extension, then open each sell page. A Resell Lister panel there fills in the form and adds the photos. Review it and press the site's own List / Upload button.</p>
        <p class="small" data-ext-hint ${extensionReady ? "hidden" : ""}>The extension isn't detected in this browser. Install it from the <code>extension</code> folder (see the README). On a phone, use the copy buttons above instead.</p>
        <div class="row">
          <button class="primary" id="send">Send to extension</button>
          ${PIDS.map((p) => `<a class="btn" target="_blank" rel="noopener" href="${PLATFORMS[p].sellUrl}">Open ${PLATFORMS[p].name}</a>`).join("")}
        </div>
      </div>` : ""}

      <div class="row" style="justify-content:space-between">
        <button class="primary" id="save">Save</button>
        ${!isNew ? `<button class="danger" id="del">Delete item</button>` : ""}
      </div>
    `;
    wire();
  };

  const platformPanel = (pid) => {
    const P = PLATFORMS[pid];
    const v = item.listing[pid] || {};
    const status = item.status[pid] || "none";
    return `
      <div class="row">
        <div class="grow"><label for="st">Status on ${P.name}</label>
          <select id="st">${Object.entries(STATUS_LABEL).map(([k, lbl]) => `<option value="${k}" ${k === status ? "selected" : ""}>${lbl}</option>`).join("")}</select></div>
        <div class="grow"><label for="pp">Price on ${P.name} ($)</label><input id="pp" type="number" min="0" step="0.01" placeholder="${esc(item.price)}" value="${esc(item.prices?.[pid] || "")}"></div>
      </div>
      ${P.fields.map(([key, label, kind, max]) => `
        <div class="field-head"><label for="f-${key}">${label} ${max ? `<span class="count" data-count="${key}" data-max="${max}"></span>` : ""}</label>
          <button class="tiny" data-copy="${key}">Copy</button></div>
        ${kind === "text"
          ? `<textarea id="f-${key}" data-field="${key}" rows="${key === "description" ? 8 : 4}">${esc(v[key])}</textarea>`
          : `<input id="f-${key}" data-field="${key}" value="${esc(v[key])}">`}
      `).join("")}
    `;
  };

  const readForm = () => {
    const val = (id) => document.getElementById(id)?.value;
    if (val("price") !== undefined) item.price = val("price");
    if (val("cost") !== undefined) item.cost = val("cost");
    if (val("notes") !== undefined) item.notes = val("notes");
    if (item.listing) {
      document.querySelectorAll("[data-field]").forEach((el) => (item.listing[tab][el.dataset.field] = el.value));
      const pp = val("pp");
      if (pp !== undefined) item.prices = { ...item.prices, [tab]: pp };
      const st = val("st");
      if (st) item.status[tab] = st;
    }
  };

  const updateCounts = () => {
    document.querySelectorAll("[data-count]").forEach((el) => {
      const len = document.getElementById(`f-${el.dataset.count}`).value.length;
      el.textContent = `${len}/${el.dataset.max}`;
      el.classList.toggle("over", len > +el.dataset.max);
    });
  };

  const save = async (quiet) => {
    readForm();
    await putItem(item);
    if (isNew) {
      isNew = false;
      history.replaceState(null, "", `#/item/${item.id}`);
    }
    if (!quiet) toast("Saved");
  };

  const addFiles = async (files) => {
    readForm();
    const imgs = [...files].filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    for (const f of imgs) {
      try {
        item.photos.push(await fileToPhoto(f));
      } catch {
        toast(`Couldn't read ${f.name}. Try a JPEG or PNG.`, 3500);
      }
    }
    draw();
  };

  const wire = () => {
    const drop = document.getElementById("drop");
    const file = document.getElementById("file");
    drop.onclick = () => file.click();
    drop.onkeydown = (e) => (e.key === "Enter" || e.key === " ") && file.click();
    file.onchange = () => addFiles(file.files);
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
    drop.ondragleave = () => drop.classList.remove("over");
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); addFiles(e.dataTransfer.files); };

    document.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = () => { readForm(); item.photos.splice(+b.dataset.rm, 1); draw(); }));
    document.querySelectorAll("[data-cover]").forEach((b) => (b.onclick = () => {
      readForm();
      const [p] = item.photos.splice(+b.dataset.cover, 1);
      item.photos.unshift(p);
      draw();
    }));
    document.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => { readForm(); tab = b.dataset.tab; draw(); }));
    document.querySelectorAll("[data-copy]").forEach((b) => (b.onclick = () => copy(document.getElementById(`f-${b.dataset.copy}`).value)));
    document.querySelectorAll("[data-field]").forEach((el) => (el.oninput = updateCounts));
    updateCounts();

    const st = document.getElementById("st");
    if (st) st.onchange = async () => {
      readForm();
      // Sold on one site: flag the others so you remember to take them down.
      if (st.value === "sold") {
        for (const p of PIDS) if (p !== tab && item.status[p] === "listed") item.status[p] = "delist";
        const others = PIDS.filter((p) => item.status[p] === "delist").map((p) => PLATFORMS[p].name);
        if (others.length) toast(`Sold! Remember to remove it from ${others.join(" and ")}.`, 4000);
      }
      await save(true);
      draw();
    };

    document.getElementById("gen").onclick = async () => {
      readForm();
      busy = true;
      draw();
      try {
        const ai = await writeListings({ apiKey: settings.apiKey, photos: item.photos, price: item.price, notes: item.notes });
        item.ai = ai;
        item.listing = toEditable(ai);
        await save(true);
        toast("Listings written. Review them below.");
      } catch (err) {
        toast(err.message, 5000);
      } finally {
        busy = false;
        draw();
      }
    };

    document.getElementById("save").onclick = () => save(false);
    const del = document.getElementById("del");
    if (del) del.onclick = async () => {
      if (!confirm("Delete this item and its photos from this browser?")) return;
      await deleteItem(item.id);
      location.hash = "#/";
    };
    const send = document.getElementById("send");
    if (send) send.onclick = async () => {
      await save(true);
      send.disabled = true;
      try {
        await sendToExtension(item);
        toast("Sent. Open a sell page and use the Resell Lister panel.", 3500);
      } catch (err) {
        toast(err.message, 4500);
      } finally {
        send.disabled = false;
      }
    };
  };

  draw();
}

// ---------- settings ----------
function renderSettings() {
  const fees = settings.fees;
  $view.innerHTML = `
    <h1>Settings</h1>
    <div class="card">
      <h2>Claude API key</h2>
      <p class="small muted">Get one at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a> (you pay Anthropic per use, about 2 to 5 cents an item). The key is saved only in this browser and is sent only to Anthropic. Don't use this app on a shared computer.</p>
      <label for="key">API key</label>
      <input id="key" type="password" autocomplete="off" placeholder="sk-ant-…" value="${esc(settings.apiKey)}">
      <div class="row" style="margin-top:10px"><button class="primary" id="saveKey">Save key</button><button id="clearKey">Remove key</button></div>
    </div>
    <div class="card">
      <h2>Fee estimates</h2>
      <p class="small muted">Used for "You keep" numbers. Marketplaces change fees; update these if yours differ.</p>
      ${PIDS.map((p) => `
        <div class="row">
          <div class="grow"><label>${PLATFORMS[p].name} fee %</label><input data-fee="${p}.pct" type="number" step="0.1" value="${esc(fees[p].pct)}"></div>
          <div class="grow"><label>${PLATFORMS[p].name} fixed fee per sale ($)</label><input data-fee="${p}.fixed" type="number" step="0.01" value="${esc(fees[p].fixed)}"></div>
          ${p === "poshmark" ? `<div class="grow"><label>Poshmark flat fee under $15 ($)</label><input data-fee="poshmark.flatUnder15" type="number" step="0.01" value="${esc(fees.poshmark.flatUnder15)}"></div>` : ""}
        </div>`).join("")}
      <div class="row" style="margin-top:10px"><button class="primary" id="saveFees">Save fees</button><button id="resetFees">Reset</button></div>
    </div>
    <div class="card">
      <h2>Backup</h2>
      <p class="small muted">Items live in this browser only. Download a backup now and then, and to move to another device.</p>
      <div class="row"><button id="export">Download backup</button><label class="btn" style="margin:0">Restore backup<input id="import" type="file" accept="application/json" hidden></label></div>
    </div>
  `;
  document.getElementById("saveKey").onclick = () => {
    settings.apiKey = document.getElementById("key").value.trim();
    toast("Key saved in this browser");
  };
  document.getElementById("clearKey").onclick = () => {
    settings.apiKey = "";
    document.getElementById("key").value = "";
    toast("Key removed");
  };
  document.getElementById("saveFees").onclick = () => {
    const next = structuredClone(settings.fees);
    document.querySelectorAll("[data-fee]").forEach((el) => {
      const [p, k] = el.dataset.fee.split(".");
      next[p][k] = +el.value || 0;
    });
    settings.fees = next;
    toast("Fees saved");
  };
  document.getElementById("resetFees").onclick = () => { settings.fees = DEFAULT_FEES; renderSettings(); };
  document.getElementById("export").onclick = async () => {
    const blob = new Blob([JSON.stringify({ app: "resell-lister", version: 1, items: await allItems() })], { type: "application/json" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `resell-lister-backup-${new Date().toISOString().slice(0, 10)}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  document.getElementById("import").onchange = async (e) => {
    try {
      const data = JSON.parse(await e.target.files[0].text());
      if (data.app !== "resell-lister" || !Array.isArray(data.items)) throw new Error("not a backup");
      for (const it of data.items) await putItem(it);
      toast(`Restored ${data.items.length} items`);
    } catch {
      toast("That file isn't a Resell Lister backup.", 3500);
    }
  };
}

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
route();
