// Analytics: totals for a time range, monthly revenue vs profit, per-marketplace breakdown, sales list.
import { allItems } from "../store.js";
import { PLATFORMS, PIDS, salesOf, itemStatus, titleOf, money, matchesPerson } from "../model.js";
import { esc, fmtDate } from "../ui.js";
import { members, badge, personFilter, wirePersonFilter, selectedPerson } from "./people.js";

const RANGES = {
  "30": ["Last 30 days", 30],
  "90": ["Last 90 days", 90],
  "365": ["Last 12 months", 365],
  all: ["All time", Infinity],
};
let range = "90";

const monthKey = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const monthLabel = (key) => { const [y, m] = key.split("-").map(Number); return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" }); };

export async function renderAnalytics($view) {
  const everything = await allItems();
  const draw = () => {
    const person = selectedPerson();
    const items = everything.filter((it) => matchesPerson(it, person));
    const many = members().length > 1;
    const since = RANGES[range][1] === Infinity ? 0 : Date.now() - RANGES[range][1] * 864e5;
    const sales = salesOf(items).filter((s) => s.soldAt >= since);
    const listings = items.flatMap((it) => PIDS.map((p) => it.listings[p]).filter((l) => l?.listedAt && l.listedAt >= since));
    const active = items.filter((it) => itemStatus(it) === "listed").length;
    const revenue = sum(sales, "price"), fees = sum(sales, "fees"), cost = sum(sales, "cost"), profit = sum(sales, "profit");
    const sellThrough = sales.length + active ? Math.round((sales.length / (sales.length + active)) * 100) : 0;
    const avgDays = (rows) => { const d = rows.filter((r) => r.daysToSell != null); return d.length ? Math.round(d.reduce((a, r) => a + r.daysToSell, 0) / d.length) : null; };
    const avgDaysAll = avgDays(sales);

    $view.innerHTML = `
      <div class="page-head"><h1>Analytics</h1>
        <select id="range" class="auto" aria-label="Time range">${Object.entries(RANGES).map(([k, [lbl]]) => `<option value="${k}" ${k === range ? "selected" : ""}>${lbl}</option>`).join("")}</select>
      </div>
      ${personFilter()}

      <section class="card">
        <div class="hero"><span class="stat-label">Profit</span><b class="hero-num">${money(profit)}</b>
          <span class="muted small">after estimated fees and your cost of goods · ${esc(RANGES[range][0].toLowerCase())}</span></div>
        <div class="stats">
          <div class="stat"><span class="stat-label">Revenue</span><b>${money(revenue)}</b></div>
          <div class="stat"><span class="stat-label">Units sold</span><b>${sales.length}</b></div>
          <div class="stat"><span class="stat-label">Listings created</span><b>${listings.length}</b></div>
          <div class="stat"><span class="stat-label">Sell-through rate</span><b>${sellThrough}%</b><span class="small muted">sold ÷ (sold + active)</span></div>
          <div class="stat"><span class="stat-label">Fees (est.)</span><b>${money(fees)}</b></div>
          <div class="stat"><span class="stat-label">Avg. sale</span><b>${money(sales.length ? revenue / sales.length : "")}</b></div>
          <div class="stat"><span class="stat-label">Avg. days to sell</span><b>${avgDaysAll ?? "—"}</b></div>
        </div>
      </section>

      <section class="card">
        <h2>Revenue vs profit by month</h2>
        ${sales.length ? chart(sales) : `<p class="muted">No sales in this period yet. Mark an item as sold in Inventory to see it here.</p>`}
      </section>

      ${many && person === "all" ? `
      <section class="card">
        <h2>By person</h2>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Person</th><th class="num">Sold</th><th class="num">Revenue</th><th class="num">Profit</th><th class="num">Active</th><th class="num">Avg. days to sell</th></tr></thead>
          <tbody>${members().map((m) => {
            const s = sales.filter((x) => x.ownerUid === m.uid);
            const act = items.filter((it) => it.ownerUid === m.uid && itemStatus(it) === "listed").length;
            return `<tr><td>${badge(m.uid, { withName: true })}</td><td class="num">${s.length}</td><td class="num">${money(sum(s, "price"))}</td><td class="num">${money(sum(s, "profit"))}</td><td class="num">${act}</td><td class="num">${avgDays(s) ?? "—"}</td></tr>`;
          }).join("")}</tbody>
        </table></div>
      </section>` : ""}

      <section class="card">
        <h2>By marketplace</h2>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Marketplace</th><th class="num">Sold</th><th class="num">Revenue</th><th class="num">Fees (est.)</th><th class="num">Profit</th><th class="num">Avg. sale</th></tr></thead>
          <tbody>${PIDS.map((p) => {
            const s = sales.filter((x) => x.pid === p);
            const r = sum(s, "price");
            return `<tr><td>${PLATFORMS[p].name}</td><td class="num">${s.length}</td><td class="num">${money(r)}</td><td class="num">${money(sum(s, "fees"))}</td><td class="num">${money(sum(s, "profit"))}</td><td class="num">${money(s.length ? r / s.length : "")}</td></tr>`;
          }).join("")}</tbody>
        </table></div>
      </section>

      <section class="card">
        <div class="section-head"><h2>Sales</h2>${sales.length ? `<button id="csv">Download CSV</button>` : ""}</div>
        ${sales.length ? `<div class="table-wrap"><table class="data">
          <thead><tr><th>Date</th><th>Item</th>${many ? "<th>Who</th>" : ""}<th>Marketplace</th><th class="num">Price</th><th class="num">Fees</th><th class="num">Cost</th><th class="num">Profit</th></tr></thead>
          <tbody>${sales.map((s) => `<tr><td>${fmtDate(s.soldAt)}</td><td><a href="#/item/${encodeURIComponent(s.item.id)}">${esc(titleOf(s.item))}</a></td>${many ? `<td>${badge(s.ownerUid, { withName: true })}</td>` : ""}<td>${PLATFORMS[s.pid].name}</td><td class="num">${money(s.price)}</td><td class="num">${money(s.fees)}</td><td class="num">${money(s.cost)}</td><td class="num">${money(s.profit)}</td></tr>`).join("")}</tbody>
        </table></div>` : `<p class="muted">No sales in this period.</p>`}
        <p class="small muted">Fees are estimates from Settings, not the marketplaces' actual charges. Shipping you paid isn't included.</p>
      </section>
    `;
    document.getElementById("range").onchange = (e) => { range = e.target.value; draw(); };
    wirePersonFilter(draw);
    const csv = document.getElementById("csv");
    if (csv) csv.onclick = () => downloadCsv(sales);
    wireTooltip();
  };
  draw();
}

const sum = (rows, k) => rows.reduce((s, r) => s + (+r[k] || 0), 0);

// ---------- chart: grouped columns, one baseline, hover tooltips, table view ----------
function chart(sales) {
  const keys = [...new Set(sales.map((s) => monthKey(s.soldAt)))].sort();
  // Fill gaps so months without sales still show.
  const months = [];
  for (let [y, m] = keys[0].split("-").map(Number); ; m++) {
    if (m > 12) { m = 1; y++; }
    const k = `${y}-${String(m).padStart(2, "0")}`;
    months.push(k);
    if (k === keys.at(-1) || months.length > 36) break;
  }
  const data = months.map((k) => {
    const s = sales.filter((x) => monthKey(x.soldAt) === k);
    return { k, revenue: sum(s, "price"), profit: sum(s, "profit"), n: s.length };
  });

  const W = 640, H = 240, padL = 52, padR = 8, padT = 12, padB = 28;
  const maxV = Math.max(1, ...data.map((d) => Math.max(d.revenue, d.profit)));
  const minV = Math.min(0, ...data.map((d) => d.profit));
  const step = niceStep((maxV - minV) / 4);
  const top = Math.ceil(maxV / step) * step, bottom = Math.floor(minV / step) * step;
  const y = (v) => padT + ((top - v) / (top - bottom)) * (H - padT - padB);
  const band = (W - padL - padR) / data.length;
  const barW = Math.min(24, (band - 10) / 2);
  const ticks = [];
  for (let v = bottom; v <= top + 1e-9; v += step) ticks.push(v);

  const bar = (x, v, cls, label) => {
    const y0 = y(0), y1 = y(v), h = Math.abs(y1 - y0);
    if (h < 0.5) return "";
    const r = Math.min(4, h, barW / 2);
    // Rounded at the data end, square at the baseline.
    const d = v >= 0
      ? `M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + barW - r} Q${x + barW},${y1} ${x + barW},${y1 + r} V${y0} Z`
      : `M${x},${y0} V${y1 - r} Q${x},${y1} ${x + r},${y1} H${x + barW - r} Q${x + barW},${y1} ${x + barW},${y1 - r} V${y0} Z`;
    return `<path class="${cls}" d="${d}"/>`;
  };

  const svg = `
  <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Monthly revenue and profit columns">
    ${ticks.map((v) => `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${padL - 6}" y="${y(v) + 4}" text-anchor="end">${axisMoney(v)}</text>`).join("")}
    <line class="baseline" x1="${padL}" x2="${W - padR}" y1="${y(0)}" y2="${y(0)}"/>
    ${data.map((d, i) => {
      const cx = padL + band * i + band / 2;
      const showLabel = data.length <= 12 || i % Math.ceil(data.length / 12) === 0;
      return `<g class="mgroup" data-tip="${esc(`${monthLabel(d.k)}: revenue ${money(d.revenue)} · profit ${money(d.profit)} · ${d.n} sold`)}">
        <rect class="hit" x="${padL + band * i}" y="${padT}" width="${band}" height="${H - padT - padB}"/>
        ${bar(cx - barW - 1, d.revenue, "s1")}
        ${bar(cx + 1, d.profit, "s2")}
        ${showLabel ? `<text class="axis" x="${cx}" y="${H - 8}" text-anchor="middle">${monthLabel(d.k)}</text>` : ""}
      </g>`;
    }).join("")}
  </svg>`;

  return `
    <div class="legend"><span><i class="key s1"></i>Revenue</span><span><i class="key s2"></i>Profit</span></div>
    <div class="chart-wrap">${svg}<div class="tip" hidden></div></div>
    <details class="small"><summary>Show as table</summary>
      <div class="table-wrap"><table class="data"><thead><tr><th>Month</th><th class="num">Sold</th><th class="num">Revenue</th><th class="num">Profit</th></tr></thead>
      <tbody>${data.map((d) => `<tr><td>${monthLabel(d.k)}</td><td class="num">${d.n}</td><td class="num">${money(d.revenue)}</td><td class="num">${money(d.profit)}</td></tr>`).join("")}</tbody></table></div>
    </details>`;
}

function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(raw || 1));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}
const axisMoney = (v) => (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 });

function wireTooltip() {
  const wrap = document.querySelector(".chart-wrap");
  if (!wrap) return;
  const tip = wrap.querySelector(".tip");
  wrap.querySelectorAll(".mgroup").forEach((g) => {
    const show = (e) => {
      tip.textContent = g.dataset.tip;
      tip.hidden = false;
      const box = wrap.getBoundingClientRect();
      const gx = g.getBoundingClientRect();
      const x = Math.min(Math.max(gx.left + gx.width / 2 - box.left, 90), box.width - 90);
      tip.style.left = `${x}px`;
      g.classList.add("hover");
    };
    const hide = () => { tip.hidden = true; g.classList.remove("hover"); };
    g.addEventListener("pointerenter", show);
    g.addEventListener("pointerleave", hide);
    g.addEventListener("click", show);
  });
}

function downloadCsv(sales) {
  const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  // Text that starts like a formula would run in Excel or Sheets.
  const text = (v) => (/^[=+\-@\t\r]/.test(String(v ?? "")) ? `'${v}` : v);
  const who = (uid) => members().find((m) => m.uid === uid)?.name || "Former member";
  const lines = [["Date", "Item", "SKU", "Who", "Marketplace", "Price", "Fees (est.)", "Cost", "Profit", "Days to sell"].map(cell).join(",")];
  for (const s of sales) {
    lines.push([new Date(s.soldAt).toISOString().slice(0, 10), text(titleOf(s.item)), text(s.item.overview.sku), text(who(s.ownerUid)), PLATFORMS[s.pid].name,
      s.price.toFixed(2), s.fees.toFixed(2), s.cost.toFixed(2), s.profit.toFixed(2), s.daysToSell ?? ""].map(cell).join(","));
  }
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" })),
    download: `resell-lister-sales-${new Date().toISOString().slice(0, 10)}.csv`,
  });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
