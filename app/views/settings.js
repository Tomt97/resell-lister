import * as store from "../store.js";
import { localItems, deleteLocalItem } from "../local.js";
import { settings, PLATFORMS, PIDS, DEFAULT_FEES, DEFAULT_RELIST, AI_MODELS, blankItem, uid, EBAY_PACKAGE_TYPES, VINTED_SIZES } from "../model.js";
import { esc, toast, modal } from "../ui.js";
import { listModels } from "../gemini.js";
import { extensionReady, onExtensionReady } from "../extbridge.js";
import { members, badge } from "./people.js";

const FREE_BYTES = 1024 ** 3; // Firestore free plan: 1 GiB stored

export async function renderSettings($view) {
  const st = store.current();
  const hh = st.household;
  const me = store.myUid();
  const isOwner = hh.ownerUid === me;
  const fees = settings.fees;
  const relist = settings.relist;
  const used = store.photoBytesUsed();
  const pct = Math.min(100, (used / FREE_BYTES) * 100);
  let deviceItems = [];
  try { deviceItems = await localItems(); } catch { /* no old data on this device */ }
  const inviteLink = hh.inviteCode ? `${location.origin}${location.pathname}#/join/${hh.inviteCode}` : "";

  $view.innerHTML = `
    <div class="page-head"><h1>Settings</h1></div>

    <section class="card">
      <h2>Household</h2>
      <label for="hhName">Household name</label>
      <div class="row"><div class="grow"><input id="hhName" value="${esc(hh.name)}"></div><button id="saveHh">Save</button></div>
      <label>Members</label>
      <ul class="members">${members().map((m) => `
        <li>${badge(m.uid, { withName: true })}${m.uid === hh.ownerUid ? ` <span class="muted small">· created the household</span>` : ""}
          ${isOwner && m.uid !== me ? `<button class="tiny danger" data-remove="${esc(m.uid)}">Remove</button>` : ""}</li>`).join("")}</ul>

      <h3 style="margin-top:14px">Invite your partner</h3>
      ${hh.inviteCode ? `
        <p class="small">They open this link, create their own account, and join: </p>
        <div class="invite"><code id="inviteCode">${esc(hh.inviteCode)}</code></div>
        <div class="row" style="margin-top:8px">
          <button class="primary" id="shareInvite">Share invite link</button>
          <button id="copyInvite">Copy link</button>
          <button id="newInvite">New code</button>
        </div>
        <p class="small muted">Or they can type the code on the "Set up your household" screen. "New code" stops the old one from working.</p>`
      : `<p class="small muted">Make an invite code, then send the link to your partner.</p><button class="primary" id="newInvite">Create invite code</button>`}

      <label for="myName" style="margin-top:14px">Your name in the household</label>
      <div class="row"><div class="grow"><input id="myName" value="${esc(hh.memberNames?.[me] || "")}"></div><button id="saveName">Save</button></div>
      ${!isOwner ? `<p style="margin-top:12px"><button class="danger" id="leave">Leave household</button></p>` : ""}
    </section>

    <section class="card">
      <h2>Your account</h2>
      <p>${esc(st.user.email || "")}</p>
      <button id="signOut">Sign out</button>
    </section>

    <section class="card" id="aiCard">
      <h2>AI listings (this device)</h2>
      <p class="small muted">Optional: everything else in the app works without AI. Keys are saved only on this device.</p>
      <label for="aiProvider">AI service</label>
      <select id="aiProvider">
        <option value="gemini" ${settings.aiProvider === "gemini" ? "selected" : ""}>Google Gemini (free tier)</option>
        <option value="claude" ${settings.aiProvider === "claude" ? "selected" : ""}>Claude (paid, about 5 to 15 cents an item)</option>
      </select>

      <div id="geminiBox" ${settings.aiProvider === "gemini" ? "" : "hidden"}>
        <p class="small">Free key, no card needed: go to <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>, sign in with Google, tap <b>Create API key</b>, then <b>Copy key</b> and paste it here (it starts with AQ.). Google's free tier has daily limits, and Google may use what you send (photos and text) to improve its products.</p>
        <label for="geminiKey">Gemini API key</label>
        <input id="geminiKey" type="password" autocomplete="off" placeholder="AQ.… (paste the whole key)" value="${esc(settings.geminiKey)}">
        <label for="geminiModel">Gemini model</label>
        <select id="geminiModel">${settings.geminiModels.length
          ? settings.geminiModels.map((m, i) => `<option value="${esc(m.id)}" ${m.id === settings.geminiModel ? "selected" : ""}>${esc(m.label)}${i === 0 ? " (recommended)" : ""}</option>`).join("")
          : `<option value="">Save your key to load the models</option>`}</select>
        <p class="small muted">The list comes from Google for your key; the first one is picked for you.</p>
        <div class="row" style="margin-top:10px"><button class="primary" id="saveGemini">Save key and load models</button><button id="clearGemini">Remove key</button></div>
      </div>

      <div id="claudeBox" ${settings.aiProvider === "claude" ? "" : "hidden"}>
        <p class="small">Claude's API has no free tier: you pay Anthropic per item, roughly 5 to 15 cents with Opus or about half that with Sonnet. The key is sent only to Anthropic.</p>
        <label for="key">Claude API key (from <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a>)</label>
        <input id="key" type="password" autocomplete="off" placeholder="sk-ant-…" value="${esc(settings.apiKey)}">
        <label for="model">Claude model</label>
        <select id="model">${Object.entries(AI_MODELS).map(([k, lbl]) => `<option value="${k}" ${k === settings.model ? "selected" : ""}>${esc(lbl)}</option>`).join("")}</select>
        <div class="row" style="margin-top:10px"><button class="primary" id="saveKey">Save</button><button id="clearKey">Remove key</button></div>
      </div>
    </section>

    <section class="card">
      <h2>Packaging (shared)</h2>
      <p class="small muted">The boxes and mailers you use. Picking one on an item fills in its size, eBay package type and Vinted parcel size.</p>
      <div id="pkgList">${settings.packaging.map(pkgRow).join("")}</div>
      <div class="row" style="margin-top:10px">
        <button id="addPkg">+ Add packaging</button>
        <button class="primary" id="savePkg">Save packaging</button>
        <button id="resetPkg">Reset to defaults</button>
      </div>
    </section>

    <section class="card">
      <h2>Relist reminders (shared)</h2>
      <p class="small muted">A listing shows under "Needs relist" once it has been up this many days without selling. Relisting or a fresh listing restarts the count.</p>
      ${PIDS.map((p) => `
        <div class="row relist-row">
          <label class="chip-toggle"><input type="checkbox" data-relist-on="${p}" ${relist[p].on ? "checked" : ""}> ${PLATFORMS[p].name}</label>
          <div class="grow"><label for="rd-${p}" class="sr-only">${PLATFORMS[p].name} days</label>
            <div class="row" style="align-items:center;gap:6px">after <input id="rd-${p}" data-relist-days="${p}" type="number" min="1" max="365" value="${esc(relist[p].days)}" style="width:80px"> days</div></div>
        </div>`).join("")}
      <p class="small muted">eBay starts off because "Good 'Til Cancelled" listings renew by themselves. Turn it on if you like to refresh stale eBay listings too.</p>
      <div class="row" style="margin-top:10px"><button class="primary" id="saveRelist">Save</button><button id="resetRelist">Reset to defaults</button></div>
    </section>

    <section class="card">
      <h2>Fee estimates (shared)</h2>
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
      <h2>Free storage</h2>
      <p class="small">Photos use about <b>${(used / 1024 ** 2).toFixed(1)} MB</b> of the free <b>1,024 MB</b>.</p>
      <div class="meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct.toFixed(0)}" aria-label="Free storage used"><span style="width:${Math.max(pct, 0.5)}%"></span></div>
      <p class="small muted">That's roughly ${Math.max(0, Math.floor((FREE_BYTES - used) / 160000)).toLocaleString()} more photos. Deleting sold items you no longer need frees space.</p>
    </section>

    <section class="card">
      <h2>Chrome extension</h2>
      <p id="extState" class="${extensionReady() ? "ok-text" : "muted"}">${extensionReady() ? "✓ Installed and connected in this browser." : "Not detected in this browser."}</p>
      <p class="small">On a computer, the extension adds a <b>Resell Lister</b> button to the eBay, Poshmark and Vinted sell pages that fills in the form and photos. To install: download the project from GitHub, open <code>chrome://extensions</code>, turn on <b>Developer mode</b>, click <b>Load unpacked</b> and pick the <code>extension</code> folder. Phones can't run extensions, so use the copy buttons there.</p>
    </section>

    ${deviceItems.length ? `
    <section class="card">
      <h2>Items saved on this device</h2>
      <p class="small">${deviceItems.length} item${deviceItems.length > 1 ? "s were" : " was"} saved here by the earlier version of the app. Move ${deviceItems.length > 1 ? "them" : "it"} into the household so everyone can see ${deviceItems.length > 1 ? "them" : "it"}. ${deviceItems.length > 1 ? "They'll" : "It'll"} belong to you.</p>
      <button class="primary" id="moveLocal">Move to household</button>
    </section>` : ""}

    <section class="card">
      <h2>Backup</h2>
      <p class="small muted">Everything is saved online, but you can also download the item details (with small cover photos) as a file.</p>
      <button id="export">Download backup</button>
    </section>
  `;

  const run = (fn) => async (e) => {
    const b = e?.currentTarget;
    if (b) b.disabled = true;
    try { await fn(e); } catch (err) { toast(err.message, 5000); }
    finally { if (b && b.isConnected) b.disabled = false; }
  };
  const $ = (id) => document.getElementById(id);

  onExtensionReady(() => { const el = $("extState"); if (el) { el.className = "ok-text"; el.textContent = "✓ Installed and connected in this browser."; } });

  $("saveHh").onclick = run(async () => { const n = $("hhName").value.trim(); if (!n) return toast("Enter a name."); await store.renameHousehold(n); toast("Household renamed"); });
  $("saveName").onclick = run(async () => { const n = $("myName").value.trim(); if (!n) return toast("Enter your name."); await store.renameMe(n); toast("Name saved"); });
  $("newInvite").onclick = run(async () => {
    if (hh.inviteCode) {
      const ok = await modal("Make a new invite code?", "<p>The current code and link will stop working.</p>", [{ value: "yes", label: "New code", primary: true }]);
      if (!ok) return;
    }
    await store.createInvite();
    renderSettings($view);
  });
  if ($("shareInvite")) $("shareInvite").onclick = run(async () => {
    const text = `Join our Resell Lister household: ${inviteLink} (invite code ${hh.inviteCode})`;
    if (navigator.share) { try { await navigator.share({ title: "Resell Lister invite", text, url: inviteLink }); return; } catch { /* closed */ } }
    await navigator.clipboard.writeText(text); toast("Invite copied. Paste it in a text message.");
  });
  if ($("copyInvite")) $("copyInvite").onclick = run(async () => { await navigator.clipboard.writeText(inviteLink); toast("Link copied"); });
  document.querySelectorAll("[data-remove]").forEach((b) => (b.onclick = run(async () => {
    const name = members().find((m) => m.uid === b.dataset.remove)?.name;
    const ok = await modal(`Remove ${name}?`, "<p>They'll lose access to the household's items. Their items stay. You can invite them again later.</p>", [{ value: "yes", label: "Remove", danger: true }]);
    if (!ok) return;
    await store.removeMember(b.dataset.remove);
    toast(`${name} removed`);
    renderSettings($view);
  })));
  if ($("leave")) $("leave").onclick = run(async () => {
    const ok = await modal("Leave the household?", "<p>You'll stop seeing its items. Your items stay with the household.</p>", [{ value: "yes", label: "Leave", danger: true }]);
    if (ok) await store.leaveHousehold();
  });
  $("signOut").onclick = () => store.signOutNow();

  $("aiProvider").onchange = (e) => {
    settings.aiProvider = e.target.value;
    $("geminiBox").hidden = e.target.value !== "gemini";
    $("claudeBox").hidden = e.target.value !== "claude";
    toast(e.target.value === "gemini" ? "Using Google Gemini on this device" : "Using Claude on this device");
  };
  $("saveGemini").onclick = run(async () => {
    const key = $("geminiKey").value.trim();
    if (!key) return toast("Paste your Gemini key first.");
    const models = await listModels(key);
    if (!models.length) return toast("No Gemini text models are available for this key.", 5000);
    settings.geminiKey = key;
    settings.geminiModels = models;
    if (!models.some((m) => m.id === settings.geminiModel)) settings.geminiModel = models[0].id;
    settings.aiProvider = "gemini";
    toast(`Gemini key saved. Using ${models.find((m) => m.id === settings.geminiModel).label}.`, 4000);
    renderSettings($view);
  });
  $("geminiModel").onchange = (e) => { if (e.target.value) { settings.geminiModel = e.target.value; toast("Model saved"); } };
  $("clearGemini").onclick = () => { settings.geminiKey = ""; settings.geminiModel = ""; settings.geminiModels = []; renderSettings($view); toast("Gemini key removed"); };
  $("saveKey").onclick = () => { settings.apiKey = $("key").value.trim(); settings.model = $("model").value; toast("Saved on this device"); };
  $("clearKey").onclick = () => { settings.apiKey = ""; $("key").value = ""; toast("Key removed"); };

  const shared = () => ({ ...(hh.settings || {}) });
  $("addPkg").onclick = () => {
    $("pkgList").insertAdjacentHTML("beforeend", pkgRow({ id: uid(), name: "", length: "", width: "", height: "", ebayType: "Package (or thick envelope)", vintedSize: "" }));
    wirePkgRemove();
    $("pkgList").lastElementChild.querySelector("input").focus();
  };
  const wirePkgRemove = () => document.querySelectorAll("[data-pkg-rm]").forEach((b) => (b.onclick = () => b.closest(".pkg-row").remove()));
  wirePkgRemove();
  $("savePkg").onclick = run(async () => {
    const rows = [...document.querySelectorAll(".pkg-row")].map((r) => {
      const v = (k) => r.querySelector(`[data-k=${k}]`).value.trim();
      return { id: r.dataset.id, name: v("name"), length: +v("length") || 0, width: +v("width") || 0, height: +v("height") || 0, ebayType: v("ebayType"), vintedSize: v("vintedSize") };
    });
    const bad = rows.find((r) => !r.name || !r.length || !r.width || !r.height);
    if (bad) return toast("Each packaging needs a name and all three sizes.", 4000);
    if (!rows.length) return toast("Keep at least one packaging, or use Reset to defaults.", 4000);
    await store.saveSharedSettings({ ...shared(), packaging: rows });
    toast("Packaging saved for the household");
  });
  $("resetPkg").onclick = run(async () => { const s = shared(); delete s.packaging; await store.saveSharedSettings(s); renderSettings($view); toast("Packaging reset"); });

  $("saveRelist").onclick = run(async () => {
    const next = settings.relist;
    document.querySelectorAll("[data-relist-on]").forEach((c) => (next[c.dataset.relistOn].on = c.checked));
    document.querySelectorAll("[data-relist-days]").forEach((i) => (next[i.dataset.relistDays].days = Math.min(365, Math.max(1, Math.round(+i.value) || DEFAULT_RELIST[i.dataset.relistDays].days))));
    await store.saveSharedSettings({ ...shared(), relist: next });
    toast("Relist reminders saved for the household");
  });
  $("resetRelist").onclick = run(async () => { const s = shared(); delete s.relist; await store.saveSharedSettings(s); renderSettings($view); });
  $("saveFees").onclick = run(async () => {
    const next = settings.fees;
    document.querySelectorAll("[data-fee]").forEach((el) => { const [p, k] = el.dataset.fee.split("."); next[p][k] = Math.max(0, +el.value || 0); });
    await store.saveSharedSettings({ ...shared(), fees: next });
    toast("Fees saved for the household");
  });
  $("resetFees").onclick = run(async () => { const s = shared(); delete s.fees; await store.saveSharedSettings(s); renderSettings($view); toast(`Fees reset (eBay ${DEFAULT_FEES.ebay.pct}%)`); });

  if ($("moveLocal")) $("moveLocal").onclick = run(async () => {
    let n = 0;
    for (const old of deviceItems) {
      const it = { ...blankItem(), ...old, version: 2, ownerUid: me, createdBy: me, history: [{ at: Date.now(), by: me, act: "created" }] };
      const photos = old.photos || [];
      it.photos = [];
      // Re-compress to the cloud size (older device photos were larger).
      for (const p of photos) if (p.dataUrl) it.photos.push(await store.addPhoto(it, await shrink(p.dataUrl, 1280, 0.8)));
      it.cover = photos[0]?.dataUrl ? await shrink(photos[0].dataUrl, 320, 0.7) : "";
      await store.putItem(it);
      await deleteLocalItem(old.id);
      n++;
    }
    toast(`Moved ${n} item${n === 1 ? "" : "s"} into the household`);
    renderSettings($view);
  });

  $("export").onclick = run(async () => {
    const items = await store.allItems();
    const blob = new Blob([JSON.stringify({ app: "resell-lister", version: 3, household: hh.name, exportedAt: new Date().toISOString(), items })], { type: "application/json" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `resell-lister-backup-${new Date().toISOString().slice(0, 10)}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
}

async function shrink(dataUrl, maxSide, quality) {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", quality);
}

function pkgRow(p) {
  const o = (v, l, cur) => `<option value="${esc(v)}" ${v === cur ? "selected" : ""}>${esc(l)}</option>`;
  return `<div class="pkg-row" data-id="${esc(p.id)}">
    <div class="grow pkg-name"><label>Name<input data-k="name" value="${esc(p.name)}" placeholder="e.g. Poly mailer 10×13"></label></div>
    <div class="pkg-dim"><label>L (in)<input data-k="length" type="number" min="0" step="0.5" inputmode="decimal" value="${esc(p.length)}"></label></div>
    <div class="pkg-dim"><label>W (in)<input data-k="width" type="number" min="0" step="0.5" inputmode="decimal" value="${esc(p.width)}"></label></div>
    <div class="pkg-dim"><label>H (in)<input data-k="height" type="number" min="0" step="0.5" inputmode="decimal" value="${esc(p.height)}"></label></div>
    <div class="grow"><label>eBay package type<select data-k="ebayType">${o("", "—", p.ebayType)}${EBAY_PACKAGE_TYPES.map((t) => o(t, t, p.ebayType)).join("")}</select></label></div>
    <div class="grow"><label>Vinted parcel size<select data-k="vintedSize">${o("", "—", p.vintedSize)}${Object.entries(VINTED_SIZES).map(([k, v]) => o(k, v, p.vintedSize)).join("")}</select></label></div>
    <button class="tiny danger pkg-rm" data-pkg-rm type="button" aria-label="Remove ${esc(p.name || "packaging")}">Remove</button>
  </div>`;
}
