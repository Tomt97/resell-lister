// Item form, in the same order as the listing flow: marketplaces, photos + AI,
// item overview, item details, private info, then each marketplace's own details.
// Changes save automatically.
import { putItem, deleteItem, onBeforeLeave } from "../db.js";
import {
  PLATFORMS, PIDS, CONDITIONS, LISTING_STATUS, MAX_PHOTOS, settings, titleOf, priceFor, valueFor, statusOf,
  setListingStatus, netAfterFees, money, uid, copyOfItem,
} from "../model.js";
import { writeListings, applyAi, DESCRIPTION_STYLES } from "../ai.js";
import { esc, toast, copyText, modal, toDateInput, fromDateInput } from "../ui.js";
import { sendToExtension, extensionReady, onExtensionReady } from "../extbridge.js";

const STYLE_LABELS = { friendly: "Friendly", short: "Short & simple", detailed: "Detailed" };

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

export function renderItem($view, item, isNew) {
  let tab = PIDS.find((p) => item.marketplaces[p]) || PIDS[0];
  let busy = false;
  let saveTimer = null;
  let saved = !isNew;

  // ---------- saving ----------
  const hasContent = () => item.photos.length || item.overview.title || item.overview.price || item.aiNotes;
  const saveNow = async () => {
    clearTimeout(saveTimer);
    if (isNew && !hasContent()) return;
    await putItem(item);
    item.updatedAt = Date.now();
    if (isNew) {
      isNew = false;
      history.replaceState(null, "", `#/item/${encodeURIComponent(item.id)}`);
      // replaceState doesn't fire hashchange, so move the nav highlight from "Add item" ourselves.
      document.querySelectorAll("[data-nav]").forEach((a) => {
        const on = a.dataset.nav === "inventory";
        a.classList.toggle("active", on);
        on ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current");
      });
    }
    saved = true;
    const s = document.getElementById("saveState");
    if (s) s.textContent = "All changes saved";
  };
  const saveSoon = () => {
    saved = false;
    const s = document.getElementById("saveState");
    if (s) s.textContent = "Saving…";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 500);
  };
  // Finish a pending save before another page reads the items (and when the tab closes).
  const flush = () => (saved ? undefined : saveNow());
  onBeforeLeave(flush);
  window.addEventListener("pagehide", flush, { once: true });

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

      <section class="card">
        <h2>Marketplaces</h2>
        <p class="muted small">Where you want to list this item.</p>
        <div class="chips-row">${PIDS.map((p) => `
          <label class="chip-toggle"><input type="checkbox" data-mp="${p}" ${item.marketplaces[p] ? "checked" : ""}> ${PLATFORMS[p].name}</label>`).join("")}
        </div>
      </section>

      <section class="card">
        <div class="section-head"><h2>Photos</h2><span class="muted small">${item.photos.length}/${MAX_PHOTOS} · first photo is the cover</span></div>
        <div class="drop" id="drop" tabindex="0" role="button" aria-label="Add photos">
          <strong>Add photos</strong><span class="small">Tap to choose, or drag them here. Include the brand and size tags, and any flaws.</span>
          <input id="file" type="file" accept="image/*" multiple hidden>
        </div>
        ${item.photos.length ? `<div class="thumbs">${item.photos.map((p, i) => `
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
            <button class="ai-btn" id="gen" ${busy ? "disabled" : ""}>${busy ? `<span class="spinner"></span> Generating…` : ai ? "Regenerate listing" : "Generate listing"}</button>
          </div>
          ${!settings.apiKey ? `<p class="small">First add your Claude API key in <a href="#/settings">Settings</a>.</p>` : `<p class="small muted">Costs about 2 to 5 cents on your Claude API key.</p>`}
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

      <section class="card">
        <h2>Only you see this</h2>
        <label for="privateNotes">Private notes</label>
        <textarea id="privateNotes" data-path="privateNotes" rows="2" placeholder="Where you bought it, storage bin, anything for you only">${esc(item.privateNotes)}</textarea>
        <label for="labels">Labels (comma-separated)</label>
        <input id="labels" value="${esc((item.labels || []).join(", "))}" placeholder="e.g. Summer, Bin 3, Consigned">
      </section>

      ${chosen.length ? `
      <section class="card">
        <h2>Marketplace details</h2>
        <p class="muted small">Blank fields use the item overview and details (shown in grey). Copy buttons copy exactly what will be posted.</p>
        <div class="tabs" role="tablist">${chosen.map((p) => `<button role="tab" aria-selected="${p === tab}" data-tab="${p}" class="${p === tab ? "on" : ""}">${PLATFORMS[p].name} <span class="pill-mini s-${statusOf(item, p)}">${LISTING_STATUS[statusOf(item, p)]}</span></button>`).join("")}</div>
        ${marketPanel(tab)}
      </section>` : `<section class="card"><p class="muted">Pick at least one marketplace above.</p></section>`}

      <div class="footer-bar">
        <button class="primary" id="done">Done</button>
        <button id="send" ${!chosen.length ? "disabled" : ""}>Send to extension</button>
        ${!isNew ? `<button id="copyItem">Copy item</button><button class="danger" id="del">Delete</button>` : ""}
      </div>
      <p class="small muted" data-ext-hint ${extensionReady() ? "hidden" : ""}>The Chrome extension fills the sell forms for you on a computer. It isn't detected in this browser. See Settings to install it, or use the copy buttons.</p>
    `;
    wire();
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

  const addFiles = async (files) => {
    const room = MAX_PHOTOS - item.photos.length;
    const imgs = [...files].filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    if (imgs.length > room) toast(`Only ${MAX_PHOTOS} photos per item. Added the first ${Math.max(room, 0)}.`, 3500);
    for (const f of imgs.slice(0, Math.max(room, 0))) {
      try { item.photos.push(await fileToPhoto(f)); }
      catch { toast(`Couldn't read ${f.name}. Try a JPEG or PNG.`, 3500); }
    }
    await saveNow();
    draw();
  };

  // ---------- wiring ----------
  const wire = () => {
    // Every field with data-path writes straight into the item and autosaves.
    document.querySelectorAll("[data-path]").forEach((el) => {
      const handler = () => { setPath(el.dataset.path, el.value); updateCounts(); saveSoon(); };
      el.addEventListener(el.tagName === "SELECT" ? "change" : "input", handler);
    });
    updateCounts();

    document.getElementById("labels").oninput = (e) => {
      item.labels = [...new Set(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))];
      saveSoon();
    };
    document.querySelectorAll("[data-mp]").forEach((c) => (c.onchange = () => { item.marketplaces[c.dataset.mp] = c.checked; saveSoon(); draw(); }));

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
    document.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = () => { item.photos.splice(+b.dataset.rm, 1); saveSoon(); draw(); }));
    document.querySelectorAll("[data-mv]").forEach((b) => (b.onclick = () => {
      const i = +b.dataset.mv, j = i + +b.dataset.dir;
      [item.photos[i], item.photos[j]] = [item.photos[j], item.photos[i]];
      saveSoon();
      draw();
    }));

    document.getElementById("style").onchange = (e) => (settings.descStyle = e.target.value);
    document.getElementById("gen").onclick = generate;

    document.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => { tab = b.dataset.tab; draw(); }));
    const st = document.getElementById("st");
    if (st) st.onchange = async () => {
      if (st.value === "sold") {
        setListingStatus(item, tab, "sold");
        const others = PIDS.filter((p) => p !== tab && statusOf(item, p) === "listed").map((p) => PLATFORMS[p].name);
        if (others.length) toast(`Sold! Now remove it from ${others.join(" and ")}.`, 5000);
      } else {
        setListingStatus(item, tab, st.value);
      }
      await saveNow();
      draw();
    };
    const soldPrice = document.getElementById("soldPrice");
    if (soldPrice) soldPrice.oninput = () => { item.listings[tab].soldPrice = soldPrice.value; saveSoon(); };
    const soldAt = document.getElementById("soldAt");
    if (soldAt) soldAt.onchange = () => { item.listings[tab].soldAt = fromDateInput(soldAt.value); saveSoon(); };

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
      const c = copyOfItem(item);
      await putItem(c);
      location.hash = `#/item/${encodeURIComponent(c.id)}`;
      toast("Copied. You're editing the copy.");
    };
    const del = document.getElementById("del");
    if (del) del.onclick = async () => {
      const res = await modal("Delete this item?", "<p>This removes the item and its photos from this browser. It doesn't touch your live listings.</p>", [{ value: "yes", label: "Delete", danger: true }]);
      if (!res) return;
      clearTimeout(saveTimer);
      saved = true;
      await deleteItem(item.id);
      location.hash = "#/inventory";
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
      const ai = await writeListings({ apiKey: settings.apiKey, photos: item.photos, price: item.overview.price, notes: item.aiNotes, style: settings.descStyle });
      applyAi(item, ai);
      if (!item.overview.price && ai.pricing?.suggested_price) item.overview.price = String(ai.pricing.suggested_price);
      await saveNow();
      toast("Listing generated. Review it below.");
    } catch (err) {
      toast(err.message, 6000);
    } finally {
      busy = false;
      draw();
    }
  };

  draw();
}
