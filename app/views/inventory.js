// Inventory Manager: one row per item, one column per marketplace.
import { allItems, putItem, deleteItem } from "../db.js";
import {
  PLATFORMS, PIDS, LISTING_STATUS, itemStatus, statusOf, attentionReasons, titleOf, priceFor, money,
  setListingStatus, copyOfItem,
} from "../model.js";
import { esc, toast, modal, toDateInput, fromDateInput, fmtDate } from "../ui.js";
import { sendToExtension } from "../extbridge.js";

const PAGE_SIZE = 25;
const FILTERS = {
  all: ["All", () => true],
  listed: ["Listed", (it) => itemStatus(it) === "listed"],
  draft: ["Drafts", (it) => itemStatus(it) === "draft"],
  sold: ["Sold", (it) => itemStatus(it) === "sold"],
  delisted: ["Delisted", (it) => itemStatus(it) === "delisted"],
  attention: ["Needs attention", (it) => attentionReasons(it).length > 0],
  favorites: ["Favorites", (it) => it.favorite],
};
const SORTS = {
  created: ["Newest first", (a, b) => b.createdAt - a.createdAt],
  modified: ["Recently edited", (a, b) => b.updatedAt - a.updatedAt],
  name: ["Item name (A-Z)", (a, b) => titleOf(a).localeCompare(titleOf(b))],
  priceHigh: ["Price (high to low)", (a, b) => (+b.overview.price || 0) - (+a.overview.price || 0)],
  priceLow: ["Price (low to high)", (a, b) => (+a.overview.price || 0) - (+b.overview.price || 0)],
  listings: ["Number of listings", (a, b) => countListed(b) - countListed(a)],
  sku: ["SKU", (a, b) => (a.overview.sku || "~").localeCompare(b.overview.sku || "~", undefined, { numeric: true })],
};
const countListed = (it) => PIDS.filter((p) => statusOf(it, p) !== "none").length;

// Kept while you move between pages of the app.
const state = { q: "", filter: "all", label: "", sort: "created", page: 0, selected: new Set() };

export async function renderInventory($view) {
  let items = await allItems();

  const labels = [...new Set(items.flatMap((it) => it.labels || []))].sort();
  if (state.label && !labels.includes(state.label.slice(1))) state.label = "";

  const visible = () => {
    const q = state.q.trim().toLowerCase();
    return items
      .filter(FILTERS[state.filter][1])
      .filter((it) => !q || [titleOf(it), it.overview.sku, it.details.brand, it.overview.description, ...(it.labels || [])].join(" ").toLowerCase().includes(q))
      .filter((it) => {
        if (!state.label) return true;
        const has = (it.labels || []).includes(state.label.slice(1));
        return state.label[0] === "+" ? has : !has;
      })
      .sort(SORTS[state.sort][1]);
  };

  const draw = () => {
    const rows = visible();
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages - 1);
    const pageRows = rows.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE);
    // Selection only covers the current page, as in the item grid people expect.
    for (const id of state.selected) if (!pageRows.some((it) => it.id === id)) state.selected.delete(id);
    const counts = Object.fromEntries(Object.keys(FILTERS).map((f) => [f, items.filter(FILTERS[f][1]).length]));
    const allOnPage = pageRows.length > 0 && pageRows.every((it) => state.selected.has(it.id));

    $view.innerHTML = `
      <div class="page-head"><h1>Inventory</h1><a class="btn primary" href="#/new">+ Add item</a></div>

      <div class="toolbar">
        <input type="search" id="q" placeholder="Search title, SKU, brand, label…" value="${esc(state.q)}" aria-label="Search inventory">
        <select id="sort" aria-label="Sort">${Object.entries(SORTS).map(([k, [lbl]]) => `<option value="${k}" ${k === state.sort ? "selected" : ""}>Sort: ${lbl}</option>`).join("")}</select>
        ${labels.length ? `<select id="label" aria-label="Filter by label">
          <option value="">All labels</option>
          ${labels.map((l) => `<option value="+${esc(l)}" ${state.label === "+" + l ? "selected" : ""}>Has label: ${esc(l)}</option>`).join("")}
          ${labels.map((l) => `<option value="-${esc(l)}" ${state.label === "-" + l ? "selected" : ""}>Without label: ${esc(l)}</option>`).join("")}
        </select>` : ""}
      </div>

      <div class="filterbar" role="tablist" aria-label="Status">
        ${Object.entries(FILTERS).map(([k, [lbl]]) => `<button role="tab" aria-selected="${k === state.filter}" data-filter="${k}" class="${k === state.filter ? "on" : ""}">${lbl} <span class="n">${counts[k]}</span></button>`).join("")}
      </div>

      ${state.selected.size ? `
      <div class="bulkbar" role="region" aria-label="Bulk actions">
        <b>${state.selected.size} selected</b>
        <button data-bulk="send">Send to extension</button>
        <button data-bulk="label">Add label</button>
        <button data-bulk="delist">Mark delisted</button>
        <button data-bulk="delete" class="danger">Delete</button>
        <button data-bulk="clear" class="link">Clear</button>
      </div>` : ""}

      ${items.length === 0 ? `
        <div class="card empty"><h2>No items yet</h2><p class="muted">Add photos and a price. The AI writes your eBay, Poshmark and Vinted listings.</p><a class="btn primary" href="#/new">+ Add item</a></div>`
      : rows.length === 0 ? `<div class="card empty"><p class="muted">No items match. Try another filter or search.</p></div>` : `
      <div class="grid" role="table" aria-label="Inventory">
        <div class="grid-row grid-head" role="row">
          <span role="columnheader" class="c-check"><input type="checkbox" id="selAll" ${allOnPage ? "checked" : ""} aria-label="Select all on this page"></span>
          <span role="columnheader" class="c-item">Item</span>
          ${PIDS.map((p) => `<span role="columnheader" class="c-mkt">${PLATFORMS[p].name} <span class="n" title="Items in this view ever listed on ${PLATFORMS[p].name}">${rows.filter((it) => statusOf(it, p) !== "none").length}</span></span>`).join("")}
          <span role="columnheader" class="c-menu"><span class="sr-only">Actions</span></span>
        </div>
        ${pageRows.map(rowHtml).join("")}
      </div>
      <div class="pager">
        <span class="muted small">${rows.length} item${rows.length === 1 ? "" : "s"} · page ${state.page + 1} of ${pages}</span>
        <button id="prev" ${state.page === 0 ? "disabled" : ""}>Previous</button>
        <button id="next" ${state.page >= pages - 1 ? "disabled" : ""}>Next</button>
      </div>`}
    `;
    wire(pageRows);
  };

  const rowHtml = (it) => {
    const st = itemStatus(it);
    const reasons = attentionReasons(it);
    return `
    <div class="grid-row ${state.selected.has(it.id) ? "sel" : ""}" role="row">
      <span role="cell" class="c-check"><input type="checkbox" data-sel="${esc(it.id)}" ${state.selected.has(it.id) ? "checked" : ""} aria-label="Select ${esc(titleOf(it))}"></span>
      <a role="cell" class="c-item" href="#/item/${encodeURIComponent(it.id)}">
        ${it.photos[0] ? `<img src="${esc(it.photos[0].dataUrl)}" alt="">` : `<span class="ph"></span>`}
        <span class="c-item-text">
          <b>${it.favorite ? `<span class="fav" aria-label="Favorite">★</span> ` : ""}${esc(titleOf(it))}</b>
          <span class="muted small">${money(it.overview.price)}${it.overview.sku ? ` · SKU ${esc(it.overview.sku)}` : ""} · <span class="status-${st}">${st[0].toUpperCase() + st.slice(1)}</span></span>
          ${(it.labels || []).length ? `<span class="labels">${it.labels.map((l) => `<span class="label">${esc(l)}</span>`).join("")}</span>` : ""}
          ${reasons.length ? `<span class="${reasons[0].startsWith("Sold") ? "warn-text" : "muted"} small">${esc(reasons[0])}</span>` : ""}
        </span>
      </a>
      ${PIDS.map((p) => {
        const s = statusOf(it, p);
        const skipped = !it.marketplaces?.[p];
        return `<span role="cell" class="c-mkt"><button class="mcell s-${s} ${skipped && s === "none" ? "skipped" : ""}" data-mkt="${p}" data-id="${esc(it.id)}"
          aria-label="${PLATFORMS[p].name}: ${LISTING_STATUS[s]}. Change">
          <span class="mname">${PLATFORMS[p].name}</span>
          ${s === "none" ? `<span class="empty-sq" aria-hidden="true">+</span>` : `${it.photos[0] ? `<img src="${esc(it.photos[0].dataUrl)}" alt="">` : ""}<span class="pill">${LISTING_STATUS[s]}</span>`}
        </button></span>`;
      }).join("")}
      <span role="cell" class="c-menu"><button class="icon-btn" data-menu="${esc(it.id)}" aria-label="Item menu for ${esc(titleOf(it))}">⋯</button></span>
    </div>`;
  };

  const save = async (it) => {
    await putItem(it);
    items = items.map((x) => (x.id === it.id ? { ...it, updatedAt: Date.now() } : x));
  };

  // Changing a status from the grid. Selling asks for price and date and reminds about other listings.
  const changeStatus = async (it, pid) => {
    const P = PLATFORMS[pid];
    const cur = statusOf(it, pid);
    const l = it.listings[pid] || {};
    const res = await modal(`${P.name} · ${titleOf(it)}`, `
      <p class="muted small">Now: <b>${LISTING_STATUS[cur]}</b>${l.listedAt ? ` · listed ${fmtDate(l.listedAt)}` : ""}${l.soldAt ? ` · sold ${fmtDate(l.soldAt)}` : ""}</p>
      <p><a href="${P.sellUrl}" target="_blank" rel="noopener">Open the ${P.name} sell page ↗</a></p>`,
      Object.entries(LISTING_STATUS).filter(([k]) => k !== cur).map(([k, lbl]) => ({ value: k, label: `Mark ${lbl.toLowerCase()}`, primary: k === "listed" || k === "sold" })));
    if (!res) return;
    if (res.value === "sold") return markSold(it, pid);
    setListingStatus(it, pid, res.value);
    await save(it);
    toast(`${P.name}: ${LISTING_STATUS[res.value]}`);
    draw();
  };

  const markSold = async (it, pid) => {
    const res = await modal(`Sold on ${PLATFORMS[pid].name}`, `
      <label for="m-price">Sale price ($)</label><input id="m-price" name="price" type="number" min="0" step="0.01" value="${esc(priceFor(it, pid))}">
      <label for="m-date">Sale date</label><input id="m-date" name="date" type="date" value="${toDateInput()}">`,
      [{ value: "ok", label: "Mark sold", primary: true }]);
    if (!res) return;
    setListingStatus(it, pid, "sold", { soldPrice: res.data.price, soldAt: fromDateInput(res.data.date) });
    await save(it);
    const others = PIDS.filter((p) => p !== pid && statusOf(it, p) === "listed").map((p) => PLATFORMS[p].name);
    toast(others.length ? `Sold! Now remove it from ${others.join(" and ")}.` : "Sold!", others.length ? 5000 : 2400);
    draw();
  };

  const itemMenu = async (it) => {
    const res = await modal(titleOf(it), `<p class="muted small">${money(it.overview.price)} · ${itemStatus(it)}</p>`, [
      { value: "edit", label: "Edit item", primary: true },
      { value: "copy", label: "Copy item" },
      { value: "fav", label: it.favorite ? "Remove favorite" : "Add to favorites" },
      { value: "send", label: "Send to extension" },
      { value: "delete", label: "Delete", danger: true },
    ]);
    if (!res) return;
    if (res.value === "edit") return (location.hash = `#/item/${encodeURIComponent(it.id)}`);
    if (res.value === "copy") {
      const c = copyOfItem(it);
      await putItem(c);
      location.hash = `#/item/${encodeURIComponent(c.id)}`;
      return toast("Copied. You're editing the copy.");
    }
    if (res.value === "fav") { it.favorite = !it.favorite; await save(it); return draw(); }
    if (res.value === "send") return sendItems([it]);
    if (res.value === "delete") return deleteItems([it]);
  };

  const sendItems = async (list) => {
    let ok = 0;
    for (const it of list) {
      try { await sendToExtension(it); ok++; } catch (err) { toast(err.message, 4500); break; }
    }
    if (ok) toast(`Sent ${ok} item${ok > 1 ? "s" : ""} to the extension`);
  };

  const deleteItems = async (list) => {
    const res = await modal(`Delete ${list.length} item${list.length > 1 ? "s" : ""}?`,
      `<p>This removes ${list.length > 1 ? "them" : "it"} and the photos from this browser. It doesn't touch your live listings.</p>`,
      [{ value: "yes", label: "Delete", danger: true }]);
    if (!res) return;
    for (const it of list) { await deleteItem(it.id); state.selected.delete(it.id); }
    const gone = new Set(list.map((it) => it.id));
    items = items.filter((x) => !gone.has(x.id));
    toast("Deleted");
    draw();
  };

  const wire = (pageRows) => {
    const q = document.getElementById("q");
    q.oninput = () => {
      state.q = q.value; state.page = 0;
      const pos = q.selectionStart;
      draw();
      const nq = document.getElementById("q"); nq.focus(); nq.setSelectionRange(pos, pos);
    };
    document.getElementById("sort").onchange = (e) => { state.sort = e.target.value; draw(); };
    const label = document.getElementById("label");
    if (label) label.onchange = () => { state.label = label.value; state.page = 0; draw(); };
    document.querySelectorAll("[data-filter]").forEach((b) => (b.onclick = () => { state.filter = b.dataset.filter; state.page = 0; draw(); }));
    document.querySelectorAll("[data-sel]").forEach((c) => (c.onchange = () => { c.checked ? state.selected.add(c.dataset.sel) : state.selected.delete(c.dataset.sel); draw(); }));
    const selAll = document.getElementById("selAll");
    if (selAll) selAll.onchange = () => { pageRows.forEach((it) => (selAll.checked ? state.selected.add(it.id) : state.selected.delete(it.id))); draw(); };
    document.querySelectorAll("[data-mkt]").forEach((b) => (b.onclick = () => changeStatus(items.find((x) => x.id === b.dataset.id), b.dataset.mkt)));
    document.querySelectorAll("[data-menu]").forEach((b) => (b.onclick = () => itemMenu(items.find((x) => x.id === b.dataset.menu))));
    const prev = document.getElementById("prev"), next = document.getElementById("next");
    if (prev) prev.onclick = () => { state.page--; draw(); };
    if (next) next.onclick = () => { state.page++; draw(); };

    document.querySelectorAll("[data-bulk]").forEach((b) => (b.onclick = async () => {
      const chosen = items.filter((it) => state.selected.has(it.id));
      const act = b.dataset.bulk;
      if (act === "clear") { state.selected.clear(); return draw(); }
      if (act === "send") return sendItems(chosen);
      if (act === "delete") return deleteItems(chosen);
      if (act === "label") {
        const res = await modal("Add label", `<label for="m-label">Label</label><input id="m-label" name="label" placeholder="e.g. Summer, Bin 3, Consigned" autocomplete="off">`, [{ value: "ok", label: "Add label", primary: true }]);
        const lbl = res?.data.label?.trim();
        if (!lbl) return;
        for (const it of chosen) { it.labels = [...new Set([...(it.labels || []), lbl])]; await save(it); }
        toast(`Label "${lbl}" added`);
        return draw();
      }
      if (act === "delist") {
        let n = 0;
        for (const it of chosen) {
          for (const p of PIDS) if (statusOf(it, p) === "listed") { setListingStatus(it, p, "delisted"); n++; }
          await save(it);
        }
        toast(n ? `Marked ${n} listing${n > 1 ? "s" : ""} delisted. Remember to end them on the sites too.` : "Nothing selected was listed.", 4000);
        return draw();
      }
    }));
  };

  draw();
}
