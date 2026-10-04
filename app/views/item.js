// Item form, in the same order as the listing flow: owner and marketplaces, photos + AI,
// item overview, item details, private info, then each marketplace's own details.
// Changes save automatically, and only the fields you changed are written, so two people
// working on different parts of an item don't overwrite each other.
import * as store from "../store.js";
import { onBeforeLeave } from "../pending.js";
import {
  PLATFORMS, PIDS, CONDITIONS, LISTING_STATUS, MAX_PHOTOS, RELIST_TIPS, settings, titleOf, priceFor, valueFor, statusOf,
  setListingStatus, markRelisted, droppedPrice, setListingStats, staleListings, daysListed, netAfterFees, money, copyOfItem,
  EBAY_PACKAGE_TYPES, EBAY_SERVICES, EBAY_COST_TYPES, HANDLING_TIMES, VINTED_SIZES, totalOz, fmtWeight, fmtDims,
  suggestVintedSize, suggestEbayType,
} from "../model.js";
import { writeListings, applyAi, DESCRIPTION_STYLES } from "../ai.js";
import { esc, toast, copyText, modal, toDateInput, fromDateInput, fmtDate } from "../ui.js";
import { sendToExtension, extensionReady, onExtensionReady } from "../extbridge.js";
import { members, nameOf } from "./people.js";

const STYLE_LABELS = { friendly: "Friendly", short: "Short & simple", detailed: "Detailed" };
// Every field the AI rewrites, so a regenerate saves all of them.
const AI_PATHS = ["overview.title", "overview.description", "overview.condition", "overview.price", "details", "market", "ai", "shipping"];

// Shrink photos: small enough for the free storage (about 150 KB each), sharp enough for listings and the AI.
async function fileToDataUrl(file, maxSide = 1280, quality = 0.8) {
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
    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}
async function thumbOf(dataUrl) {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const scale = Math.min(1, 320 / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.7);
}

export function renderItem($view, item, isNew) {
  let tab = PIDS.find((p) => item.marketplaces[p]) || PIDS[0];
  let busy = false;
  let saveTimer = null;
  let saving = Promise.resolve();
  let photosLoading = !isNew && item.photos.some((p) => !p.dataUrl);
  let remoteChange = null;
  let knownUpdatedAt = item.updatedAt;
  const dirty = new Set();
  const many = members().length > 1;

  // ---------- saving ----------
  const hasContent = () => item.photos.length || item.overview.title || item.overview.price || item.aiNotes;
  const setSaveState = (t) => { const s = document.getElementById("saveState"); if (s) s.textContent = t; };
  const doSave = async (hist) => {
    clearTimeout(saveTimer);
    if (isNew && !hasContent()) return;
    try {
      if (isNew) {
        item.history = [{ at: Date.now(), by: store.myUid(), act: "created" }];
        await store.putItem(item);
        isNew = false;
        dirty.clear();
        history.replaceState(null, "", `#/item/${encodeURIComponent(item.id)}`);
        // replaceState doesn't fire hashchange, so move the nav highlight from "Add item" ourselves.
        document.querySelectorAll("[data-nav]").forEach((a) => {
          const on = a.dataset.nav === "inventory";
          a.classList.toggle("active", on);
          on ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current");
        });
        if (hist) await store.saveFields(item, [], hist);
      } else if (dirty.size || hist) {
        const paths = [...dirty];
        dirty.clear();
        await store.saveFields(item, paths, hist);
      }
      knownUpdatedAt = item.updatedAt;
      setSaveState("All changes saved");
    } catch (err) {
      setSaveState("Not saved");
      toast(`Couldn't save: ${err.message}`, 6000);
    }
  };
  // Saves run one after another, never in parallel.
  const saveNow = (hist) => (saving = saving.then(() => doSave(hist)));
  const saveSoon = () => {
    setSaveState("Saving…");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveNow(), 500);
  };
  const mark = (...paths) => paths.forEach((p) => dirty.add(p));

  // Finish a pending save before another page reads the items, and stop watching for changes.
  let offChange = () => {};
  const leave = () => { offChange(); return dirty.size || saveTimer ? saveNow() : saving; };
  onBeforeLeave(leave);
  window.addEventListener("pagehide", () => saveNow(), { once: true });

  // Someone else changed this item while it's open: offer to load their version.
  offChange = store.onChange(async (what) => {
    if (what !== "items" || isNew) return;
    const fresh = await store.getItem(item.id);
    if (!fresh) { remoteChange = "deleted"; return showRemote(); }
    if (fresh.updatedAt > knownUpdatedAt && fresh.updatedBy !== store.myUid()) {
      remoteChange = nameOf(fresh.updatedBy);
      showRemote();
    }
  });
  const showRemote = () => {
    const el = document.getElementById("remoteBanner");
    if (!el) return;
    el.hidden = false;
    el.querySelector("span").textContent = remoteChange === "deleted"
      ? "This item was deleted by someone else in the household."
      : `${remoteChange} just changed this item.`;
  };

  // ---------- drawing ----------
  const draw = () => {
    const chosen = PIDS.filter((p) => item.marketplaces[p]);
    if (!chosen.includes(tab)) tab = chosen[0] || PIDS[0];
    const ai = item.ai;
    const O = item.overview, D = item.details;

    $view.innerHTML = `
      <div class="page-head">
        <h1>${isNew ? "Add item" : esc(titleOf(item))}</h1>
        <span class="muted small" id="saveState">${isNew ? "Not saved yet" : "All changes saved"}</span>
      </div>
      <div class="alert" id="remoteBanner" hidden role="status"><span></span> <button id="reload" class="tiny">Show latest</button></div>

      <section class="card">
        <div class="row">
          ${many ? `<div class="grow"><label for="owner">Belongs to</label>
            <select id="owner">${members().map((m) => `<option value="${esc(m.uid)}" ${m.uid === item.ownerUid ? "selected" : ""}>${esc(m.name)}${m.uid === store.myUid() ? " (me)" : ""}</option>`).join("")}
              ${item.ownerUid && !members().some((m) => m.uid === item.ownerUid) ? `<option value="${esc(item.ownerUid)}" selected>Former member</option>` : ""}</select></div>` : ""}
          <div class="grow" style="flex-basis:260px"><span class="label-like">Marketplaces</span>
            <div class="chips-row">${PIDS.map((p) => `
              <label class="chip-toggle"><input type="checkbox" data-mp="${p}" ${item.marketplaces[p] ? "checked" : ""}> ${PLATFORMS[p].name}</label>`).join("")}
            </div></div>
        </div>
      </section>

      <section class="card">
        <div class="section-head"><h2>Photos</h2><span class="muted small">${item.photos.length}/${MAX_PHOTOS} · first photo is the cover</span></div>
        <div class="drop" id="drop" tabindex="0" role="button" aria-label="Add photos">
          <strong>Add photos</strong><span class="small">Take or choose photos. Include the brand and size tags, and any flaws.</span>
          <input id="file" type="file" accept="image/*" multiple hidden>
        </div>
        ${photosLoading ? `<p class="muted small">Loading photos…</p>` : item.photos.length ? `<div class="thumbs">${item.photos.map((p, i) => `
          <div class="thumb">
            <img src="${esc(p.dataUrl)}" alt="Photo ${i + 1}">
            ${i === 0 ? `<span class="cover">Cover</span>` : ""}
            <button class="tiny x" data-rm="${i}" aria-label="Remove photo ${i + 1}">×</button>
            <span class="thumb-moves">
              <button class="tiny" data-mv="${i}" data-dir="-1" ${i === 0 ? "disabled" : ""} aria-label="Move photo ${i + 1} left">‹</button>
              <button class="tiny" data-mv="${i}" data-dir="1" ${i === item.photos.length - 1 ? "disabled" : ""} aria-label="Move photo ${i + 1} right">›</button>
            </span>
          </div>`).join("")}</div>` : ""}

        <div class="ai-box">
          <div class="ai-head"><span class="ai-badge">AI</span><h3>Generate listing</h3></div>
          <p class="small">AI reads your photos (up to 8) and fills in the title, description, condition, item details and each marketplace's category and specifics. It replaces the listing text below; your price, cost, SKU, notes and labels stay.</p>
          <label for="aiNotes">Notes for the AI (optional)</label>
          <textarea id="aiNotes" data-path="aiNotes" rows="2" placeholder="Anything the photos don't show: measurements, flaws, smoke-free home…">${esc(item.aiNotes)}</textarea>
          <div class="row">
            <label class="inline" for="style">Description style</label>
            <select id="style" class="auto">${Object.keys(DESCRIPTION_STYLES).map((k) => `<option value="${k}" ${k === settings.descStyle ? "selected" : ""}>${STYLE_LABELS[k]}</option>`).join("")}</select>
            <button class="ai-btn" id="gen" ${busy || photosLoading ? "disabled" : ""}>${busy ? `<span class="spinner"></span> Generating…` : ai ? "Regenerate listing" : "Generate listing"}</button>
          </div>
          ${!settings.apiKey ? `<p class="small">First add a Claude API key in <a href="#/settings">Settings</a>. Everything else in the app works without it.</p>`
            : `<p class="small muted">Uses the Claude API key on this device: roughly ${settings.model === "claude-sonnet-5-5" ? "3 to 8" : "5 to 15"} cents per item (more photos cost more).</p>`}
          ${ai ? `
          <div class="ai-result">
            <div><span class="muted small">AI price idea</span><b>${money(ai.pricing?.suggested_price)}</b><span class="small muted">quick sale ${money(ai.pricing?.quick_sale_price)} · ${esc(ai.pricing?.confidence)} confidence</span></div>
            <p class="small">${esc(ai.pricing?.reasoning)} <span class="muted">An estimate from the photos, not live sold prices.</span></p>
            ${ai.flaws?.length ? `<p class="small"><b>Flaws spotted:</b> ${esc(ai.flaws.join("; "))}</p>` : ""}
            ${ai.check_before_posting?.length ? `<p class="small"><b>Check before posting</b></p><ul class="todo small">${ai.check_before_posting.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}
          </div>` : ""}
        </div>
      </section>

      <section class="card">
        <h2>Item overview</h2>
        <p class="muted small">Shared by every marketplace unless you change it in that marketplace's section below.</p>
        ${fieldHtml("overview.title", "Title", O.title, "line", 80)}
        ${fieldHtml("overview.description", "Description", O.description, "text")}
        <div class="row">
          <div class="grow"><label for="f-overview-condition">Condition</label>
            <select id="f-overview-condition" data-path="overview.condition"><option value="">Choose…</option>${CONDITIONS.map((c) => `<option ${c === O.condition ? "selected" : ""}>${c}</option>`).join("")}</select></div>
          <div class="grow"><label for="f-overview-price">Price ($)</label><input id="f-overview-price" data-path="overview.price" type="number" inputmode="decimal" min="0" step="0.01" value="${esc(O.price)}"></div>
          <div class="grow"><label for="f-overview-cost">Cost of goods ($)</label><input id="f-overview-cost" data-path="overview.cost" type="number" inputmode="decimal" min="0" step="0.01" value="${esc(O.cost)}"></div>
          <div class="grow"><label for="f-overview-sku">SKU</label><input id="f-overview-sku" data-path="overview.sku" value="${esc(O.sku)}" placeholder="e.g. BIN3-014"></div>
        </div>
        ${O.price ? `<p class="small muted">You keep about ${chosen.map((p) => `${PLATFORMS[p].name} ${money(netAfterFees(p, priceFor(item, p)))}`).join(" · ")} after fees${O.cost ? `, before your ${money(O.cost)} cost` : ""}.</p>` : ""}
      </section>

      <section class="card">
        <h2>Item details</h2>
        <div class="row">
          <div class="grow">${fieldHtml("details.category", "Category", D.category, "line")}</div>
          <div class="grow">${fieldHtml("details.brand", "Brand", D.brand, "line")}</div>
        </div>
        <div class="row">
          <div class="grow">${fieldHtml("details.size", "Size", D.size, "line")}</div>
          <div class="grow">${fieldHtml("details.colors", "Colors", D.colors, "line")}</div>
          <div class="grow">${fieldHtml("details.style_tags", "Style tags", D.style_tags, "line")}</div>
        </div>
      </section>

      ${shippingCard(chosen)}

      <section class="card">
        <h2>Private</h2>
        <p class="muted small">Never posted to a marketplace. Everyone in your household can see it.</p>
        <label for="privateNotes">Private notes</label>
        <textarea id="privateNotes" data-path="privateNotes" rows="2" placeholder="Where you bought it, storage bin, anything for the household only">${esc(item.privateNotes)}</textarea>
        <label for="labels">Labels (comma-separated)</label>
        <input id="labels" value="${esc((item.labels || []).join(", "))}" placeholder="e.g. Summer, Bin 3, Consigned">
      </section>

      ${chosen.length ? `
      <section class="card">
        <h2>Marketplace details</h2>
        <p class="muted small">Blank fields use the item overview and details (shown in grey). Copy buttons copy exactly what will be posted.</p>
        <div class="tabs" role="tablist">${chosen.map((p) => `<button role="tab" aria-selected="${p === tab}" data-tab="${p}" class="${p === tab ? "on" : ""}">${PLATFORMS[p].name} <span class="pill-mini s-${statusOf(item, p)} ${staleListings(item).includes(p) ? "stale" : ""}">${staleListings(item).includes(p) ? "Relist" : LISTING_STATUS[statusOf(item, p)]}</span></button>`).join("")}</div>
        ${marketPanel(tab)}
      </section>` : `<section class="card"><p class="muted">Pick at least one marketplace above.</p></section>`}

      <div class="footer-bar">
        <button class="primary" id="done">Done</button>
        <button id="send" ${!chosen.length ? "disabled" : ""}>Send to extension</button>
        ${!isNew ? `<button id="copyItem">Copy item</button><button class="danger" id="del">Delete</button>` : ""}
      </div>
      <p class="small muted" data-ext-hint ${extensionReady() ? "hidden" : ""}>The Chrome extension fills the sell forms for you on a computer. It isn't detected in this browser, so use the copy buttons, or see Settings to install it.</p>
    `;
    wire();
    if (remoteChange) showRemote();
  };

  // ---------- shipping & package ----------
  const opt = (value, label, current) => `<option value="${esc(value)}" ${String(value) === String(current ?? "") ? "selected" : ""}>${esc(label)}</option>`;
  const num = (path, label, value, attrs = "") => `<div class="grow"><label for="f-${path.replace(/\./g, "-")}">${label}</label><input id="f-${path.replace(/\./g, "-")}" data-path="${path}" type="number" inputmode="decimal" min="0" ${attrs} value="${esc(value ?? "")}"></div>`;
  const shippingCard = (chosen) => {
    const sh = item.shipping || {};
    const presets = settings.packaging;
    return `
      <section class="card" id="shipCard">
        <h2>Shipping & package</h2>
        <p class="muted small">Weigh it packed. eBay needs the weight and box size; Vinted needs a parcel size.${sh.aiGuess ? ` <b class="warn-text" id="aiShipWarn">The weight and package below are AI guesses from the photos. Weigh it to be sure.</b>` : ""}</p>
        <label for="pkg">Packaging</label>
        <select id="pkg">
          <option value="">Choose packaging…</option>
          ${presets.map((p) => opt(p.id, `${p.name} (${p.length}×${p.width}×${p.height} in)`, sh.presetId)).join("")}
          ${opt("custom", "Custom size", sh.presetId)}
        </select>
        <p class="small muted">Edit the packaging list in Settings.</p>
        <div class="row tight">
          ${num("shipping.weightLb", "Packed weight (lb)", sh.weightLb, 'step="1"')}
          ${num("shipping.weightOz", "+ ounces (oz)", sh.weightOz, 'step="0.1" max="15.9"')}
        </div>
        <div class="row tight">
          ${num("shipping.length", "Length (in)", sh.length, 'step="0.5"')}
          ${num("shipping.width", "Width (in)", sh.width, 'step="0.5"')}
          ${num("shipping.height", "Height (in)", sh.height, 'step="0.5"')}
        </div>
        <p class="small" id="shipSummary"></p>

        ${chosen.includes("ebay") ? `
        <h3 class="ship-h">eBay</h3>
        <div class="row">
          <div class="grow"><label for="f-shipping-ebayPackageType">Package type</label>
            <select id="f-shipping-ebayPackageType" data-path="shipping.ebayPackageType"><option value="">Choose…</option>${EBAY_PACKAGE_TYPES.map((t) => opt(t, t, sh.ebayPackageType)).join("")}</select>
            <span class="small muted" id="ebayHint"></span></div>
          <div class="grow"><label for="f-shipping-ebayService">Shipping service</label>
            <select id="f-shipping-ebayService" data-path="shipping.ebayService"><option value="">Choose…</option>${EBAY_SERVICES.map((t) => opt(t, t, sh.ebayService)).join("")}</select></div>
        </div>
        <div class="row">
          <div class="grow"><label for="f-shipping-ebayCostType">Who pays shipping</label>
            <select id="f-shipping-ebayCostType" data-path="shipping.ebayCostType"><option value="">Choose…</option>${Object.entries(EBAY_COST_TYPES).map(([k, v]) => opt(k, v, sh.ebayCostType)).join("")}</select></div>
          <div class="grow" id="flatRow" ${sh.ebayCostType === "flat" ? "" : "hidden"}>${num("shipping.ebayFlatCost", "Flat shipping charge ($)", sh.ebayFlatCost, 'step="0.01"').replace(/^<div class="grow">|<\/div>$/g, "")}</div>
          <div class="grow"><label for="f-shipping-handlingDays">Handling time</label>
            <select id="f-shipping-handlingDays" data-path="shipping.handlingDays"><option value="">Choose…</option>${Object.entries(HANDLING_TIMES).map(([k, v]) => opt(k, v, sh.handlingDays)).join("")}</select></div>
        </div>` : ""}

        ${chosen.includes("vinted") ? `
        <h3 class="ship-h">Vinted</h3>
        <div class="row">
          <div class="grow"><label for="f-shipping-vintedSize">Parcel size</label>
            <select id="f-shipping-vintedSize" data-path="shipping.vintedSize"><option value="">Choose…</option>${Object.entries(VINTED_SIZES).map(([k, v]) => opt(k, v, sh.vintedSize)).join("")}</select>
            <span class="small muted" id="vintedHint"></span></div>
        </div>
        <p class="small muted">Size limits are from Vinted's published guide; check Vinted's own size guide if it doesn't match.</p>` : ""}

        ${chosen.includes("poshmark") ? `<p class="small muted"><b>Poshmark</b> sends the buyer a prepaid label, so there's nothing to choose for most items. For heavy items, pick the weight Poshmark asks for using the weight above.</p>` : ""}
      </section>`;
  };

  // Live hints: suggested Vinted size and eBay package type, and a one-line summary with copy.
  const updateShipHints = () => {
    const sh = item.shipping || {};
    const oz = totalOz(sh);
    const sum = document.getElementById("shipSummary");
    if (sum) sum.innerHTML = oz || fmtDims(sh)
      ? `<b>${esc([fmtWeight(sh), fmtDims(sh)].filter(Boolean).join(" · "))}</b> <button class="tiny" type="button" id="copyShip">Copy</button>`
      : `<span class="muted">Add the weight and size.</span>`;
    const copyShip = document.getElementById("copyShip");
    if (copyShip) copyShip.onclick = () => copyText([fmtWeight(sh), fmtDims(sh)].filter(Boolean).join(", "));
    const vs = suggestVintedSize(oz), vh = document.getElementById("vintedHint");
    if (vh) vh.textContent = vs && vs !== sh.vintedSize ? `Suggested from the weight: ${vs}` : "";
    const et = suggestEbayType(sh), eh = document.getElementById("ebayHint");
    if (eh) eh.textContent = et && et !== sh.ebayPackageType ? `Suggested from the size: ${et}` : "";
  };

  const fieldHtml = (path, label, value, kind, max = 0, placeholder = "") => {
    const id = `f-${path.replace(/\./g, "-")}`;
    return `
      <div class="field-head"><label for="${id}">${label} ${max ? `<span class="count" data-count="${id}" data-max="${max}"></span>` : ""}</label>
        <button class="tiny" data-copy="${id}" type="button">Copy</button></div>
      ${kind === "text"
        ? `<textarea id="${id}" data-path="${path}" rows="${label === "Description" ? 7 : 4}" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
        : `<input id="${id}" data-path="${path}" value="${esc(value)}" placeholder="${esc(placeholder)}">`}`;
  };

  const marketPanel = (pid) => {
    const P = PLATFORMS[pid];
    const l = item.listings[pid] || { status: "none" };
    const m = item.market[pid] || {};
    const stale = staleListings(item).includes(pid);
    return `
      <div class="row">
        <div class="grow"><label for="st">Status on ${P.name}</label>
          <select id="st">${Object.entries(LISTING_STATUS).map(([k, lbl]) => `<option value="${k}" ${k === l.status ? "selected" : ""}>${lbl}</option>`).join("")}</select></div>
        <div class="grow"><label for="f-mp-price">Price on ${P.name} ($)</label>
          <input id="f-mp-price" data-path="market.${pid}.price" type="number" min="0" step="0.01" placeholder="${esc(item.overview.price)}" value="${esc(m.price || "")}"></div>
        ${l.status === "sold" ? `
        <div class="grow"><label for="soldPrice">Sold for ($)</label><input id="soldPrice" type="number" min="0" step="0.01" placeholder="${esc(priceFor(item, pid))}" value="${esc(l.soldPrice)}"></div>
        <div class="grow"><label for="soldAt">Sale date</label><input id="soldAt" type="date" value="${toDateInput(l.soldAt)}"></div>` : ""}
      </div>
      ${l.status === "listed" ? `
      <div class="relist-box ${stale ? "is-stale" : ""}">
        <p class="small"><b>${stale ? "Needs a refresh: " : ""}Listed ${daysListed(l)} day${daysListed(l) === 1 ? "" : "s"}</b>
          · since ${fmtDate(l.relistedAt || l.listedAt)}${l.relistCount ? ` · relisted ${l.relistCount}×` : ""}</p>
        <div class="row">
          <div class="grow"><label for="views">Views</label><input id="views" type="number" min="0" inputmode="numeric" value="${esc(l.views ?? "")}"></div>
          <div class="grow"><label for="likes">${pid === "ebay" ? "Watchers" : pid === "vinted" ? "Favourites" : "Likes"}</label><input id="likes" type="number" min="0" inputmode="numeric" value="${esc(l.likes ?? "")}"></div>
        </div>
        <div class="row" style="margin-top:10px">
          <button id="relisted" class="${stale ? "primary" : ""}">Mark relisted</button>
          <button id="drop10">Drop price 10% (${money(priceFor(item, pid))} → ${money(droppedPrice(priceFor(item, pid)))})</button>
        </div>
        ${stale ? `<ul class="todo small">${RELIST_TIPS[pid].map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}
      </div>` : ""}
      <p class="small"><a href="${P.sellUrl}" target="_blank" rel="noopener">Open the ${P.name} sell page ↗</a></p>
      ${P.fields.map(([key, label, kind, max, fb]) => {
        const fallback = fb ? (item.overview[fb] ?? item.details[fb] ?? "") : "";
        return fieldHtml(`market.${pid}.${key}`, label, m[key] || "", kind, max, fallback);
      }).join("")}`;
  };

  // ---------- reading inputs ----------
  const setPath = (path, value) => {
    const keys = path.split(".");
    let o = item;
    for (const k of keys.slice(0, -1)) o = o[k] ??= {};
    o[keys.at(-1)] = value;
    mark(path);
  };
  const getPath = (path) => path.split(".").reduce((o, k) => o?.[k], item);

  const updateCounts = () => {
    document.querySelectorAll("[data-count]").forEach((el) => {
      const input = document.getElementById(el.dataset.count);
      const len = (input.value || input.placeholder).length;
      el.textContent = `${len}/${el.dataset.max}`;
      el.classList.toggle("over", len > +el.dataset.max);
    });
  };

  const refreshCover = async () => {
    item.cover = item.photos[0]?.dataUrl ? await thumbOf(item.photos[0].dataUrl) : "";
    mark("photos", "cover");
  };

  const addFiles = async (files) => {
    const room = MAX_PHOTOS - item.photos.length;
    const imgs = [...files].filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    if (imgs.length > room) toast(`Only ${MAX_PHOTOS} photos per item. Added the first ${Math.max(room, 0)}.`, 3500);
    setSaveState("Uploading photos…");
    for (const f of imgs.slice(0, Math.max(room, 0))) {
      try {
        const dataUrl = await fileToDataUrl(f);
        item.photos.push(await store.addPhoto(item, dataUrl));
      } catch (err) {
        toast(/decode|source image/i.test(err.message) ? `Couldn't read ${f.name}. Try a JPEG or PNG.` : `Photo not saved: ${err.message}`, 4000);
      }
    }
    await refreshCover();
    await saveNow();
    draw();
  };

  // ---------- wiring ----------
  const wire = () => {
    // Every field with data-path writes straight into the item and autosaves.
    document.querySelectorAll("[data-path]").forEach((el) => {
      const handler = () => {
        setPath(el.dataset.path, el.value);
        if (el.dataset.path.startsWith("shipping.")) {
          if (item.shipping.aiGuess && /weight|length|width|height/.test(el.dataset.path)) {
            item.shipping.aiGuess = false;
            mark("shipping.aiGuess");
            document.getElementById("aiShipWarn")?.remove();
          }
          if (el.dataset.path === "shipping.ebayCostType") document.getElementById("flatRow").hidden = el.value !== "flat";
          updateShipHints();
        }
        updateCounts();
        saveSoon();
      };
      el.addEventListener(el.tagName === "SELECT" ? "change" : "input", handler);
    });
    updateCounts();

    updateShipHints();
    document.getElementById("pkg").onchange = (e) => {
      const p = settings.packaging.find((x) => x.id === e.target.value);
      item.shipping = { ...(item.shipping || {}), presetId: e.target.value };
      if (p) Object.assign(item.shipping, { length: p.length, width: p.width, height: p.height, ...(p.ebayType ? { ebayPackageType: p.ebayType } : {}), ...(p.vintedSize ? { vintedSize: p.vintedSize } : {}) });
      mark("shipping");
      saveSoon();
      draw();
    };

    document.getElementById("labels").oninput = (e) => {
      item.labels = [...new Set(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))];
      mark("labels");
      saveSoon();
    };
    document.querySelectorAll("[data-mp]").forEach((c) => (c.onchange = () => { item.marketplaces[c.dataset.mp] = c.checked; mark(`marketplaces.${c.dataset.mp}`); saveSoon(); draw(); }));
    const owner = document.getElementById("owner");
    if (owner) owner.onchange = async () => {
      item.ownerUid = owner.value;
      mark("ownerUid");
      await saveNow({ act: "owner", info: members().find((m) => m.uid === owner.value)?.name || "member" });
    };

    // Copy buttons copy what will actually be posted (own value, else the shared one).
    document.querySelectorAll("[data-copy]").forEach((b) => (b.onclick = () => {
      const el = document.getElementById(b.dataset.copy);
      const m = el.dataset.path.match(/^market\.(\w+)\.(\w+)$/);
      copyText(m ? (m[2] === "price" ? priceFor(item, m[1]) : valueFor(item, m[1], m[2])) : getPath(el.dataset.path) ?? "");
    }));

    const drop = document.getElementById("drop");
    const file = document.getElementById("file");
    drop.onclick = () => file.click();
    drop.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); file.click(); } };
    file.onchange = () => addFiles(file.files);
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
    drop.ondragleave = () => drop.classList.remove("over");
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); addFiles(e.dataTransfer.files); };
    document.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = async () => {
      const [gone] = item.photos.splice(+b.dataset.rm, 1);
      await refreshCover();
      draw();
      await saveNow();
      store.removePhoto(gone.id).catch(() => {});
    }));
    document.querySelectorAll("[data-mv]").forEach((b) => (b.onclick = async () => {
      const i = +b.dataset.mv, j = i + +b.dataset.dir;
      [item.photos[i], item.photos[j]] = [item.photos[j], item.photos[i]];
      if (i === 0 || j === 0) await refreshCover(); else mark("photos");
      saveSoon();
      draw();
    }));

    document.getElementById("style").onchange = (e) => (settings.descStyle = e.target.value);
    document.getElementById("gen").onclick = generate;

    document.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => { tab = b.dataset.tab; draw(); }));
    const st = document.getElementById("st");
    if (st) st.onchange = async () => {
      setListingStatus(item, tab, st.value);
      mark(`listings.${tab}`);
      if (st.value === "sold") {
        const others = PIDS.filter((p) => p !== tab && statusOf(item, p) === "listed").map((p) => PLATFORMS[p].name);
        if (others.length) toast(`Sold! Now remove it from ${others.join(" and ")}.`, 5000);
      }
      await saveNow({ act: st.value, pid: tab });
      draw();
    };
    const soldPrice = document.getElementById("soldPrice");
    if (soldPrice) soldPrice.oninput = () => { item.listings[tab].soldPrice = soldPrice.value; mark(`listings.${tab}`); saveSoon(); };
    const soldAt = document.getElementById("soldAt");
    if (soldAt) soldAt.onchange = () => { item.listings[tab].soldAt = fromDateInput(soldAt.value); mark(`listings.${tab}`); saveSoon(); };

    // Relist tools (shown while listed).
    const views = document.getElementById("views"), likes = document.getElementById("likes");
    const statsChanged = () => { setListingStats(item, tab, views.value, likes.value); mark(`listings.${tab}`); saveSoon(); };
    if (views) { views.oninput = statsChanged; likes.oninput = statsChanged; }
    const relisted = document.getElementById("relisted");
    if (relisted) relisted.onclick = async () => {
      markRelisted(item, tab);
      mark(`listings.${tab}`);
      await saveNow({ act: "relisted", pid: tab });
      toast(`Relisted on ${PLATFORMS[tab].name}. The clock restarts today.`);
      draw();
    };
    const drop10 = document.getElementById("drop10");
    if (drop10) drop10.onclick = async () => {
      const np = droppedPrice(priceFor(item, tab));
      if (!np) return toast("Add a price first.");
      item.market[tab] = { ...(item.market[tab] || {}), price: np };
      mark(`market.${tab}.price`);
      await saveNow({ act: "price", pid: tab, info: np });
      toast(`New ${PLATFORMS[tab].name} price ${money(np)}. Change it on ${PLATFORMS[tab].name} too.`, 4000);
      draw();
    };

    const reload = document.getElementById("reload");
    if (reload) reload.onclick = async () => {
      await saveNow();
      if (remoteChange === "deleted") return (location.hash = "#/inventory");
      const fresh = await store.getItem(item.id);
      remoteChange = null;
      Object.assign(item, fresh, { photos: fresh.photos });
      knownUpdatedAt = item.updatedAt;
      photosLoading = item.photos.some((p) => !p.dataUrl);
      draw();
      if (photosLoading) loadPhotosNow();
    };

    document.getElementById("done").onclick = async () => { await saveNow(); location.hash = "#/inventory"; };
    document.getElementById("send").onclick = async (e) => {
      if (!hasContent()) return toast("Add photos or a title first.");
      e.target.disabled = true;
      try {
        await saveNow();
        await sendToExtension(item);
        toast("Sent. Open a sell page and click the Resell Lister button.", 4000);
      } catch (err) { toast(err.message, 4500); }
      finally { e.target.disabled = false; }
    };
    const copyBtn = document.getElementById("copyItem");
    if (copyBtn) copyBtn.onclick = async () => {
      await saveNow();
      copyBtn.disabled = true;
      toast("Copying…");
      try {
        const c = copyOfItem(item);
        c.ownerUid = c.createdBy = store.myUid();
        c.history = [{ at: Date.now(), by: store.myUid(), act: "created" }];
        await store.copyItemWithPhotos(item, c);
        location.hash = `#/item/${encodeURIComponent(c.id)}`;
        toast("Copied. You're editing the copy.");
      } catch (err) { toast(err.message, 5000); copyBtn.disabled = false; }
    };
    const del = document.getElementById("del");
    if (del) del.onclick = async () => {
      const res = await modal("Delete this item?", "<p>This removes the item and its photos for everyone in the household. It doesn't touch your live listings.</p>", [{ value: "yes", label: "Delete", danger: true }]);
      if (!res) return;
      clearTimeout(saveTimer);
      dirty.clear();
      try { await store.deleteItem(item); location.hash = "#/inventory"; }
      catch (err) { toast(err.message, 5000); }
    };
    onExtensionReady(() => document.querySelectorAll("[data-ext-hint]").forEach((el) => (el.hidden = true)));
  };

  const generate = async () => {
    if (!settings.apiKey) return toast("Add your Claude API key in Settings first.", 3500);
    if (!item.photos.length) return toast("Add at least one photo first.", 3500);
    if (item.ai) {
      const ok = await modal("Regenerate the listing?", "<p>This replaces the title, description, details and marketplace text with a new AI version. Price, cost, SKU, notes, labels and statuses stay.</p>", [{ value: "yes", label: "Regenerate", primary: true }]);
      if (!ok) return;
    }
    busy = true;
    draw();
    try {
      const packaging = settings.packaging;
      const ai = await writeListings({ apiKey: settings.apiKey, model: settings.model, photos: item.photos, price: item.overview.price, notes: item.aiNotes, style: settings.descStyle, packaging: packaging.map((p) => p.name) });
      applyAi(item, ai, packaging);
      if (!item.overview.price && ai.pricing?.suggested_price) item.overview.price = String(ai.pricing.suggested_price);
      mark(...AI_PATHS);
      await saveNow({ act: "ai" });
      toast("Listing generated. Review it below.");
    } catch (err) {
      toast(err.message, 6000);
    } finally {
      busy = false;
      draw();
    }
  };

  const loadPhotosNow = async () => {
    try { await store.loadPhotos(item); }
    catch (err) { toast(`Photos didn't load: ${err.message}`, 5000); }
    photosLoading = false;
    draw();
  };

  draw();
  if (photosLoading) loadPhotosNow();
}
