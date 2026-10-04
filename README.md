# Resell Lister

Take photos, type a price. AI writes your eBay, Poshmark and Vinted listings (title, description,
category, condition, brand, size, colors, item specifics). You and your partner each sign in with
your own account and keep your own inventory, and either of you can look at the other's (or both
together) to see how sales are going and which listings have gone stale and need a relist.

- **app/**: the web app. Works on phone and computer, and installs like an app.
- **extension/**: an optional Chrome extension (computer only) that fills the eBay, Poshmark and Vinted sell forms.
- **firestore.rules**: the database's security rules (who can see and change what).

## What it costs

| Part | Cost |
|---|---|
| Website (GitHub Pages) | Free |
| Accounts, shared inventory, photos (Firebase free "Spark" plan) | Free, no credit card. Includes 1 GB of storage (roughly 6,000 photos) and 50,000 reads a day. |
| AI listing writer (Claude API) | **Not free**: roughly 5 to 15 cents per item with Claude Opus 5.5, about half with Claude Sonnet 5.5. Optional: everything else works without it. |

## How it works

- **Accounts and separate inventories**: each person signs in (email and password, or Google). One
  person creates the household and shares an invite link; the other joins with it. Each of you
  opens the app to **your own inventory**: your items, your Home and your Analytics. New items always
  go into your own inventory. The **Inventory: Mine / Jane's / Both** switch lets you look at your
  partner's inventory (a banner reminds you whose you're viewing, with **Back to mine**), or both
  together with a colored initial on each item and a **By person** table in Analytics. You can hand
  an item over with **Belongs to** on the item.
- **Home**: today's summary, **Needs attention** (sold on one site but still listed elsewhere,
  stale listings, unfinished drafts) and **Recent activity** on those items (who added, listed,
  sold, relisted or repriced what), all for the inventory you're viewing.
- **Inventory**: one row per item, one column per marketplace, with the days each listing has been up.
  Tap a cell to mark it listed, sold (asks the sale price and date), delisted or relisted, drop the
  price 10%, or record views and likes. Search, status filters (including **Needs relist**),
  labels, sorting, and bulk actions (send to extension, add label, assign to a person, mark
  delisted, delete).
- **Relisting**: a listing counts as stale after a set number of days without selling
  (Poshmark 30, Vinted 21; eBay reminders start off because "Good 'Til Cancelled" listings renew
  by themselves). Stale listings show free tips for that site: share it, send offers to likers or
  watchers, drop the price at least 10% so likers are notified, or relist. Change the days in
  Settings; the rules are shared by the household.
- **Add / edit item** (saves automatically): who it belongs to and where to list it, photos (up to 24)
  with the purple **Generate listing** box, item overview, item details, private notes and labels,
  then each marketplace's own title, category, condition, specifics and price. If your partner
  changes the item while you have it open, you'll see "Jane just changed this item" with a button
  to load their version. Saves only send the fields you changed, so you don't overwrite each other.
- **Shipping & package**: on each item, pick your packaging (its size fills in), enter the packed
  weight, then the eBay package type (Letter, Large Envelope, Package, Large Package), shipping
  service, who pays (calculated, free or flat rate) and handling time, and the Vinted parcel size
  (Small up to 1 lb, Medium 1 to 2 lb, Large 2 to 5 lb). The app suggests the eBay type from the box
  size and the Vinted size from the weight, and the AI guesses the weight from the photos (marked as a
  guess until you weigh it). Your household's boxes and mailers are listed under **Settings → Packaging**.
- **Analytics**: profit, revenue, units sold, sell-through, fees, average sale and average days to
  sell; revenue vs profit by month; tables **by person** and by marketplace; a sales list you can
  download as CSV.

## Limits to know about

- **No automatic sale detection or auto-delisting.** Those need logins to your marketplace
  accounts and a server running all day, which isn't free. You mark sales, and the app reminds
  you what to remove elsewhere.
- **Views and likes are typed in by you**, copied from the listing. The marketplaces don't offer a
  free way for an app like this to read them.
- **Vinted and Poshmark have no public listing API.** The extension fills the form in your own
  logged-in browser; you press Post. On a phone, use the copy buttons.
- **Price ideas are AI estimates from the photos, not live sold prices.**
- **Fees are estimates** you can change in Settings.

## Setup

### 1. Put the app online (GitHub Pages)
In this repository: **Settings → Pages → Deploy from a branch → `main` / `(root)` → Save**.
After a minute or two the app is at `https://tomt97.github.io/resell-lister/`.

### 2. Set up the shared inventory (Firebase, free, about 15 minutes, works on a phone)
Firebase's website works in a phone browser; if a button seems to be missing, use the browser's
"Desktop site" option.

1. Go to **https://console.firebase.google.com** and sign in with a Google account.
2. **Create a project** → name it `resell-lister` → you can turn **Google Analytics off** → **Create project**.
   It starts on the free Spark plan; don't add billing.
3. **Build → Authentication → Get started.** Under **Sign-in method**, enable **Email/Password** → Save.
   (Optional: also enable **Google** and pick your email as the support email.)
4. Still in Authentication: **Settings → Authorized domains → Add domain** → `tomt97.github.io` → Add.
5. **Build → Firestore Database → Create database.** Pick a location near you (it can't be changed
   later, e.g. a United States location), choose **production mode**, and create it.
6. In Firestore, open the **Rules** tab. Replace everything with the contents of `firestore.rules`
   from this repository (open the file on GitHub, tap **Raw**, select all, copy) → **Publish**.
7. **Project settings** (gear icon) → **General** → **Your apps** → the web icon **`</>`** → give it a
   nickname → **Register app** (no Hosting needed). You'll see a `firebaseConfig` block.
8. Put those values into `app/config.js`: on GitHub open the file → pencil icon → paste each value
   between the quotes → **Commit changes**. (Or send the values to Claude to do it. They're safe to
   share and publish: the security rules, not secrecy, protect your data.)

### 3. Create your household
1. Open the app, tap **Create account**, and sign up.
2. Choose **Start a new household** and give it a name.
3. In **Settings → Invite your partner**, tap **Create invite code**, then **Share invite link**
   and text it to your partner. They open it, create their own account, and tap **Join household**.

### 4. Optional extras
- **AI listings**: get a key at https://console.anthropic.com (**Settings → API keys**), add a little
  credit under Billing, then paste it in the app under **Settings → AI listings**. Each device
  keeps its own key; you can both use the same key.
- **Install on your phone**: iPhone Safari → **Share → Add to Home Screen**. Android Chrome → **⋮ → Install app**.
- **Chrome extension (computer)**: **Code → Download ZIP**, unzip, open `chrome://extensions`, turn on
  **Developer mode**, **Load unpacked**, and choose the `extension` folder.

### Moving items from the earlier version
If you used the earlier, device-only version, open **Settings** on that device after signing in and
tap **Move to household**.

## Privacy
Items and photos are stored in your own Firebase project, readable only by members of your
household (see `firestore.rules`). Photos go to Anthropic (Claude) only when you press
**Generate listing**. The extension only runs on the app page and on ebay.com, poshmark.com and vinted.com.

## Tests
`tests/` has the security-rule tests and a two-person browser test that run against the Firebase
emulators. See `tests/README.md`.
