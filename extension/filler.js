// Adds a "Resell Lister" panel to the eBay, Poshmark and Vinted sell pages.
// It fills in what it can find (photos, title, description, price, brand) and
// gives copy buttons for the rest. It never presses the site's List button:
// you review the form and submit it yourself.
(() => {
  // Marketplaces change their pages often, so every field has several ways to be found:
  // CSS selectors first, then a label / placeholder / aria-label text match.
  const SITES = {
    ebay: {
      name: "eBay",
      host: /(^|\.)ebay\.com$/,
      sellPage: /^\/(sl|lstng)\b/,
      fields: {
        keywords: { from: "title", css: ['input[aria-label*="what you" i]', 'input[placeholder*="tell us what" i]', 'input[name="keywords"]'], text: /tell us what you.re selling|what are you selling/i },
        title: { from: "title", css: ['input[name="title"]', 'input[aria-label="Item title" i]'], text: /^item title|^title/i },
        price: { from: "$price", css: ['input[name="price"]', 'input[aria-label*="price" i]'], text: /^(item )?price|buy it now/i },
        description: { from: "description", css: ['textarea[name="description"]', 'iframe[id*="rte" i]', '[contenteditable="true"][aria-label*="description" i]'], text: /^(item )?description/i },
      },
    },
    poshmark: {
      name: "Poshmark",
      host: /(^|\.)poshmark\.com$/,
      sellPage: /^\/create-listing/,
      fields: {
        title: { from: "title", css: ['input[data-vv-name="title"]', 'input[name="title"]'], text: /what are you selling|^title/i },
        description: { from: "description", css: ['textarea[data-vv-name="description"]', 'textarea[name="description"]'], text: /describe it|^description/i },
        brand: { from: "brand", css: ['input[placeholder*="brand" i]'], text: /^brand/i },
        price: { from: "$price", css: ['input[data-vv-name="listingPrice"]', 'input[name="listingPrice"]'], text: /listing price/i },
      },
    },
    vinted: {
      name: "Vinted",
      host: /(^|\.)vinted\.com$/,
      sellPage: /^\/items\/new/,
      fields: {
        title: { from: "title", css: ['input[data-testid*="title" i]', 'input#title', 'input[name="title"]'], text: /^title/i },
        description: { from: "description", css: ['textarea[data-testid*="description" i]', 'textarea#description', 'textarea[name="description"]'], text: /describe your item|^description/i },
        brand: { from: "brand", css: ['input[data-testid*="brand" i]', 'input#brand'], text: /^brand/i },
        price: { from: "$price", css: ['input[data-testid*="price" i]', 'input#price', 'input[name="price"]'], text: /^price/i },
      },
    },
  };

  const siteId = Object.keys(SITES).find((id) => SITES[id].host.test(location.hostname));
  if (!siteId) return;
  const SITE = SITES[siteId];

  // ---------- finding and filling fields ----------
  const visible = (el) => el && el.getClientRects().length > 0 && !el.disabled;

  function findByText(re) {
    for (const label of document.querySelectorAll("label")) {
      if (!re.test(label.textContent.trim())) continue;
      const el =
        (label.htmlFor && document.getElementById(label.htmlFor)) ||
        label.querySelector("input, textarea, [contenteditable=true]") ||
        label.parentElement?.querySelector("input, textarea, [contenteditable=true]");
      if (visible(el)) return el;
    }
    for (const el of document.querySelectorAll("input, textarea, [contenteditable=true]")) {
      const hint = el.getAttribute("placeholder") || el.getAttribute("aria-label") || "";
      if (hint && re.test(hint.trim()) && visible(el)) return el;
    }
    return null;
  }

  function findField(spec) {
    for (const sel of spec.css) {
      const el = [...document.querySelectorAll(sel)].find(visible);
      if (el) return el;
    }
    return findByText(spec.text);
  }

  // React / Vue inputs ignore a plain `.value =`; use the native setter, then fire events.
  function setValue(el, value) {
    if (el.tagName === "IFRAME") {
      const body = el.contentDocument?.body;
      if (!body) return false;
      body.innerText = value;
      body.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }
    el.focus();
    if (el.isContentEditable) {
      document.execCommand("selectAll", false);
      document.execCommand("insertText", false, value);
    } else {
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    el.blur();
    return true;
  }

  // Decoded by hand: some sell pages' security rules block fetch() of data: URLs.
  function dataUrlToFile(dataUrl, i) {
    const [head, b64] = dataUrl.split(",");
    const type = head.slice(5, head.indexOf(";")) || "image/jpeg";
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
    return new File([bytes], `photo-${i + 1}.jpg`, { type });
  }

  async function addPhotos(dataUrls) {
    const files = dataUrls.map(dataUrlToFile);
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    const inputs = [...document.querySelectorAll('input[type="file"]')];
    const input = inputs.find((i) => /image/.test(i.accept || "") && i.multiple) || inputs.find((i) => /image/.test(i.accept || "")) || inputs[0];
    if (input) {
      input.files = dt.files;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    const zone = document.querySelector('[class*="dropzone" i], [data-testid*="photo" i], [class*="upload" i]');
    if (!zone) return false;
    for (const type of ["dragenter", "dragover", "drop"]) {
      zone.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
    }
    return true;
  }

  // ---------- panel ----------
  let host, root, items = [], current = null;

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  async function loadItems() {
    const { items: map = {} } = await chrome.storage.local.get("items");
    items = Object.values(map).sort((a, b) => b.sentAt - a.sentAt);
    if (!current || !items.find((i) => i.id === current.id)) current = items[0] || null;
  }

  const valueFor = (key) => {
    const L = current?.listing?.[siteId] || {};
    if (key === "$price") return String(current?.prices?.[siteId] || current?.price || "");
    return L[key] ?? "";
  };

  const CSS = `
    :host { all: initial; }
    .launch, .panel { font: 13px/1.4 system-ui, sans-serif; color: #1d2320; }
    .launch { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; background: #1f6f5c; color: #fff; border: 0;
      border-radius: 999px; padding: 10px 16px; font-weight: 700; cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,.25); }
    .panel { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; width: 340px; max-height: 80vh; overflow: auto;
      background: #fff; border: 1px solid #ddd; border-radius: 12px; box-shadow: 0 8px 30px rgba(0,0,0,.25); padding: 12px; }
    .hd { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .hd b { font-size: 14px; }
    button { font: inherit; font-weight: 600; border: 1px solid #ddd; background: #fff; border-radius: 8px; padding: 6px 10px; cursor: pointer; color: #1d2320; }
    button.primary { background: #1f6f5c; color: #fff; border-color: #1f6f5c; }
    select { width: 100%; padding: 6px; border-radius: 8px; border: 1px solid #ddd; font: inherit; margin-bottom: 8px; }
    .row { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
    .f { border-top: 1px solid #eee; padding: 6px 0; }
    .f .k { display: flex; justify-content: space-between; align-items: center; font-weight: 700; font-size: 12px; color: #66706b; }
    .f .v { white-space: pre-wrap; word-break: break-word; max-height: 70px; overflow: auto; margin-top: 2px; }
    .f button { padding: 2px 8px; font-size: 11px; }
    .msg { background: #e2f0eb; border-radius: 8px; padding: 8px; margin-bottom: 8px; white-space: pre-wrap; }
    .thumbs { display: flex; gap: 4px; overflow-x: auto; margin-bottom: 8px; }
    .thumbs img { width: 46px; height: 46px; object-fit: cover; border-radius: 6px; }
    .muted { color: #66706b; }`;

  const FIELD_LABELS = {
    title: "Title", category_path: "Category", department: "Department", category: "Category", subcategory: "Subcategory",
    condition: "Condition", brand: "Brand", size: "Size", colors: "Colors", material: "Material", style_tags: "Style tags",
    item_specifics: "Item specifics", description: "Description",
  };

  function render(open, message = "") {
    if (!host) {
      host = document.createElement("div");
      host.id = "resell-lister-root";
      root = host.attachShadow({ mode: "open" });
      document.documentElement.appendChild(host);
    }
    if (!open) {
      root.innerHTML = `<style>${CSS}</style><button class="launch">Resell Lister</button>`;
      root.querySelector(".launch").onclick = async () => { await loadItems(); render(true); };
      return;
    }
    const L = current?.listing?.[siteId] || {};
    root.innerHTML = `<style>${CSS}</style>
      <div class="panel">
        <div class="hd"><b>Resell Lister · ${SITE.name}</b><button class="close">Hide</button></div>
        ${!items.length ? `<p class="muted">No items yet. In the Resell Lister app, open an item and press <b>Send to extension</b>.</p>` : `
          <select class="pick">${items.map((it) => `<option value="${esc(it.id)}" ${it.id === current?.id ? "selected" : ""}>${esc(it.title)}</option>`).join("")}</select>
          <div class="thumbs">${(current.photos || []).slice(0, 8).map((p) => `<img src="${esc(p)}" alt="">`).join("")}</div>
          ${message ? `<div class="msg">${esc(message)}</div>` : ""}
          <div class="row">
            <button class="primary fill">Fill this form</button>
            <button class="photos">Add photos only</button>
          </div>
          <div class="f"><div class="k">Price <button data-copy="$price">Copy</button></div><div class="v">$${esc(valueFor("$price"))}</div></div>
          ${Object.keys(FIELD_LABELS).filter((k) => k in L).map((k) => `<div class="f"><div class="k">${esc(FIELD_LABELS[k] || k)} <button data-copy="${esc(k)}">Copy</button></div><div class="v">${esc(L[k])}</div></div>`).join("")}
          <p class="muted">Category, condition, size and color menus differ on every site. Pick them using the values above. Then review the form and press the site's own List button.</p>
        `}
      </div>`;
    root.querySelector(".close").onclick = () => render(false);
    const pick = root.querySelector(".pick");
    if (pick) pick.onchange = () => { current = items.find((i) => i.id === pick.value); render(true); };
    root.querySelectorAll("[data-copy]").forEach((b) => (b.onclick = async () => {
      try { await navigator.clipboard.writeText(valueFor(b.dataset.copy)); b.textContent = "Copied"; }
      catch { b.textContent = "Select & copy"; }
      setTimeout(() => (b.textContent = "Copy"), 1200);
    }));
    const fillBtn = root.querySelector(".fill");
    if (fillBtn) fillBtn.onclick = () => fill(true);
    const photosBtn = root.querySelector(".photos");
    if (photosBtn) photosBtn.onclick = () => fill(false);
  }

  async function fill(withText) {
    const done = [], missing = [];
    if (current.photos?.length) {
      (await addPhotos(current.photos).catch(() => false)) ? done.push(`${current.photos.length} photos`) : missing.push("photos (drag them in from your computer)");
    }
    if (withText) {
      for (const [name, spec] of Object.entries(SITE.fields)) {
        const value = valueFor(spec.from);
        if (!value) continue;
        const el = findField(spec);
        if (el && setValue(el, value)) done.push(name);
        else missing.push(name);
      }
    }
    const lines = [];
    if (done.length) lines.push(`Filled: ${done.join(", ")}.`);
    if (missing.length) lines.push(`Not found on this page: ${missing.join(", ")}. Use the copy buttons below.`);
    if (siteId === "ebay" && location.pathname.includes("prelist")) lines.push("eBay asks for the item first: pick the best match, then press Fill again on the next page.");
    if (siteId === "poshmark") lines.push("Poshmark also needs the Original Price. Add it yourself.");
    render(true, lines.join("\n"));
  }

  // ---------- show the launcher only on sell pages (these sites change pages without reloading) ----------
  let lastPath = null;
  function check() {
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    if (SITE.sellPage.test(location.pathname)) {
      if (!host) render(false);
      host.hidden = false;
    } else if (host) {
      host.hidden = true;
    }
  }
  check();
  setInterval(check, 1000);
  chrome.storage.onChanged.addListener(async (changes) => {
    if (changes.items && host && !host.hidden && root.querySelector(".panel")) { await loadItems(); render(true); }
  });
})();
