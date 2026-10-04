import { allItems, putItem } from "../db.js";
import { settings, PLATFORMS, PIDS, DEFAULT_FEES, migrate } from "../model.js";
import { esc, toast } from "../ui.js";
import { extensionReady, onExtensionReady } from "../extbridge.js";

export function renderSettings($view) {
  const fees = settings.fees;
  $view.innerHTML = `
    <div class="page-head"><h1>Settings</h1></div>

    <section class="card">
      <h2>Claude API key</h2>
      <p class="small muted">Powers "Generate listing". Get a key at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a> (pay as you go, about 2 to 5 cents per item). It's saved only in this browser and sent only to Anthropic. Don't save it on a shared computer.</p>
      <label for="key">API key</label>
      <input id="key" type="password" autocomplete="off" placeholder="sk-ant-…" value="${esc(settings.apiKey)}">
      <div class="row" style="margin-top:10px"><button class="primary" id="saveKey">Save key</button><button id="clearKey">Remove key</button></div>
    </section>

    <section class="card">
      <h2>Chrome extension</h2>
      <p id="extState" class="${extensionReady() ? "ok-text" : "muted"}">${extensionReady() ? "✓ Installed and connected in this browser." : "Not detected in this browser."}</p>
      <p class="small">The extension adds a <b>Resell Lister</b> button to the eBay, Poshmark and Vinted sell pages that fills in the form and photos. To install it on a computer: download the project, open <code>chrome://extensions</code>, turn on <b>Developer mode</b>, click <b>Load unpacked</b> and pick the <code>extension</code> folder. Then reload this page.</p>
    </section>

    <section class="card">
      <h2>Fee estimates</h2>
      <p class="small muted">Used for "you keep" and profit numbers. Marketplaces change their fees, so update these if yours differ.</p>
      ${PIDS.map((p) => `
        <div class="row">
          <div class="grow"><label for="fee-${p}-pct">${PLATFORMS[p].name} fee (%)</label><input id="fee-${p}-pct" data-fee="${p}.pct" type="number" step="0.1" min="0" value="${esc(fees[p].pct)}"></div>
          <div class="grow"><label for="fee-${p}-fixed">${PLATFORMS[p].name} fixed fee per sale ($)</label><input id="fee-${p}-fixed" data-fee="${p}.fixed" type="number" step="0.01" min="0" value="${esc(fees[p].fixed)}"></div>
          ${p === "poshmark" ? `<div class="grow"><label for="fee-poshmark-flat">Flat fee on sales under $15 ($)</label><input id="fee-poshmark-flat" data-fee="poshmark.flatUnder15" type="number" step="0.01" min="0" value="${esc(fees.poshmark.flatUnder15)}"></div>` : ""}
        </div>`).join("")}
      <div class="row" style="margin-top:10px"><button class="primary" id="saveFees">Save fees</button><button id="resetFees">Reset to defaults</button></div>
    </section>

    <section class="card">
      <h2>Backup</h2>
      <p class="small muted">Items live only in this browser. Download a backup regularly, and use it to move your items to another device.</p>
      <div class="row"><button id="export">Download backup</button><label class="btn" style="margin:0">Restore backup<input id="import" type="file" accept="application/json,.json" hidden></label></div>
    </section>
  `;

  onExtensionReady(() => {
    const el = document.getElementById("extState");
    if (el) { el.className = "ok-text"; el.textContent = "✓ Installed and connected in this browser."; }
  });
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
    const next = settings.fees;
    document.querySelectorAll("[data-fee]").forEach((el) => {
      const [p, k] = el.dataset.fee.split(".");
      next[p][k] = Math.max(0, +el.value || 0);
    });
    settings.fees = next;
    toast("Fees saved");
  };
  document.getElementById("resetFees").onclick = () => { settings.fees = DEFAULT_FEES; renderSettings($view); toast("Fees reset"); };
  document.getElementById("export").onclick = async () => {
    const blob = new Blob([JSON.stringify({ app: "resell-lister", version: 2, items: await allItems() })], { type: "application/json" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `resell-lister-backup-${new Date().toISOString().slice(0, 10)}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  document.getElementById("import").onchange = async (e) => {
    try {
      const data = JSON.parse(await e.target.files[0].text());
      if (data.app !== "resell-lister" || !Array.isArray(data.items)) throw new Error("not a backup");
      for (const it of data.items) {
        if (!it?.id) continue;
        await putItem(migrate(it), { touch: false });
      }
      toast(`Restored ${data.items.length} items`);
    } catch {
      toast("That file isn't a Resell Lister backup.", 3500);
    } finally {
      e.target.value = "";
    }
  };
}
