export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function toast(msg, ms = 2400) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), ms);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied");
  } catch {
    toast("Couldn't copy. Select the text and copy it instead.");
  }
}

// Small modal built on <dialog>. `body` is HTML; resolves with the clicked button's value
// (and the form's values) or null when dismissed.
export function modal(title, body, buttons) {
  return new Promise((resolve) => {
    const d = document.createElement("dialog");
    d.className = "modal";
    d.innerHTML = `<form method="dialog">
      <div class="modal-head"><h2>${esc(title)}</h2><button value="" class="icon-btn" aria-label="Close">×</button></div>
      <div class="modal-body">${body}</div>
      <div class="modal-foot">${buttons.map((b) => `<button value="${esc(b.value)}" class="${b.primary ? "primary" : ""} ${b.danger ? "danger" : ""}">${esc(b.label)}</button>`).join("")}</div>
    </form>`;
    document.body.appendChild(d);
    let picked = "";
    d.querySelectorAll(".modal-foot button, .modal-head button").forEach((b) => b.addEventListener("click", () => (picked = b.value)));
    d.addEventListener("close", () => {
      const data = Object.fromEntries(new FormData(d.querySelector("form")));
      d.remove();
      resolve(picked ? { value: picked, data } : null);
    });
    d.showModal();
  });
}

export const fmtDate = (ts) => (ts ? new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");
export const toDateInput = (ts) => {
  const d = ts ? new Date(ts) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const fromDateInput = (s) => {
  const [y, m, d] = String(s).split("-").map(Number);
  return y ? new Date(y, m - 1, d, 12).getTime() : Date.now();
};
