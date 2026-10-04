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

// The selected person, or "all". Falls back to "all" if that person left the household.
export function selectedPerson() {
  const p = settings.person;
  return p === "all" || members().some((m) => m.uid === p) ? p : "all";
}

export function personFilter() {
  const ms = members();
  if (ms.length < 2) return "";
  const sel = selectedPerson();
  return `<div class="person-filter" role="group" aria-label="Show items for">
    <button data-person="all" class="${sel === "all" ? "on" : ""}" aria-pressed="${sel === "all"}">Everyone</button>
    ${ms.map((m) => `<button data-person="${esc(m.uid)}" class="${sel === m.uid ? "on" : ""}" aria-pressed="${sel === m.uid}">${badge(m.uid)} ${esc(m.uid === myUid() ? "Me" : m.name)}</button>`).join("")}
  </div>`;
}

export function wirePersonFilter(onChange) {
  document.querySelectorAll("[data-person]").forEach((b) => (b.onclick = () => { settings.person = b.dataset.person; onChange(); }));
}

export function timeAgo(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
