// Inventory Manager: one row per item, one column per marketplace.
import { allItems, saveFields, deleteItem, copyItemWithPhotos, myUid } from "../store.js";
import {
  PLATFORMS, PIDS, LISTING_STATUS, RELIST_TIPS, itemStatus, statusOf, attentionReasons, staleListings, daysListed,
  titleOf, priceFor, money, setListingStatus, markRelisted, droppedPrice, setListingStats, copyOfItem, matchesPerson,
} from "../model.js";
import { esc, toast, modal, toDateInput, fromDateInput, fmtDate } from "../ui.js";
import { sendToExtension } from "../extbridge.js";
import { badge, members, nameOf, personFilter, wirePersonFilter, selectedPerson } from "./people.js";

const PAGE_SIZE = 25;
const FILTERS = {
  all: ["All", () => true],
  listed: ["Listed", (it) => itemStatus(it) === "listed"],
  draft: ["Drafts", (it) => itemStatus(it) === "draft"],
  sold: ["Sold", (it) => itemStatus(it) === "sold"],
  delisted: ["Delisted", (it) => itemStatus(it) === "delisted"],
  attention: ["Needs attention", (it) => attentionReasons(it).length > 0],
  relist: ["Needs relist", (it) => staleListings(it).length > 0],
  favorites: ["Favorites", (it) => it.favorite],
};
const oldestListing = (it) => Math.max(0, ...PIDS.filter((p) => statusOf(it, p) === "listed").map((p) => daysListed(it.listings[p])));
const SORTS = {
  created: ["Newest first", (a, b) => b.createdAt - a.createdAt],
  modified: ["Recently edited", (a, b) => b.updatedAt - a.updatedAt],
  stale: ["Listed longest", (a, b) => oldestListing(b) - oldestListing(a)],
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
  const many = members().length > 1;

  const labels = [...new Set(items.flatMap((it) => it.labels || []))].sort();
  if (state.label && !labels.includes(state.label.slice(1))) state.label = "";

  const visible = () => {
    const q = state.q.trim().toLowerCase();
    const person = selectedPerson();
    return items
      .filter((it) => matchesPerson(it, person))
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
    const person = selectedPerson();
    const mine = items.filter((it) => matchesPerson(it, person));
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages - 1);
    const pageRows = rows.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE);
    // Selection only covers the current page.
    for (const id of state.selected) if (!pageRows.some((it) => it.id === id)) state.selected.delete(id);
    const counts = Object.fromEntries(Object.keys(FILTERS).map((f) => [f, mine.filter(FILTERS[f][1]).length]));
    const allOnPage = pageRows.length > 0 && pageRows.every((it) => state.selected.has(it.id));

    $view.innerHTML = `
      <div class="page-head"><h1>Inventory</h1><a class="btn primary" href="#/new">+ Add item</a></div>
      ${personFilter()}

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
        ${many ? `<button data-bulk="owner">Assign to…</button>` : ""}
        <button data-bulk="delist">Mark delisted</button>
        <button data-bulk="delete" class="danger">Delete</button>
        <button data-bulk="clear" class="link">Clear</button>
      </div>` : ""}

      ${items.length === 0 ? `
        <div class="card empty"><h2>No items yet</h2><p class="muted">Add photos and a price. The AI writes your eBay, Poshmark and Vinted listings.</p><a class="btn primary" href="#/new">+ Add item</a></div>`
      : rows.length === 0 ? `<div class="card empty"><p class="muted">No items match. Try another filter, person or search.</p></div>` : `
      <div class="grid" role="table" aria-label="Inventory">
        <div class="grid-row grid-head" role="row">
          <span role="columnheader" class="c-check"><input type="checkbox" id="selAll" ${allOnPage ? "checked" : ""} aria-label="Select all on this page"></span>
          <span role="columnheader" class="c-item">Item</span>
          ${PIDS.map((p) => `<span role="columnheader" class="c-mkt">${PLATFORMS[p].name} <span class="n" title="Items in this view ever listed on ${PLATFORMS[p].name}">${rows.filter((it) => statusOf(it, p) !== "none").length}</span></span>`).join("")}
          <span role="columnheader" class="c-menu"><span class="sr-only">Actions</span></span>
        </div>
        ${pageRows.map((it) => rowHtml(it, many)).join("")}
      </div>
      <div class="pager">
        <span class="muted small">${rows.length} item${rows.length === 1 ? "" : "s"} · page ${state.page + 1} of ${pages}</span>
        <button id="prev" ${state.page === 0 ? "disabled" : ""}>Previous</button>
        <button id="next" ${state.page >= pages - 1 ? "disabled" : ""}>Next</button>
      </div>`}
    `;
    wire(pageRows);
  };

  const rowHtml = (it, many) => {
    const st = itemStatus(it);
    const reasons = attentionReasons(it);
    const stale = staleListings(it);
    return `
    <div class="grid-row ${state.selected.has(it.id) ? "sel" : ""}" role="row">
      <span role="cell" class="c-check"><input type="checkbox" data-sel="${esc(it.id)}" ${state.selected.has(it.id) ? "checked" : ""} aria-label="Select ${esc(titleOf(it))}"></span>
      <a role="cell" class="c-item" href="#/item/${encodeURIComponent(it.id)}">
        ${it.cover ? `<img src="${esc(it.cover)}" alt="">` : `<span class="ph"></span>`}
        <span class="c-item-text">
          <b>${it.favorite ? `<span class="fav" aria-label="Favorite">★</span> ` : ""}${esc(titleOf(it))}</b>
          <span class="muted small">${many ? `${badge(it.ownerUid)} ` : ""}${money(it.overview.price)}${it.overview.sku ? ` · SKU ${esc(it.overview.sku)}` : ""} · <span class="status-${st}">${st[0].toUpperCase() + st.slice(1)}</span></span>
          ${(it.labels || []).length ? `<span class="labels">${it.labels.map((l) => `<span class="label">${esc(l)}</span>`).join("")}</span>` : ""}
          ${reasons.length ? `<span class="${reasons[0].startsWith("Sold") || reasons[0].startsWith("Stale") ? "warn-text" : "muted"} small">${esc(reasons[0])}</span>` : ""}
        </span>
      </a>
      ${PIDS.map((p) => {
        const s = statusOf(it, p);
        const skipped = !it.marketplaces?.[p];
        const isStale = stale.includes(p);
        const days = s === "listed" ? daysListed(it.listings[p]) : 0;
        return `<span role="cell" class="c-mkt"><button class="mcell s-${s} ${skipped && s === "none" ? "skipped" : ""} ${isStale ? "stale" : ""}" data-mkt="${p}" data-id="${esc(it.id)}"
          aria-label="${PLATFORMS[p].name}: ${LISTING_STATUS[s]}${s === "listed" ? `, ${days} days` : ""}${isStale ? ", needs relist" : ""}. Change">
          <span class="mname">${PLATFORMS[p].name}</span>
          ${s === "none" ? `<span class="empty-sq" aria-hidden="true">+</span>` : `${it.cover ? `<img src="${esc(it.cover)}" alt="">` : ""}<span class="pill">${isStale ? `Relist ${days}d` : s === "listed" ? `Listed ${days}d` : LISTING_STATUS[s]}</span>`}
        </button></span>`;
      }).join("")}
      <span role="cell" class="c-menu"><button class="icon-btn" data-menu="${esc(it.id)}" aria-label="Item menu for ${esc(titleOf(it))}">⋯</button></span>
    </div>`;
  };

  const refreshLocal = (it) => { items = items.map((x) => (x.id === it.id ? it : x)); };
  const save = async (it, paths, hist) => {
    try { await saveFields(it, paths, hist); refreshLocal(it); }
    catch (err) { toast(err.message, 5000); throw err; }
  };

  // Changing a status (and relist tools) from the grid.
  const changeStatus = async (it, pid) => {
    const P = PLATFORMS[pid];
    const cur = statusOf(it, pid);
    const l = it.listings[pid] || {};
    const listed = cur === "listed";
    const stale = staleListings(it).includes(pid);
    const res = await modal(`${P.name} · ${titleOf(it)}`, `
      <p class="muted small">Now: <b>${LISTING_STATUS[cur]}</b>${l.listedAt ? ` · listed ${fmtDate(l.listedAt)}` : ""}${l.relistedAt ? ` · relisted ${fmtDate(l.relistedAt)}${l.relistCount > 1 ? ` (${l.relistCount}×)` : ""}` : ""}${l.soldAt ? ` · sold ${fmtDate(l.soldAt)}` : ""}${listed ? ` · ${daysListed(l)} days` : ""}</p>
      ${listed && (l.views !== undefined || l.likes !== undefined) ? `<p class="small">Views: <b>${esc(l.views ?? "—")}</b> · Likes/watchers: <b>${esc(l.likes ?? "—")}</b></p>` : ""}
      ${listed && stale ? `<div class="tipbox"><b>This listing has gone quiet.</b><ul class="todo small">${RELIST_TIPS[pid].map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>` : ""}
      <p><a href="${P.sellUrl}" target="_blank" rel="noopener">Open the ${P.name} sell page ↗</a></p>`,
      [
        ...(listed ? [
          { value: "relisted", label: "Mark relisted", primary: stale },
          { value: "drop", label: `Drop price 10% (${money(priceFor(it, pid))} → ${money(droppedPrice(priceFor(it, pid)))})` },
          { value: "stats", label: "Views & likes" },
        ] : []),
        ...Object.entries(LISTING_STATUS).filter(([k]) => k !== cur).map(([k, lbl]) => ({ value: k, label: `Mark ${lbl.toLowerCase()}`, primary: !stale && (k === "listed" || k === "sold") })),
      ]);
    if (!res) return;
    if (res.value === "sold") return markSold(it, pid);
    if (res.value === "relisted") {
      markRelisted(it, pid);
      await save(it, [`listings.${pid}`], { act: "relisted", pid });
      toast(`Relisted on ${P.name}. The clock restarts today.`);
      return draw();
    }
    if (res.value === "drop") {
      const np = droppedPrice(priceFor(it, pid));
      if (!np) return toast("Add a price first.");
      it.market[pid] = { ...(it.market[pid] || {}), price: np };
      await save(it, [`market.${pid}.price`], { act: "price", pid, info: np });
      toast(`New ${P.name} price ${money(np)}. Change it on ${P.name} too.`, 4000);
      return draw();
    }
    if (res.value === "stats") return editStats(it, pid);
    setListingStatus(it, pid, res.value);
    await save(it, [`listings.${pid}`], { act: res.value, pid });
    toast(`${P.name}: ${LISTING_STATUS[res.value]}`);
    draw();
  };

  const editStats = async (it, pid) => {
    const l = it.listings[pid] || {};
    const res = await modal(`Views & likes on ${PLATFORMS[pid].name}`, `
      <p class="small muted">Copy these from the listing on ${PLATFORMS[pid].name}. They show next to the listing and in relist reminders.</p>
      <label for="m-views">Views</label><input id="m-views" name="views" type="number" min="0" inputmode="numeric" value="${esc(l.views ?? "")}">
      <label for="m-likes">${pid === "ebay" ? "Watchers" : pid === "vinted" ? "Favourites" : "Likes"}</label><input id="m-likes" name="likes" type="number" min="0" inputmode="numeric" value="${esc(l.likes ?? "")}">`,
      [{ value: "ok", label: "Save", primary: true }]);
    if (!res) return;
    setListingStats(it, pid, res.data.views, res.data.likes);
    await save(it, [`listings.${pid}`], { act: "stats", pid, info: `${res.data.views || 0} views, ${res.data.likes || 0} likes` });
    toast("Saved");
    draw();
  };

  const markSold = async (it, pid) => {
    const res = await modal(`Sold on ${PLATFORMS[pid].name}`, `
      <label for="m-price">Sale price ($)</label><input id="m-price" name="price" type="number" min="0" step="0.01" value="${esc(priceFor(it, pid))}">
      <label for="m-date">Sale date</label><input id="m-date" name="date" type="date" value="${toDateInput()}">`,
      [{ value: "ok", label: "Mark sold", primary: true }]);
    if (!res) return;
    setListingStatus(it, pid, "sold", { soldPrice: res.data.price, soldAt: fromDateInput(res.data.date) });
    await save(it, [`listings.${pid}`], { act: "sold", pid });
    const others = PIDS.filter((p) => p !== pid && statusOf(it, p) === "listed").map((p) => PLATFORMS[p].name);
    toast(others.length ? `Sold! Now remove it from ${others.join(" and ")}.` : "Sold!", others.length ? 5000 : 2400);
    draw();
  };

  const itemMenu = async (it) => {
    const res = await modal(titleOf(it), `<p class="muted small">${money(it.overview.price)} · ${itemStatus(it)}${many ? ` · ${esc(nameOf(it.ownerUid))}` : ""}</p>`, [
      { value: "edit", label: "Edit item", primary: true },
      { value: "copy", label: "Copy item" },
      { value: "fav", label: it.favorite ? "Remove favorite" : "Add to favorites" },
      { value: "send", label: "Send to extension" },
      { value: "delete", label: "Delete", danger: true },
    ]);
    if (!res) return;
    if (res.value === "edit") return (location.hash = `#/item/${encodeURIComponent(it.id)}`);
    if (res.value === "copy") {
      toast("Copying…");
      const c = copyOfItem(it);
      c.ownerUid = c.createdBy = myUid();
      c.history = [{ at: Date.now(), by: myUid(), act: "created" }];
      try { await copyItemWithPhotos(it, c); } catch (err) { return toast(err.message, 5000); }
      location.hash = `#/item/${encodeURIComponent(c.id)}`;
      return toast("Copied. You're editing the copy.");
    }
    if (res.value === "fav") { it.favorite = !it.favorite; await save(it, ["favorite"]); return draw(); }
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
      `<p>This removes ${list.length > 1 ? "them" : "it"} and the photos for everyone in the household. It doesn't touch your live listings.</p>`,
      [{ value: "yes", label: "Delete", danger: true }]);
    if (!res) return;
    for (const it of list) {
      try { await deleteItem(it); } catch (err) { toast(err.message, 5000); break; }
      state.selected.delete(it.id);
      items = items.filter((x) => x.id !== it.id);
    }
    toast("Deleted");
    draw();
  };

  const wire = (pageRows) => {
    wirePersonFilter(() => { state.page = 0; state.selected.clear(); draw(); });
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
    document.querySelectorAll("[data-mkt]").forEach((b) => (b.onclick = () => changeStatus(items.find((x) => x.id === b.dataset.id), b.dataset.mkt).catch(() => {})));
    document.querySelectorAll("[data-menu]").forEach((b) => (b.onclick = () => itemMenu(items.find((x) => x.id === b.dataset.menu)).catch(() => {})));
    const prev = document.getElementById("prev"), next = document.getElementById("next");
    if (prev) prev.onclick = () => { state.page--; draw(); };
    if (next) next.onclick = () => { state.page++; draw(); };

    document.querySelectorAll("[data-bulk]").forEach((b) => (b.onclick = async () => {
      const chosen = items.filter((it) => state.selected.has(it.id));
      const act = b.dataset.bulk;
      try {
        if (act === "clear") { state.selected.clear(); return draw(); }
        if (act === "send") return await sendItems(chosen);
        if (act === "delete") return await deleteItems(chosen);
        if (act === "label") {
          const res = await modal("Add label", `<label for="m-label">Label</label><input id="m-label" name="label" placeholder="e.g. Summer, Bin 3, Consigned" autocomplete="off">`, [{ value: "ok", label: "Add label", primary: true }]);
          const lbl = res?.data.label?.trim();
          if (!lbl) return;
          for (const it of chosen) { it.labels = [...new Set([...(it.labels || []), lbl])]; await save(it, ["labels"]); }
          toast(`Label "${lbl}" added`);
          return draw();
        }
        if (act === "owner") {
          const res = await modal("Assign to", `<p class="small muted">Who's selling ${chosen.length > 1 ? "these items" : "this item"}?</p>`,
            members().map((m) => ({ value: m.uid, label: m.uid === myUid() ? `${m.name} (me)` : m.name })));
          if (!res) return;
          const who = members().find((m) => m.uid === res.value)?.name || "member";
          for (const it of chosen) { it.ownerUid = res.value; await save(it, ["ownerUid"], { act: "owner", info: who }); }
          toast(`Assigned to ${who}`);
          return draw();
        }
        if (act === "delist") {
          let n = 0;
          for (const it of chosen) {
            const paths = [];
            for (const p of PIDS) if (statusOf(it, p) === "listed") { setListingStatus(it, p, "delisted"); paths.push(`listings.${p}`); n++; }
            if (paths.length) await save(it, paths, paths.length === 1 ? { act: "delisted", pid: paths[0].split(".")[1] } : { act: "delisted" });
          }
          toast(n ? `Marked ${n} listing${n > 1 ? "s" : ""} delisted. Remember to end them on the sites too.` : "Nothing selected was listed.", 4000);
          return draw();
        }
      } catch { /* the error was already shown */ }
    }));
  };

  draw();
}
