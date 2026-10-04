const list = document.getElementById("list");

async function draw() {
  const { items = {} } = await chrome.storage.local.get("items");
  const arr = Object.values(items).sort((a, b) => b.sentAt - a.sentAt);
  list.replaceChildren();
  if (!arr.length) {
    list.innerHTML = '<p class="muted">No items yet. In the Resell Lister app, open an item and press <b>Send to extension</b>.</p>';
    return;
  }
  for (const it of arr) {
    const row = document.createElement("div");
    row.className = "it";
    const img = document.createElement("img");
    if (it.photos?.[0]) img.src = it.photos[0];
    const t = document.createElement("div");
    t.className = "t";
    t.textContent = it.title;
    t.title = it.title;
    const rm = document.createElement("button");
    rm.textContent = "Remove";
    rm.onclick = async () => {
      const { items = {} } = await chrome.storage.local.get("items");
      delete items[it.id];
      await chrome.storage.local.set({ items });
      draw();
    };
    row.append(img, t, rm);
    list.append(row);
  }
}
draw();
