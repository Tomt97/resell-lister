// Home: today's summary, items that need attention, and what everyone has been doing.
import { allItems, current } from "../store.js";
import { settings, PIDS, PLATFORMS, itemStatus, attentionReasons, salesOf, titleOf, money, statusOf, matchesPerson } from "../model.js";
import { esc } from "../ui.js";
import { extensionReady, onExtensionReady } from "../extbridge.js";
import { badge, members, nameOf, personFilter, wirePersonFilter, selectedPerson, timeAgo } from "./people.js";

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

const ACT_TEXT = {
  created: () => "added",
  ai: () => "generated the listing for",
  listed: (pid) => `listed on ${PLATFORMS[pid]?.name}`,
  sold: (pid) => `sold on ${PLATFORMS[pid]?.name}`,
  delisted: (pid) => (pid ? `delisted from ${PLATFORMS[pid]?.name}` : "delisted everywhere:"),
  none: (pid) => `marked not listed on ${PLATFORMS[pid]?.name}`,
  relisted: (pid) => `relisted on ${PLATFORMS[pid]?.name}`,
  price: (pid, info) => `dropped the ${PLATFORMS[pid]?.name} price to $${info} for`,
  stats: (pid, info) => `updated ${PLATFORMS[pid]?.name} views/likes (${info}) for`,
  owner: (pid, info) => `handed over to ${info}:`,
};

export async function renderHome($view) {
  const person = selectedPerson();
  const everything = await allItems();
  const items = everything.filter((it) => matchesPerson(it, person));
  const today = startOfToday();
  const sales = salesOf(items);
  const salesToday = sales.filter((s) => s.soldAt >= today);
  const listedToday = items.filter((it) => PIDS.some((p) => (it.listings[p]?.listedAt || 0) >= today)).length;
  const active = items.filter((it) => itemStatus(it) === "listed").length;
  const attention = items
    .map((it) => ({ it, reasons: attentionReasons(it) }))
    .filter((x) => x.reasons.length)
    // Delist reminders first (they risk a double sale), then stale listings, then drafts.
    .sort((a, b) => rank(a.reasons[0]) - rank(b.reasons[0]));

  // Activity on the items in the inventory you're looking at, newest first.
  const activity = everything
    .flatMap((it) => (it.history || []).map((h) => ({ ...h, it })))
    .filter((h) => matchesPerson(h.it, person))
    .sort((a, b) => b.at - a.at)
    .slice(0, 15);

  const steps = [
    { done: !!settings.apiKey, label: "Add a Claude API key on this device (for AI listings)", href: "#/settings" },
    { done: members().length > 1, label: "Invite your partner to the household", href: "#/settings" },
    { done: everything.length > 0, label: "Add your first item", href: "#/new" },
    { done: everything.some((it) => PIDS.some((p) => statusOf(it, p) !== "none")), label: "Mark an item as listed", href: "#/inventory" },
  ];
  const stepsLeft = steps.filter((s) => !s.done).length;
  const hh = current().household;

  $view.innerHTML = `
    <div class="page-head"><div><h1>Home</h1><span class="muted small">${esc(hh?.name || "")}</span></div><a class="btn primary" href="#/new">+ Add item</a></div>
    ${personFilter()}

    ${stepsLeft ? `
    <section class="card">
      <h2>Getting started <span class="muted small">${steps.length - stepsLeft} of ${steps.length} done</span></h2>
      <ol class="checklist">${steps.map((s) => `
        <li class="${s.done ? "done" : ""}">
          <span class="tick" aria-hidden="true">${s.done ? "✓" : ""}</span>
          ${s.done ? `<span>${esc(s.label)}</span>` : `<a href="${s.href}">${esc(s.label)}</a>`}
        </li>`).join("")}</ol>
      ${!extensionReady() ? `<p class="small muted" id="extNote">On a computer, the Chrome extension can fill the sell forms for you (see Settings).</p>` : ""}
    </section>` : ""}

    <section class="card">
      <h2>Today's summary</h2>
      <div class="stats">
        <div class="stat"><span class="stat-label">Listed today</span><b>${listedToday}</b></div>
        <div class="stat"><span class="stat-label">Sold today</span><b>${salesToday.length}</b></div>
        <div class="stat"><span class="stat-label">Sales today</span><b>${money(salesToday.reduce((s, x) => s + x.price, 0))}</b></div>
        <div class="stat"><span class="stat-label">Active items</span><b>${active}</b></div>
      </div>
    </section>

    <section class="card">
      <h2>Needs attention ${attention.length ? `<span class="badge warn">${attention.length}</span>` : ""}</h2>
      ${attention.length ? `<ul class="attention">${attention.slice(0, 25).map(({ it, reasons }) => `
        <li>
          <a href="#/item/${encodeURIComponent(it.id)}" class="att-row">
            ${it.cover ? `<img src="${esc(it.cover)}" alt="">` : `<span class="ph"></span>`}
            <span class="att-text"><b>${esc(titleOf(it))}</b>
              <span class="${rank(reasons[0]) < 2 ? "warn-text" : "muted"} small">${esc(reasons.join(" · "))}</span></span>
            ${person === "all" ? badge(it.ownerUid) : ""}
          </a>
        </li>`).join("")}</ul>`
      : `<p class="muted">You're all caught up.</p>`}
    </section>

    <section class="card">
      <h2>Recent activity</h2>
      ${activity.length ? `<ul class="activity">${activity.map((h) => `
        <li>${badge(h.by, { decorative: true })}<span><b>${esc(nameOf(h.by))}</b> ${esc((ACT_TEXT[h.act] || (() => h.act))(h.pid, h.info))}
          <a href="#/item/${encodeURIComponent(h.it.id)}">${esc(titleOf(h.it))}</a>
          <span class="muted small">· ${esc(timeAgo(h.at))}</span></span></li>`).join("")}</ul>`
      : `<p class="muted">Nothing yet. Activity shows up here as you add, list and sell items.</p>`}
    </section>
  `;
  wirePersonFilter(() => renderHome($view));
  onExtensionReady(() => document.getElementById("extNote")?.remove());
}

function rank(reason) {
  if (reason.startsWith("Sold")) return 0;
  if (reason.startsWith("Stale")) return 1;
  return 2;
}
