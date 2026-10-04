// Who's who: member names, color badges, and the Everyone / person filter.
import { current, myUid } from "../store.js";
import { PERSON_COLORS, initials, settings } from "../model.js";
import { esc } from "../ui.js";

export const members = () => {
  const h = current().household;
  return (h?.members || []).map((uid, i) => ({ uid, name: h.memberNames?.[uid] || "Member", color: PERSON_COLORS[i % PERSON_COLORS.length] }));
};
export const nameOf = (uid) => (uid === myUid() ? "You" : members().find((m) => m.uid === uid)?.name || "Former member");

// decorative: the name is already written next to it, so screen readers skip the badge.
export function badge(uid, { withName = false, decorative = false } = {}) {
  const m = members().find((x) => x.uid === uid);
  const name = m?.name || "Former member";
  const color = m?.color || "#8a8f8c";
  if (decorative) return `<span class="who" aria-hidden="true"><span class="avatar" style="--c:${color}">${esc(initials(name))}</span></span>`;
  return `<span class="who" title="${esc(name)}"><span class="avatar" style="--c:${color}" aria-hidden="true">${esc(initials(name))}</span>${withName ? `<span class="who-name">${esc(uid === myUid() ? `${name} (you)` : name)}</span>` : `<span class="sr-only">${esc(name)}</span>`}</span>`;
}

// Whose inventory is showing: your own by default, another member's, or "all" (both).
// Falls back to your own if that person left the household.
export function selectedPerson() {
  const p = settings.personFor(myUid());
  if (p === "all") return "all";
  return members().some((m) => m.uid === p) ? p : myUid();
}

// Switch between inventories: Mine first, then each other member's, then Both.
export function personFilter() {
  const ms = members();
  if (ms.length < 2) return "";
  const sel = selectedPerson();
  const me = myUid();
  const ordered = [...ms.filter((m) => m.uid === me), ...ms.filter((m) => m.uid !== me)];
  const viewingOther = sel !== "all" && sel !== me;
  const btn = (value, label, extra = "") => `<button data-person="${esc(value)}" class="${sel === value ? "on" : ""}" aria-pressed="${sel === value}">${extra}${esc(label)}</button>`;
  return `<div class="person-filter" role="group" aria-label="Whose inventory">
      <span class="pf-label">Inventory:</span>
      ${ordered.map((m) => btn(m.uid, m.uid === me ? "Mine" : `${m.name}'s`, `${badge(m.uid)} `)).join("")}
      ${btn("all", "Both")}
    </div>
    ${viewingOther ? `<p class="viewing-other" role="status"><span>You're looking at <b>${esc(ms.find((m) => m.uid === sel)?.name)}'s</b> inventory.</span> <button class="tiny" data-person="${esc(me)}">Back to mine</button></p>` : ""}`;
}

export function wirePersonFilter(onChange) {
  document.querySelectorAll("[data-person]").forEach((b) => (b.onclick = () => { settings.setPersonFor(myUid(), b.dataset.person); onChange(); }));
}

export function timeAgo(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
