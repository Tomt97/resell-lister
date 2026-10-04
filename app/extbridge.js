// Talks to the Chrome extension's content script on this page.
import { PIDS, titleOf, priceFor, mergedListing } from "./model.js";

let ready = false;
const listeners = new Set();
export const extensionReady = () => ready;
export const onExtensionReady = (fn) => (ready ? fn() : listeners.add(fn));

window.addEventListener("message", (e) => {
  if (e.source !== window || e.data?.source !== "resell-lister-ext") return;
  if (e.data.type === "pong" && !ready) {
    ready = true;
    listeners.forEach((fn) => fn());
    listeners.clear();
  }
});
window.postMessage({ source: "resell-lister-app", type: "ping" }, location.origin);

export function sendToExtension(item) {
  return new Promise((resolve, reject) => {
    if (!ready) return reject(new Error("The Resell Lister extension isn't installed in this browser."));
    const chosen = PIDS.filter((p) => item.marketplaces?.[p]);
    const payload = {
      id: item.id,
      title: titleOf(item),
      photos: item.photos.map((p) => p.dataUrl),
      price: item.overview.price,
      prices: Object.fromEntries(chosen.map((p) => [p, priceFor(item, p)])),
      listing: Object.fromEntries(chosen.map((p) => [p, mergedListing(item, p)])),
      sentAt: Date.now(),
    };
    let timer;
    const onMsg = (e) => {
      if (e.source !== window || e.data?.source !== "resell-lister-ext") return;
      if (e.data.type === "pushed" && e.data.id === item.id) {
        clearTimeout(timer);
        window.removeEventListener("message", onMsg);
        e.data.ok ? resolve() : reject(new Error(e.data.error || "The extension couldn't save the item."));
      }
    };
    window.addEventListener("message", onMsg);
    window.postMessage({ source: "resell-lister-app", type: "push", item: payload }, location.origin);
    timer = setTimeout(() => {
      window.removeEventListener("message", onMsg);
      reject(new Error("The extension didn't answer. Reload this page and try again."));
    }, 8000);
  });
}
