// Runs on the Resell Lister web app page. Receives items from the app and
// keeps them in the extension's storage for the sell-page panel.
(() => {
  if (!document.querySelector('meta[name="resell-lister-app"]')) return;

  const reply = (msg) => window.postMessage({ source: "resell-lister-ext", ...msg }, location.origin);

  window.addEventListener("message", async (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const msg = e.data;
    if (msg?.source !== "resell-lister-app") return;

    if (msg.type === "ping") return reply({ type: "pong" });

    if (msg.type === "push" && msg.item?.id) {
      try {
        const { items = {} } = await chrome.storage.local.get("items");
        items[msg.item.id] = msg.item;
        await chrome.storage.local.set({ items });
        reply({ type: "pushed", id: msg.item.id, ok: true });
      } catch (err) {
        reply({ type: "pushed", id: msg.item.id, ok: false, error: String(err?.message || err) });
      }
    }
  });

  // Tell the app we're here even if it pinged before this script loaded.
  reply({ type: "pong" });
})();
