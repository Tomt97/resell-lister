import * as store from "./store.js";
import { flushPending } from "./pending.js";
import { blankItem } from "./model.js";
import { esc } from "./ui.js";
import { renderHome } from "./views/home.js";
import { renderInventory } from "./views/inventory.js";
import { renderItem } from "./views/item.js";
import { renderAnalytics } from "./views/analytics.js";
import { renderSettings } from "./views/settings.js";
import { renderSetupNeeded, renderSignIn, renderHouseholdSetup, rememberJoinCode } from "./views/auth.js";

const $view = document.getElementById("view");
const shell = document.querySelector(".shell");
let page = "";
let routing = Promise.resolve();

function setNav(navKey) {
  document.querySelectorAll("[data-nav]").forEach((a) => {
    const on = a.dataset.nav === navKey;
    a.classList.toggle("active", on);
    on ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current");
  });
}

async function doRoute() {
  const parts = (location.hash || "#/").split("/");
  page = parts[1] || "";
  const id = parts[2];
  if (page === "join" && id) { rememberJoinCode(decodeURIComponent(id)); history.replaceState(null, "", "#/"); page = ""; }

  if (!store.configured) { shell.classList.add("signed-out"); return renderSetupNeeded($view); }
  const st = store.current();
  if (!st.user) { shell.classList.add("signed-out"); return renderSignIn($view); }
  if (!st.household) { shell.classList.add("signed-out"); return renderHouseholdSetup($view); }
  shell.classList.remove("signed-out");

  setNav(page === "item" ? "inventory" : page || "home");
  try {
    await flushPending();
    await store.whenLoaded();
    if (page === "inventory") return await renderInventory($view);
    if (page === "analytics") return await renderAnalytics($view);
    if (page === "settings") return renderSettings($view);
    if (page === "new") {
      const item = blankItem();
      item.ownerUid = item.createdBy = store.myUid();
      return renderItem($view, item, true);
    }
    if (page === "item" && id) {
      const item = await store.getItem(decodeURIComponent(id));
      if (!item) return (location.hash = "#/inventory");
      return renderItem($view, item, false);
    }
    return await renderHome($view);
  } catch (err) {
    console.error(err);
    $view.innerHTML = `<div class="card"><h2>Something went wrong</h2><p>${esc(err.message)}</p></div>`;
  }
}

// One route at a time, so a slow load can't overwrite a newer page.
const route = () => (routing = routing.then(doRoute, doRoute));
window.addEventListener("hashchange", () => { window.scrollTo(0, 0); route(); });

// Live updates from the other person: refresh list pages, but never while you're typing or in a dialog.
let refreshTimer;
store.onChange((what) => {
  if (what === "auth") return route();
  if (what === "items-local") return;
  // Item changes refresh the list pages; household changes (members, names, shared settings) also refresh Settings.
  const pages = what === "household" ? ["", "inventory", "analytics", "settings"] : ["", "inventory", "analytics"];
  if (!pages.includes(page)) return;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(function tryRefresh() {
    const typing = document.activeElement?.matches?.("input, textarea, select");
    if (typing || document.querySelector("dialog[open]")) return (refreshTimer = setTimeout(tryRefresh, 1500));
    route();
  }, 300);
});

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
if (store.configured) {
  $view.innerHTML = `<p class="muted" style="padding:24px">Loading…</p>`;
  store.start();
} else {
  route();
}
