import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, arrayUnion, arrayRemove, deleteField, collection, getDocs, Bytes } from "firebase/firestore";
import { readFileSync } from "fs";

const env = await initializeTestEnvironment({ projectId: "demo-resell", firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8080 } });
let pass = 0, fail = 0;
const t = async (name, p) => { try { await p; console.log("PASS", name); pass++; } catch (e) { console.log("FAIL", name, e.message.split("\n")[0]); fail++; } };
const db = (uid) => env.authenticatedContext(uid).firestore();
const anon = env.unauthenticatedContext().firestore();
const tom = db("tom"), jane = db("jane"), eve = db("eve"), kid = db("kid");

// Household creation
await t("create own household", assertSucceeds(setDoc(doc(tom, "households/h1"), { name: "T&J", ownerUid: "tom", members: ["tom"], memberNames: { tom: "Tom" }, settings: {}, createdAt: 1 })));
await t("cannot create household listing someone else", assertFails(setDoc(doc(eve, "households/h2"), { name: "x", ownerUid: "eve", members: ["eve", "tom"], memberNames: {}, settings: {}, createdAt: 1 })));
await t("cannot create household with extra fields", assertFails(setDoc(doc(eve, "households/h3"), { name: "x", ownerUid: "eve", members: ["eve"], memberNames: {}, settings: {}, createdAt: 1, inviteCode: "X" })));
await t("member reads household", assertSucceeds(getDoc(doc(tom, "households/h1"))));
await t("outsider cannot read household", assertFails(getDoc(doc(eve, "households/h1"))));
await t("signed-out cannot read household", assertFails(getDoc(doc(anon, "households/h1"))));
await t("nobody can list households", assertFails(getDocs(collection(tom, "households"))));

// Invites
await t("member creates invite", assertSucceeds(setDoc(doc(tom, "invites/ABCDEFGHJK"), { householdId: "h1", createdBy: "tom", createdAt: 1 })));
await t("outsider cannot create invite for household", assertFails(setDoc(doc(eve, "invites/EVEEVEEVE1"), { householdId: "h1", createdBy: "eve", createdAt: 1 })));
await t("short invite code rejected", assertFails(setDoc(doc(tom, "invites/ABC"), { householdId: "h1", createdBy: "tom", createdAt: 1 })));
await t("member sets inviteCode on household", assertSucceeds(updateDoc(doc(tom, "households/h1"), { inviteCode: "ABCDEFGHJK" })));
await t("signed-in user can look up an invite by code", assertSucceeds(getDoc(doc(jane, "invites/ABCDEFGHJK"))));
await t("nobody can list invites", assertFails(getDocs(collection(jane, "invites"))));

// Joining
await t("join with wrong code fails", assertFails(updateDoc(doc(eve, "households/h1"), { members: arrayUnion("eve"), "memberNames.eve": "Eve", joinCode: "WRONGCODE1" })));
await t("join adding someone else fails", assertFails(updateDoc(doc(eve, "households/h1"), { members: arrayUnion("eve", "mallory"), "memberNames.eve": "Eve", joinCode: "ABCDEFGHJK" })));
await t("join that renames another member fails", assertFails(updateDoc(doc(eve, "households/h1"), { members: arrayUnion("eve"), "memberNames.tom": "Hacked", "memberNames.eve": "Eve", joinCode: "ABCDEFGHJK" })));
await t("join that also changes owner fails", assertFails(updateDoc(doc(eve, "households/h1"), { members: arrayUnion("eve"), "memberNames.eve": "Eve", joinCode: "ABCDEFGHJK", ownerUid: "eve" })));
await t("jane joins with the right code", assertSucceeds(updateDoc(doc(jane, "households/h1"), { members: arrayUnion("jane"), "memberNames.jane": "Jane", joinCode: "ABCDEFGHJK" })));
await t("jane now reads household", assertSucceeds(getDoc(doc(jane, "households/h1"))));

// Old code stops working after a new one
await t("tom makes a new invite", assertSucceeds(setDoc(doc(tom, "invites/NEWCODE234"), { householdId: "h1", createdBy: "tom", createdAt: 2 })));
await t("tom switches household to the new code", assertSucceeds(updateDoc(doc(tom, "households/h1"), { inviteCode: "NEWCODE234" })));
await t("old code no longer joins", assertFails(updateDoc(doc(eve, "households/h1"), { members: arrayUnion("eve"), "memberNames.eve": "Eve", joinCode: "ABCDEFGHJK" })));
// An invite for another household can't be used here
await setDoc(doc(eve, "households/h9"), { name: "Eve's", ownerUid: "eve", members: ["eve"], memberNames: { eve: "Eve" }, settings: {}, createdAt: 1 });
await t("eve makes invite for her own household", assertSucceeds(setDoc(doc(eve, "invites/EVECODE234"), { householdId: "h9", createdBy: "eve", createdAt: 1 })));
await t("eve can't use her invite on tom's household", assertFails(updateDoc(doc(eve, "households/h1"), { members: arrayUnion("eve"), "memberNames.eve": "Eve", joinCode: "EVECODE234" })));

// Member edits
await t("member renames household + shared settings", assertSucceeds(updateDoc(doc(jane, "households/h1"), { name: "Our closet", settings: { relist: { ebay: { on: true, days: 30 } } } })));
await t("non-owner cannot remove another member", assertFails(updateDoc(doc(jane, "households/h1"), { members: arrayRemove("tom") })));
await t("member cannot take ownership", assertFails(updateDoc(doc(jane, "households/h1"), { ownerUid: "jane" })));
await t("member cannot add someone directly", assertFails(updateDoc(doc(jane, "households/h1"), { members: arrayUnion("mallory") })));

// Items
const item = { ownerUid: "tom", updatedBy: "tom", overview: { title: "Jeans" } };
await t("member creates item", assertSucceeds(setDoc(doc(tom, "households/h1/items/i1"), item)));
await t("other member edits item", assertSucceeds(updateDoc(doc(jane, "households/h1/items/i1"), { "overview.title": "Levi's", updatedBy: "jane" })));
await t("edit must be signed as yourself", assertFails(updateDoc(doc(jane, "households/h1/items/i1"), { "overview.title": "x", updatedBy: "tom" })));
await t("outsider cannot read items", assertFails(getDocs(collection(eve, "households/h1/items"))));
await t("outsider cannot write items", assertFails(setDoc(doc(eve, "households/h1/items/i2"), { ownerUid: "eve", updatedBy: "eve" })));
await t("member lists items", assertSucceeds(getDocs(collection(jane, "households/h1/items"))));

// Photos
const small = Bytes.fromUint8Array(new Uint8Array(200000));
const big = Bytes.fromUint8Array(new Uint8Array(1000001));
await t("member saves photo", assertSucceeds(setDoc(doc(tom, "households/h1/photos/p1"), { itemId: "i1", data: small, createdBy: "tom", createdAt: 1 })));
await t("photo over 1 MB rejected", assertFails(setDoc(doc(tom, "households/h1/photos/p2"), { itemId: "i1", data: big, createdBy: "tom", createdAt: 1 })));
await t("photo must be bytes", assertFails(setDoc(doc(tom, "households/h1/photos/p3"), { itemId: "i1", data: "abc", createdBy: "tom", createdAt: 1 })));
await t("outsider cannot read photo", assertFails(getDoc(doc(eve, "households/h1/photos/p1"))));
await t("member reads photo", assertSucceeds(getDoc(doc(jane, "households/h1/photos/p1"))));

// Users
await t("own profile write", assertSucceeds(setDoc(doc(jane, "users/jane"), { householdId: "h1" })));
await t("cannot read someone else's profile", assertFails(getDoc(doc(jane, "users/tom"))));

// Leaving and removal
await setDoc(doc(kid, "users/kid"), {});
await t("kid joins", assertSucceeds(updateDoc(doc(kid, "households/h1"), { members: arrayUnion("kid"), "memberNames.kid": "Kid", joinCode: "NEWCODE234" })));
await t("kid leaves (removes only self)", assertSucceeds(updateDoc(doc(kid, "households/h1"), { members: arrayRemove("kid"), "memberNames.kid": deleteField() })));
await t("owner can't leave by removing self", assertFails(updateDoc(doc(tom, "households/h1"), { members: arrayRemove("tom") })));
await t("owner removes jane", assertSucceeds(updateDoc(doc(tom, "households/h1"), { members: arrayRemove("jane"), "memberNames.jane": deleteField() })));
await t("removed member loses item access", assertFails(getDocs(collection(jane, "households/h1/items"))));
await t("nobody can delete a household", assertFails(deleteDoc(doc(tom, "households/h1"))));
await t("member deletes item", assertSucceeds(deleteDoc(doc(tom, "households/h1/items/i1"))));

console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup();
process.exit(fail ? 1 : 0);
