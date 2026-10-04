// Cloud storage for a household: sign-in, members, items and photos (Firebase free plan).
//
// Firestore layout
//   users/{uid}                       { name, email, householdId }
//   invites/{code}                    { householdId, createdBy, createdAt }
//   households/{hid}                  { name, ownerUid, members[], memberNames{}, settings{} }
//   households/{hid}/items/{id}       item fields, photos: [{ id, size }], cover (small thumbnail)
//   households/{hid}/photos/{id}      { itemId, data: bytes, createdBy }
import * as fb from "./vendor/firebase.js";
import { firebaseConfig } from "./config.js";
import { migrate, setSharedSettings, uid as newId } from "./model.js";

export const configured = !String(firebaseConfig.apiKey).startsWith("PASTE");

const state = { user: null, profile: null, household: null, items: new Map(), loaded: false, error: null };
const photoCache = new Map();
const listeners = new Set();
let app, auth, fs, unsubHousehold, unsubItems, startedFor = null;

export const current = () => state;
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = (what) => listeners.forEach((fn) => { try { fn(what); } catch (e) { console.error(e); } });

const hid = () => state.household?.id;
const itemsCol = () => fb.collection(fs, "households", hid(), "items");
const itemRef = (id) => fb.doc(fs, "households", hid(), "items", id);
const photoRef = (id) => fb.doc(fs, "households", hid(), "photos", id);

// ---------- start-up ----------
export function start() {
  if (!configured) return;
  app = fb.initializeApp(firebaseConfig);
  auth = fb.getAuth(app);
  // Home-screen apps on iPhone often block Firestore's streaming connection; long polling works there.
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  // ignoreUndefinedProperties: a blank (undefined) field is skipped instead of failing the whole save.
  fs = fb.initializeFirestore(app, {
    ignoreUndefinedProperties: true,
    ...(standalone ? { experimentalForceLongPolling: true } : { experimentalAutoDetectLongPolling: true }),
  });
  // Local testing only: ?emulator=1 on localhost talks to the Firebase emulators.
  if (["localhost", "127.0.0.1"].includes(location.hostname) && new URLSearchParams(location.search).has("emulator")) {
    fb.connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    fb.connectFirestoreEmulator(fs, "127.0.0.1", 8080);
  }
  fb.getRedirectResult(auth).catch((e) => { state.error = friendlyError(e); emit("auth"); });
  fb.onAuthStateChanged(auth, async (user) => {
    stopListening();
    state.user = user;
    state.profile = null;
    state.household = null;
    state.items = new Map();
    state.loaded = false;
    startedFor = user?.uid || null;
    if (!user) return emit("auth");
    try {
      const snap = await fb.getDoc(fb.doc(fs, "users", user.uid));
      if (startedFor !== user.uid) return;
      state.profile = snap.exists() ? snap.data() : { name: user.displayName || "", email: user.email || "" };
      if (state.profile.householdId) await listenToHousehold(state.profile.householdId);
      else emit("auth");

    } catch (e) {
      state.error = friendlyError(e);
      emit("auth");
    }
  });
}

function stopListening() {
  unsubHousehold?.(); unsubItems?.();
  unsubHousehold = unsubItems = null;
}

function listenToHousehold(id) {
  return new Promise((resolve) => {
    let first = true;
    unsubHousehold = fb.onSnapshot(fb.doc(fs, "households", id), (snap) => {
      // Removed from the household (or it was deleted): back to the join screen.
      if (!snap.exists() || !snap.data().members?.includes(state.user?.uid)) {
        stopListening();
        state.household = null;
        state.items = new Map();
        emit("auth");
        return resolve();
      }
      state.household = { id, ...snap.data() };
      setSharedSettings(state.household.settings || {});
      if (first) {
        // First answer: the household is ready, so the router can leave the sign-in screens.
        first = false;
        listenToItems();
        emit("auth");
        return resolve();
      }
      emit("household");
    }, (e) => {
      // Not a member any more, or offline at start.
      state.error = friendlyError(e);
      state.household = null;
      emit("auth");
      resolve();
    });
  });
}

function listenToItems() {
  unsubItems = fb.onSnapshot(itemsCol(), (q) => {
    const fromMe = q.metadata.hasPendingWrites;
    for (const ch of q.docChanges()) {
      if (ch.type === "removed") state.items.delete(ch.doc.id);
      else state.items.set(ch.doc.id, migrate({ ...ch.doc.data(), id: ch.doc.id }));
    }
    state.loaded = true;
    emit(fromMe ? "items-local" : "items");
  }, (e) => { state.error = friendlyError(e); emit("items"); });
}

export function whenLoaded() {
  if (state.loaded || !state.household) return Promise.resolve();
  return new Promise((resolve) => {
    const off = onChange(() => { if (state.loaded || !state.household) { off(); resolve(); } });
  });
}

// ---------- accounts ----------
export async function signUp(name, email, password) {
  const cred = await fb.createUserWithEmailAndPassword(auth, email, password).catch(rethrow);
  await fb.updateProfile(cred.user, { displayName: name }).catch(() => {});
  await fb.setDoc(fb.doc(fs, "users", cred.user.uid), { name, email, householdId: null, createdAt: Date.now() }).catch(rethrow);
  state.profile = { name, email, householdId: null };
  emit("auth");
}
export const signIn = (email, password) => fb.signInWithEmailAndPassword(auth, email, password).catch(rethrow);
export const resetPassword = (email) => fb.sendPasswordResetEmail(auth, email).catch(rethrow);
export const signOutNow = () => fb.signOut(auth);
export async function signInWithGoogle() {
  const provider = new fb.GoogleAuthProvider();
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  if (standalone) return fb.signInWithRedirect(auth, provider).catch(rethrow);
  const cred = await fb.signInWithPopup(auth, provider).catch(rethrow);
  const ref = fb.doc(fs, "users", cred.user.uid);
  const snap = await fb.getDoc(ref);
  if (!snap.exists()) await fb.setDoc(ref, { name: cred.user.displayName || "", email: cred.user.email || "", householdId: null, createdAt: Date.now() });
}

export const myUid = () => state.user?.uid;
export const myName = () => state.household?.memberNames?.[myUid()] || state.profile?.name || state.user?.email?.split("@")[0] || "Me";

// ---------- household ----------
// Codes avoid look-alike characters (0/O, 1/I/L) so they're easy to read out loud.
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");

export async function createHousehold(name, myDisplayName) {
  const uidMe = myUid();
  const ref = fb.doc(fb.collection(fs, "households"));
  await fb.setDoc(ref, {
    name, ownerUid: uidMe, members: [uidMe], memberNames: { [uidMe]: myDisplayName }, settings: {}, createdAt: Date.now(),
  }).catch(rethrow);
  await fb.setDoc(fb.doc(fs, "users", uidMe), { name: myDisplayName, email: state.user.email || "", householdId: ref.id }, { merge: true }).catch(rethrow);
  state.profile = { ...state.profile, name: myDisplayName, householdId: ref.id };
  await listenToHousehold(ref.id);
}

export async function joinHousehold(code, myDisplayName) {
  const clean = String(code).toUpperCase().replace(/[^A-Z0-9]/g, "");
  const inv = await fb.getDoc(fb.doc(fs, "invites", clean)).catch(rethrow);
  if (!inv.exists()) throw new Error("That invite code wasn't found. Check it and try again.");
  const householdId = inv.data().householdId;
  const uidMe = myUid();
  await fb.updateDoc(fb.doc(fs, "households", householdId), {
    members: fb.arrayUnion(uidMe), [`memberNames.${uidMe}`]: myDisplayName, joinCode: clean,
  }).catch((e) => {
    if (e?.code === "permission-denied") throw new Error("Couldn't join. The household may be full or the invite was replaced.");
    rethrow(e);
  });
  await fb.setDoc(fb.doc(fs, "users", uidMe), { name: myDisplayName, email: state.user.email || "", householdId }, { merge: true }).catch(rethrow);
  state.profile = { ...state.profile, name: myDisplayName, householdId };
  await listenToHousehold(householdId);
}

export async function createInvite() {
  const code = newCode();
  const old = state.household.inviteCode;
  await fb.setDoc(fb.doc(fs, "invites", code), { householdId: hid(), createdBy: myUid(), createdAt: Date.now() }).catch(rethrow);
  await fb.updateDoc(fb.doc(fs, "households", hid()), { inviteCode: code }).catch(rethrow);
  if (old) await fb.deleteDoc(fb.doc(fs, "invites", old)).catch(() => {});
  return code;
}

export const renameMe = (name) =>
  fb.updateDoc(fb.doc(fs, "households", hid()), { [`memberNames.${myUid()}`]: name }).catch(rethrow);
export const renameHousehold = (name) => fb.updateDoc(fb.doc(fs, "households", hid()), { name }).catch(rethrow);
export const saveSharedSettings = (settings) =>
  fb.updateDoc(fb.doc(fs, "households", hid()), { settings }).catch(rethrow);

export async function removeMember(uidOther) {
  await fb.updateDoc(fb.doc(fs, "households", hid()), {
    members: fb.arrayRemove(uidOther), [`memberNames.${uidOther}`]: fb.deleteField(),
  }).catch(rethrow);
}
export async function leaveHousehold() {
  const id = hid(), me = myUid();
  await fb.setDoc(fb.doc(fs, "users", me), { householdId: null }, { merge: true }).catch(rethrow);
  await fb.updateDoc(fb.doc(fs, "households", id), { members: fb.arrayRemove(me), [`memberNames.${me}`]: fb.deleteField() }).catch(rethrow);
}

// ---------- items ----------
const stripForCloud = (item) => {
  const { id, ...rest } = item;
  return { ...rest, photos: (item.photos || []).map(({ id: pid, size }) => ({ id: pid, size: size || 0 })) };
};

export const allItems = async () => [...state.items.values()];
export const getItem = async (id) => {
  const it = state.items.get(id);
  return it ? structuredClone(it) : null;
};

// Full write, used for new items and copies.
export async function putItem(item) {
  item.updatedAt = Date.now();
  item.updatedBy = myUid();
  await fb.setDoc(itemRef(item.id), stripForCloud(item)).catch(rethrow);
}

// Partial write: only the listed fields, so two people editing different parts don't overwrite each other.
// paths are dotted, e.g. ["overview.title", "listings.ebay"]. history entries are appended, never replaced.
export async function saveFields(item, paths, historyEntry) {
  const patch = { updatedAt: Date.now(), updatedBy: myUid() };
  // A parent path already covers its children ("market" includes "market.ebay.price"); sending both is an error.
  const unique = [...new Set(paths)];
  const kept = unique.filter((p) => !unique.some((q) => q !== p && p.startsWith(q + ".")));
  for (const p of kept) {
    let v = p.split(".").reduce((o, k) => o?.[k], item);
    if (p === "photos") v = stripForCloud(item).photos;
    patch[p] = v === undefined ? fb.deleteField() : v;
  }
  if (historyEntry) {
    const entry = JSON.parse(JSON.stringify({ at: Date.now(), by: myUid(), ...historyEntry }));
    item.history = [...(item.history || []), entry];
    patch.history = item.history.length > 40 ? (item.history = item.history.slice(-30)) : fb.arrayUnion(entry);
  }
  item.updatedAt = patch.updatedAt;
  await fb.updateDoc(itemRef(item.id), patch).catch(rethrow);
}

export async function deleteItem(item) {
  const batch = fb.writeBatch(fs);
  for (const p of item.photos || []) batch.delete(photoRef(p.id));
  batch.delete(itemRef(item.id));
  await batch.commit().catch(rethrow);
  for (const p of item.photos || []) photoCache.delete(p.id);
}

// ---------- photos ----------
function dataUrlToBytes(dataUrl) {
  const bin = atob(dataUrl.split(",")[1]);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}
function bytesToDataUrl(arr, type = "image/jpeg") {
  let s = "";
  for (let i = 0; i < arr.length; i += 0x8000) s += String.fromCharCode(...arr.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(s)}`;
}

// Saves one photo and returns its record for item.photos.
export async function addPhoto(item, dataUrl) {
  const id = newId();
  const bytes = dataUrlToBytes(dataUrl);
  await fb.setDoc(photoRef(id), { itemId: item.id, data: fb.Bytes.fromUint8Array(bytes), createdBy: myUid(), createdAt: Date.now() }).catch(rethrow);
  photoCache.set(id, dataUrl);
  return { id, size: bytes.length, dataUrl };
}

export async function removePhoto(photoId) {
  await fb.deleteDoc(photoRef(photoId)).catch(rethrow);
  photoCache.delete(photoId);
}

// Fills in dataUrl for each of the item's photos (downloaded once, then kept in memory).
export async function loadPhotos(item) {
  await Promise.all((item.photos || []).map(async (p) => {
    if (p.dataUrl) return;
    if (!photoCache.has(p.id)) {
      const snap = await fb.getDoc(photoRef(p.id)).catch(rethrow);
      if (snap.exists()) photoCache.set(p.id, bytesToDataUrl(snap.data().data.toUint8Array()));
    }
    p.dataUrl = photoCache.get(p.id) || "";
  }));
  item.photos = item.photos.filter((p) => p.dataUrl);
  return item;
}

export async function copyItemWithPhotos(source, copy) {
  await loadPhotos(source);
  copy.photos = [];
  for (const p of source.photos) copy.photos.push(await addPhoto(copy, p.dataUrl));
  await putItem(copy);
  return copy;
}

// Approximate storage used by photos (the free plan includes 1 GiB in total).
export const photoBytesUsed = () => [...state.items.values()].reduce((s, it) => s + (it.photos || []).reduce((a, p) => a + (p.size || 0), 0), 0);

// ---------- errors ----------
function friendlyError(e) {
  const code = e?.code || "";
  const map = {
    "auth/invalid-credential": "Wrong email or password.",
    "auth/wrong-password": "Wrong email or password.",
    "auth/user-not-found": "No account with that email. Create one instead.",
    "auth/email-already-in-use": "There's already an account with that email. Sign in instead.",
    "auth/weak-password": "Use a password with at least 6 characters.",
    "auth/invalid-email": "That email address doesn't look right.",
    "auth/popup-closed-by-user": "Google sign-in was closed before it finished.",
    "auth/network-request-failed": "No internet connection. Try again.",
    "auth/too-many-requests": "Too many attempts. Wait a few minutes and try again.",
    "auth/unauthorized-domain": "This website isn't allowed to sign in yet. Add it under Firebase → Authentication → Settings → Authorized domains.",
    "permission-denied": "You don't have access to that. You may have been removed from the household.",
    "resource-exhausted": "The free daily limit was reached. It resets tomorrow.",
    "unavailable": "Can't reach the server. Check your internet connection.",
  };
  return map[code] || e?.message || String(e);
}
function rethrow(e) { throw new Error(friendlyError(e)); }
export { friendlyError };
