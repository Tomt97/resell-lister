// Home: getting started, today's summary, and items that need attention.
import { allItems } from "../db.js";
import { settings, PIDS, itemStatus, attentionReasons, salesOf, titleOf, money, statusOf } from "../model.js";
import { esc } from "../ui.js";
import { extensionReady, onExtensionReady } from "../extbridge.js";

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

export async function renderHome($view) {
  const items = await allItems();
  const today = startOfToday();
  const sales = salesOf(items);
  const salesToday = sales.filter((s) => s.soldAt >= today);
  const listedToday = items.filter((it) => PIDS.some((p) => (it.listings[p]?.listedAt || 0) >= today)).length;
  const active = items.filter((it) => itemStatus(it) === "listed").length;
  const attention = items
    .map((it) => ({ it, reasons: attentionReasons(it) }))
    .filter((x) => x.reasons.length)
    // Delist reminders first: those can cost a double sale.
    .sort((a, b) => (b.reasons[0].startsWith("Sold") ? 1 : 0) - (a.reasons[0].startsWith("Sold") ? 1 : 0));

  const steps = [
    { done: !!settings.apiKey, label: "Add your Claude API key", href: "#/settings" },
    { done: extensionReady(), label: "Install the Chrome extension (computer only)", href: "#/settings", id: "step-ext" },
    { done: items.length > 0, label: "Add your first item", href: "#/new" },
    { done: items.some((it) => PIDS.some((p) => statusOf(it, p) !== "none")), label: "Mark an item as listed", href: "#/inventory" },
  ];
  const stepsLeft = steps.filter((s) => !s.done).length;

  $view.innerHTML = `
    <div class="page-head"><h1>Home</h1><a class="btn primary" href="#/new">+ Add item</a></div>

    ${stepsLeft ? `
    <section class="card">
      <h2>Getting started <span class="muted small">${steps.length - stepsLeft} of ${steps.length} done</span></h2>
      <ol class="checklist">${steps.map((s) => `
        <li class="${s.done ? "done" : ""}" ${s.id ? `id="${s.id}"` : ""}>
          <span class="tick" aria-hidden="true">${s.done ? "✓" : ""}</span>
          ${s.done ? `<span>${esc(s.label)}</span>` : `<a href="${s.href}">${esc(s.label)}</a>`}
        </li>`).join("")}</ol>
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
      ${attention.length ? `<ul class="attention">${attention.slice(0, 20).map(({ it, reasons }) => `
        <li>
          <a href="#/item/${encodeURIComponent(it.id)}" class="att-row">
            ${it.photos[0] ? `<img src="${esc(it.photos[0].dataUrl)}" alt="">` : `<span class="ph"></span>`}
            <span class="att-text"><b>${esc(titleOf(it))}</b><span class="${reasons[0].startsWith("Sold") ? "warn-text" : "muted"}">${esc(reasons.join(" · "))}</span></span>
          </a>
        </li>`).join("")}</ul>`
      : `<p class="muted">You're all caught up.</p>`}
    </section>
  `;

  onExtensionReady(() => {
    const li = document.getElementById("step-ext");
    if (li) { li.classList.add("done"); li.querySelector(".tick").textContent = "✓"; }
  });
}
