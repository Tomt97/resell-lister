// Screens shown before the app: setup needed, sign in / create account, create or join a household.
import * as store from "../store.js";
import { esc, toast } from "../ui.js";

const pendingCode = () => { try { return sessionStorage.getItem("rl.joinCode") || ""; } catch { return ""; } };
export const rememberJoinCode = (code) => { try { sessionStorage.setItem("rl.joinCode", code); } catch {} };

export function renderSetupNeeded($view) {
  $view.innerHTML = `
    <div class="auth-wrap"><section class="card">
      <h1>Almost there</h1>
      <p>The app needs its free Firebase project to save items and let you and your household sign in.</p>
      <p>Follow <b>"Set up the shared inventory"</b> in the README on GitHub, then paste the settings into <code>app/config.js</code>.</p>
    </section></div>`;
}

export function renderSignIn($view) {
  let mode = "in";
  const err = store.current().error;
  const draw = (msg = err || "") => {
    $view.innerHTML = `
      <div class="auth-wrap">
        <div class="auth-brand"><img src="icons/icon-192.png" alt=""><h1>Resell Lister</h1></div>
        <section class="card">
          <div class="tabs" role="tablist">
            <button role="tab" data-mode="in" class="${mode === "in" ? "on" : ""}" aria-selected="${mode === "in"}">Sign in</button>
            <button role="tab" data-mode="up" class="${mode === "up" ? "on" : ""}" aria-selected="${mode === "up"}">Create account</button>
          </div>
          ${pendingCode() ? `<p class="small ok-text">You've been invited to a household. Sign in or create an account to join.</p>` : ""}
          <form id="authForm" novalidate>
            ${mode === "up" ? `<label for="a-name">Your first name</label><input id="a-name" autocomplete="given-name" required>` : ""}
            <label for="a-email">Email</label><input id="a-email" type="email" autocomplete="email" required>
            <label for="a-pass">Password</label><input id="a-pass" type="password" autocomplete="${mode === "up" ? "new-password" : "current-password"}" minlength="6" required>
            ${msg ? `<p class="small warn-text" role="alert">${esc(msg)}</p>` : ""}
            <div class="row" style="margin-top:12px">
              <button class="primary" type="submit">${mode === "up" ? "Create account" : "Sign in"}</button>
              ${mode === "in" ? `<button type="button" class="link" id="forgot">Forgot password?</button>` : ""}
            </div>
          </form>
          <div class="or"><span>or</span></div>
          <button id="google" type="button">Continue with Google</button>
        </section>
        <p class="small muted">Each person in the household uses their own account.</p>
      </div>`;
    document.querySelectorAll("[data-mode]").forEach((b) => (b.onclick = () => { mode = b.dataset.mode; draw(""); }));
    const form = document.getElementById("authForm");
    form.onsubmit = async (e) => {
      e.preventDefault();
      const email = document.getElementById("a-email").value.trim();
      const pass = document.getElementById("a-pass").value;
      const name = document.getElementById("a-name")?.value.trim();
      if (mode === "up" && !name) return draw("Enter your first name.");
      if (!email || pass.length < 6) return draw("Enter your email and a password of at least 6 characters.");
      form.querySelector("button[type=submit]").disabled = true;
      try {
        if (mode === "up") await store.signUp(name, email, pass);
        else await store.signIn(email, pass);
      } catch (ex) { draw(ex.message); }
    };
    const forgot = document.getElementById("forgot");
    if (forgot) forgot.onclick = async () => {
      const email = document.getElementById("a-email").value.trim();
      if (!email) return draw("Type your email above, then tap Forgot password.");
      try { await store.resetPassword(email); toast("Password reset email sent", 3500); }
      catch (ex) { draw(ex.message); }
    };
    document.getElementById("google").onclick = async () => {
      try { await store.signInWithGoogle(); } catch (ex) { draw(ex.message); }
    };
  };
  draw();
}

export function renderHouseholdSetup($view) {
  const st = store.current();
  const defaultName = st.profile?.name || st.user?.displayName || "";
  const code = pendingCode();
  $view.innerHTML = `
    <div class="auth-wrap">
      <h1>Set up your household</h1>
      <p class="muted">A household is the shared inventory. Everyone in it sees all items, and each item shows who it belongs to.</p>
      <section class="card">
        <label for="h-me">Your name (shown to the household)</label>
        <input id="h-me" value="${esc(defaultName)}" autocomplete="given-name">
      </section>
      <section class="card">
        <h2>Join your household</h2>
        <p class="small muted">Someone in the household can find the invite code in their Settings.</p>
        <label for="h-code">Invite code</label>
        <input id="h-code" value="${esc(code)}" autocapitalize="characters" autocomplete="off" placeholder="e.g. K7Q2M9XWTR">
        <div class="row" style="margin-top:10px"><button class="primary" id="join">Join household</button></div>
      </section>
      <section class="card">
        <h2>Or start a new household</h2>
        <label for="h-name">Household name</label>
        <input id="h-name" placeholder="e.g. Tom & Jane's closet">
        <div class="row" style="margin-top:10px"><button id="create">Create household</button></div>
      </section>
      <p class="small muted">Signed in as ${esc(st.user?.email || "")}. <button class="link" id="out">Sign out</button></p>
    </div>`;
  const me = () => document.getElementById("h-me").value.trim();
  const busy = (b, on) => { b.disabled = on; };
  document.getElementById("join").onclick = async (e) => {
    if (!me()) return toast("Enter your name first.");
    const c = document.getElementById("h-code").value.trim();
    if (!c) return toast("Enter the invite code.");
    busy(e.target, true);
    try { await store.joinHousehold(c, me()); rememberJoinCode(""); location.hash = "#/"; }
    catch (ex) { toast(ex.message, 5000); busy(e.target, false); }
  };
  document.getElementById("create").onclick = async (e) => {
    if (!me()) return toast("Enter your name first.");
    const n = document.getElementById("h-name").value.trim() || `${me()}'s household`;
    busy(e.target, true);
    try { await store.createHousehold(n, me()); location.hash = "#/settings"; toast("Household created. Invite your partner from Settings.", 4500); }
    catch (ex) { toast(ex.message, 5000); busy(e.target, false); }
  };
  document.getElementById("out").onclick = () => store.signOutNow();
}
