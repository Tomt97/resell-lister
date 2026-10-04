import { getItem, flushPending } from "./db.js";
import { blankItem } from "./model.js";
import { esc } from "./ui.js";
import { renderHome } from "./views/home.js";
import { renderInventory } from "./views/inventory.js";
import { renderItem } from "./views/item.js";
import { renderAnalytics } from "./views/analytics.js";
import { renderSettings } from "./views/settings.js";

const $view = document.getElementById("view");

async function route() {
  const [, page = "", id] = (location.hash || "#/").split("/");
  const navKey = page === "item" ? "inventory" : page || "home";
  document.querySelectorAll("[data-nav]").forEach((a) => {
    const on = a.dataset.nav === navKey;
    a.classList.toggle("active", on);
    on ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current");
  });
  window.scrollTo(0, 0);
  try {
    await flushPending();
    if (page === "inventory") return await renderInventory($view);
    if (page === "analytics") return await renderAnalytics($view);
    if (page === "settings") return renderSettings($view);
    if (page === "new") return renderItem($view, blankItem(), true);
    if (page === "item" && id) {
      const item = await getItem(decodeURIComponent(id));
      if (!item) return (location.hash = "#/inventory");
      return renderItem($view, item, false);
    }
    return await renderHome($view);
  } catch (err) {
    console.error(err);
    $view.innerHTML = `<div class="card"><h2>Something went wrong</h2><p>${esc(err.message)}</p></div>`;
  }
}
window.addEventListener("hashchange", route);

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
route();
