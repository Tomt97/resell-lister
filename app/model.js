// Item shape, marketplace definitions, derived status, fees and sales.

export const PLATFORMS = {
  ebay: {
    name: "eBay",
    short: "eB",
    sellUrl: "https://www.ebay.com/sl/prelist/suggest",
    // [key, label, kind, maxLength, overview fallback]
    fields: [
      ["title", "Title", "line", 80, "title"],
      ["category_path", "Category", "line", 0, "category"],
      ["condition", "Condition", "line", 0, "condition"],
      ["item_specifics", "Item specifics (one per line, Name: Value)", "text", 0, null],
      ["description", "Description", "text", 0, "description"],
    ],
  },
  poshmark: {
    name: "Poshmark",
    short: "Po",
    sellUrl: "https://poshmark.com/create-listing",
    fields: [
      ["title", "Title", "line", 80, "title"],
      ["department", "Department", "line", 0, null],
      ["category", "Category", "line", 0, null],
      ["subcategory", "Subcategory", "line", 0, null],
      ["condition", "Condition", "line", 0, "condition"],
      ["brand", "Brand", "line", 0, "brand"],
      ["size", "Size", "line", 0, "size"],
      ["colors", "Colors (up to 2)", "line", 0, "colors"],
      ["style_tags", "Style tags (up to 3)", "line", 0, "style_tags"],
      ["description", "Description", "text", 0, "description"],
    ],
  },
  vinted: {
    name: "Vinted",
    short: "Vi",
    sellUrl: "https://www.vinted.com/items/new",
    fields: [
      ["title", "Title", "line", 0, "title"],
      ["category_path", "Category", "line", 0, "category"],
      ["condition", "Condition", "line", 0, "condition"],
      ["brand", "Brand", "line", 0, "brand"],
      ["size", "Size", "line", 0, "size"],
      ["colors", "Colors (up to 2)", "line", 0, "colors"],
      ["material", "Material", "line", 0, null],
      ["description", "Description", "text", 0, "description"],
    ],
  },
};
export const PIDS = Object.keys(PLATFORMS);

export const CONDITIONS = ["New with tags", "New without tags", "Like new", "Good", "Fair", "Poor"];
export const LISTING_STATUS = { none: "Not listed", listed: "Listed", sold: "Sold", delisted: "Delisted" };
export const MAX_PHOTOS = 24;

export const DEFAULT_FEES = {
  ebay: { pct: 13.6, fixed: 0.4 },
  poshmark: { pct: 20, fixed: 0, flatUnder15: 2.95 },
  vinted: { pct: 0, fixed: 0 },
};

// When a listing counts as stale. eBay "Good 'Til Cancelled" listings renew by themselves,
// so eBay reminders start off; switch them on in Settings if you like to refresh eBay too.
export const DEFAULT_RELIST = {
  ebay: { on: false, days: 60 },
  poshmark: { on: true, days: 30 },
  vinted: { on: true, days: 21 },
};

export const AI_MODELS = {
  "claude-opus-5-5": "Claude Opus 5.5 (best results, about 5 to 15 cents an item)",
  "claude-sonnet-5-5": "Claude Sonnet 5.5 (about half the cost)",
};

// Settings shared by the household (fees, relist rules) come from the cloud; the rest stay on this device.
let shared = {};
export const setSharedSettings = (s) => { shared = s || {}; };
function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch {} }
export const settings = {
  get apiKey() { return safeGet("rl.apiKey") || ""; },
  set apiKey(v) { safeSet("rl.apiKey", v); },
  get model() { const m = safeGet("rl.model"); return AI_MODELS[m] ? m : "claude-opus-5-5"; },
  set model(v) { safeSet("rl.model", v); },
  get fees() {
    const saved = shared.fees || {};
    return Object.fromEntries(PIDS.map((p) => [p, { ...DEFAULT_FEES[p], ...(saved[p] || {}) }]));
  },
  get relist() {
    const saved = shared.relist || {};
    return Object.fromEntries(PIDS.map((p) => [p, { ...DEFAULT_RELIST[p], ...(saved[p] || {}) }]));
  },
  get descStyle() { return safeGet("rl.descStyle") || "friendly"; },
  set descStyle(v) { safeSet("rl.descStyle", v); },
  get person() { return safeGet("rl.person") || "all"; },
  set person(v) { safeSet("rl.person", v); },
};

export const uid = () =>
  crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);

const blankListings = () => Object.fromEntries(PIDS.map((p) => [p, { status: "none" }]));

export function blankItem() {
  return {
    version: 2,
    id: uid(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    marketplaces: Object.fromEntries(PIDS.map((p) => [p, true])),
    photos: [],
    overview: { title: "", description: "", condition: "", price: "", cost: "", sku: "" },
    details: { category: "", brand: "", size: "", colors: "", style_tags: "" },
    aiNotes: "",
    privateNotes: "",
    labels: [],
    favorite: false,
    ai: null,
    market: Object.fromEntries(PIDS.map((p) => [p, {}])),
    listings: blankListings(),
    ownerUid: "",
    createdBy: "",
    history: [],
  };
}

// Items saved by the first version of the app had one listing per platform and no overview.
export function migrate(item) {
  if (!item) return item;
  if (item.version === 2) {
    item.history ??= [];
    item.ownerUid ??= item.createdBy || "";
    item.labels ??= [];
    item.photos ??= [];
    item.market ??= Object.fromEntries(PIDS.map((p) => [p, {}]));
    item.listings ??= blankListings();
    return item;
  }
  const next = blankItem();
  const L = item.listing || {};
  const first = L.ebay || L.poshmark || L.vinted || {};
  next.id = item.id;
  next.createdAt = item.createdAt || Date.now();
  next.updatedAt = item.updatedAt || Date.now();
  next.photos = item.photos || [];
  next.overview = { ...next.overview, title: first.title || "", description: first.description || "", price: item.price || "", cost: item.cost || "" };
  next.details = { ...next.details, brand: L.poshmark?.brand || L.vinted?.brand || "", size: L.poshmark?.size || L.vinted?.size || "", colors: L.poshmark?.colors || L.vinted?.colors || "" };
  next.aiNotes = item.notes || "";
  next.ai = item.ai ? { pricing: item.ai.pricing, check_before_posting: item.ai.check_before_posting || [], flaws: item.ai.item?.flaws || [] } : null;
  for (const p of PIDS) {
    next.market[p] = { ...(L[p] || {}) };
    if (item.prices?.[p]) next.market[p].price = item.prices[p];
    const old = item.status?.[p];
    // v1 had a "delist" reminder status; it meant "still listed here".
    next.listings[p] = { status: old === "delist" ? "listed" : old && LISTING_STATUS[old] ? old : "none" };
  }
  return next;
}

// ---------- derived values ----------
export const titleOf = (item) =>
  item.overview?.title || item.market?.ebay?.title || item.market?.poshmark?.title || item.market?.vinted?.title || "Untitled item";

export const priceFor = (item, pid) => item.market?.[pid]?.price || item.overview?.price || "";

// What will actually be posted on a marketplace: its own value, else the shared one.
export function valueFor(item, pid, key) {
  const own = item.market?.[pid]?.[key];
  if (own) return own;
  const field = PLATFORMS[pid].fields.find((f) => f[0] === key);
  const fb = field?.[4];
  if (!fb) return "";
  return item.overview?.[fb] ?? item.details?.[fb] ?? "";
}

export function mergedListing(item, pid) {
  return Object.fromEntries(PLATFORMS[pid].fields.map(([k]) => [k, valueFor(item, pid, k)]));
}

export const statusOf = (item, pid) => item.listings?.[pid]?.status || "none";

export function itemStatus(item) {
  const s = PIDS.map((p) => statusOf(item, p));
  if (s.includes("sold")) return "sold";
  if (s.includes("listed")) return "listed";
  if (s.includes("delisted")) return "delisted";
  return "draft";
}

// Sold on one marketplace but still showing as listed on another.
export const stillListedAfterSale = (item) =>
  itemStatus(item) === "sold" ? PIDS.filter((p) => statusOf(item, p) === "listed") : [];

// ---------- relisting ----------
const DAY = 864e5;
export const daysListed = (l) => (l?.relistedAt || l?.listedAt ? Math.floor((Date.now() - (l.relistedAt || l.listedAt)) / DAY) : 0);

// Marketplaces where this item has been sitting too long without a sale.
export function staleListings(item, rules = settings.relist) {
  if (itemStatus(item) === "sold") return [];
  return PIDS.filter((p) => {
    const l = item.listings?.[p];
    return l?.status === "listed" && rules[p]?.on && (l.relistedAt || l.listedAt) && daysListed(l) >= rules[p].days;
  });
}

export function staleText(item, pid) {
  const l = item.listings[pid];
  const bits = [`${daysListed(l)} days`];
  if (l.views !== undefined && l.views !== "") bits.push(`${l.views} views`);
  if (l.likes !== undefined && l.likes !== "") bits.push(`${l.likes} likes`);
  return `Stale on ${PLATFORMS[pid].name} (${bits.join(", ")}): relist or drop the price`;
}

// Free ways to get a stale listing seen again.
export const RELIST_TIPS = {
  ebay: [
    "Send an offer to watchers (free).",
    "Lower the price.",
    "Or refresh it: use \"Sell similar\" to make a new copy, then end the old listing.",
  ],
  poshmark: [
    "Share the listing (free). Sharing other people's listings helps too.",
    "Drop the price by at least 10% so people who liked it get notified.",
    "Send an offer to likers.",
    "Or relist: copy the listing as a new one, then delete the old one.",
  ],
  vinted: [
    "Bumps cost money on Vinted, so try the free options first.",
    "Lower the price, or refresh the photos and title.",
    "Some sellers delete and upload again. Check Vinted's rules first.",
  ],
};

export function attentionReasons(item) {
  const reasons = [];
  const stale = stillListedAfterSale(item);
  if (stale.length) reasons.push(`Sold - remove it from ${stale.map((p) => PLATFORMS[p].name).join(" and ")}`);
  for (const p of staleListings(item)) reasons.push(staleText(item, p));
  const st = itemStatus(item);
  if (st === "draft") {
    if (!item.photos.length) reasons.push("Add photos");
    else if (!item.overview.title) reasons.push("Generate or write the listing");
    if (!item.overview.price) reasons.push("Add a price");
  }
  return reasons;
}

export function netAfterFees(pid, price, fees = settings.fees) {
  const p = +price;
  if (!Number.isFinite(p) || p <= 0) return null;
  const f = fees[pid] || { pct: 0, fixed: 0 };
  if (f.flatUnder15 && p < 15) return Math.max(0, p - f.flatUnder15);
  return Math.max(0, p - (p * (f.pct || 0)) / 100 - (f.fixed || 0));
}

// One row per sale (an item counts once even if it was marked sold in two places).
export function salesOf(items, fees = settings.fees) {
  const rows = [];
  for (const it of items) {
    const pid = PIDS.find((p) => statusOf(it, p) === "sold");
    if (!pid) continue;
    const l = it.listings[pid];
    const price = +(l.soldPrice || priceFor(it, pid)) || 0;
    const net = netAfterFees(pid, price, fees) ?? 0;
    const cost = +it.overview.cost || 0;
    const soldAt = l.soldAt || it.updatedAt;
    const firstListed = Math.min(...PIDS.map((p) => it.listings[p]?.listedAt || Infinity));
    const daysToSell = Number.isFinite(firstListed) ? Math.max(0, Math.round((soldAt - firstListed) / 864e5)) : null;
    rows.push({ item: it, pid, soldAt, price, fees: price - net, cost, profit: net - cost, ownerUid: it.ownerUid || "", daysToSell });
  }
  return rows.sort((a, b) => b.soldAt - a.soldAt);
}

export const money = (n) =>
  n === "" || n == null || !Number.isFinite(+n)
    ? "—"
    : (+n < 0 ? "-$" : "$") + Math.abs(+n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Change one marketplace's status and keep the dates analytics rely on.
export function setListingStatus(item, pid, status, { soldPrice, soldAt } = {}) {
  const prev = item.listings[pid] || { status: "none" };
  const next = { ...prev, status };
  if (status === "listed" && prev.status !== "listed") {
    // A fresh listing: restart the clock and the view/like counts.
    next.listedAt = Date.now();
    delete next.relistedAt; delete next.views; delete next.likes; delete next.statsAt;
  }
  if (status === "sold") {
    next.soldAt = soldAt || prev.soldAt || Date.now();
    next.soldPrice = soldPrice ?? prev.soldPrice ?? priceFor(item, pid);
    next.listedAt = prev.listedAt || next.soldAt;
  } else {
    delete next.soldAt;
    delete next.soldPrice;
  }
  if (status === "none") delete next.listedAt;
  item.listings = { ...item.listings, [pid]: next };
  return item;
}

export function copyOfItem(item) {
  const copy = structuredClone(item);
  copy.id = uid();
  copy.createdAt = copy.updatedAt = Date.now();
  copy.overview.sku = "";
  copy.listings = Object.fromEntries(PIDS.map((p) => [p, { status: "none" }]));
  copy.history = [];
  copy.favorite = false;
  return copy;
}

export function markRelisted(item, pid) {
  const l = { ...item.listings[pid] };
  l.relistedAt = Date.now();
  l.relistCount = (l.relistCount || 0) + 1;
  delete l.views; delete l.likes; delete l.statsAt;
  item.listings = { ...item.listings, [pid]: l };
}

// A drop of at least 10%, rounded down to whole dollars from $10 up (Poshmark notifies likers at 10%+).
export function droppedPrice(price) {
  const p = +price;
  if (!Number.isFinite(p) || p <= 0) return null;
  const raw = p * 0.9;
  return p >= 10 ? String(Math.floor(raw)) : (Math.floor(raw * 100) / 100).toFixed(2);
}

export function setListingStats(item, pid, views, likes) {
  const l = { ...item.listings[pid], statsAt: Date.now() };
  l.views = views === "" ? "" : Math.max(0, Math.round(+views) || 0);
  l.likes = likes === "" ? "" : Math.max(0, Math.round(+likes) || 0);
  item.listings = { ...item.listings, [pid]: l };
}

// ---------- people ----------
// Fixed order so each person keeps their color (validated categorical palette, slots 1-4).
export const PERSON_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#4a3aa7"];
export const initials = (name) => (String(name || "?").trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2) || "?").toUpperCase();
export const matchesPerson = (item, person) => person === "all" || item.ownerUid === person;
