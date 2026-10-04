# Resell Lister

Take photos, type a price. AI writes your eBay, Poshmark and Vinted listings (title, description,
category, condition, brand, size, colors, item specifics). A Chrome extension then fills in each
site's sell form for you.

- **app/**: the web app. Works on phone and computer, and installs like an app.
- **extension/**: the Chrome extension that fills the sell forms on eBay, Poshmark and Vinted (US sites).

## How it works

The layout follows the crosslisting tools resellers already know (such as Nifty):

- **Home**: getting-started checklist, today's summary (listed, sold, sales, active), and
  **Needs attention**: items sold on one site but still listed on another, and drafts missing
  photos, a listing or a price.
- **Inventory**: one row per item, one column per marketplace. Each marketplace cell shows the
  item photo with its status (Listed, Sold, Delisted), or an empty square if it isn't listed there.
  Click a cell to change the status. Marking it sold asks for the sale price and date, then reminds
  you where to take the listing down. Also: search (title, SKU, brand, label), status filters
  (All, Listed, Drafts, Sold, Delisted, Needs attention, Favorites), label filters (has / without),
  sorting, an item menu (Edit, Copy, Favorite, Send to extension, Delete), bulk actions on
  selected items (Send to extension, Add label, Mark delisted, Delete) and 25 items per page.
  On a phone each item becomes a card.
- **Add item / edit item** (saves automatically):
  1. **Marketplaces**: where you want to list it.
  2. **Photos**: up to 24, first is the cover. Below them, the purple **Generate listing** box.
     The AI reads up to 8 photos (including tags and handwritten measurement cards) and fills in
     everything below. Pick a description style (Friendly, Short & simple, Detailed). You also get a
     price idea, flaws spotted, and a check-before-posting list.
  3. **Item overview**: title, description, condition, price, cost of goods, SKU. Shared by every
     marketplace.
  4. **Item details**: category, brand, size, colors, style tags.
  5. **Only you see this**: private notes and labels.
  6. **Marketplace details**: a tab per marketplace with its own title, category, condition,
     specifics and price. Blank fields use the overview (shown in grey). Also the listing status.
- **Analytics**: profit, revenue, units sold, listings created, sell-through rate, fees, average
  sale for a time range; revenue vs profit by month; a per-marketplace table; and a sales list you
  can download as CSV.
- **Chrome extension**: press **Send to extension**, open a sell page, click the green
  **Resell Lister** button and **Fill this form**. It adds the photos, title, description, price
  and brand, with copy buttons for the rest. You press the site's own List button.

## What this doesn't do (compared with Nifty)

- **No account connections, so no automatic sale detection, auto-delisting, sharing, offers or
  relisting.** Those need the marketplaces' logins and servers running all day. Here you mark
  sales yourself, and the app reminds you what to delist.
- **No live sold-price comparisons, photo background removal or bulk AI generation** yet.

## Limits to know about

- **Vinted and Poshmark have no public listing API.** The extension fills the form in your own
  logged-in browser, the same way Vendoo and Nifty work. **You** press Post. The tool doesn't post
  on its own, which keeps your accounts safer.
- **The sites change their pages.** If a field stops filling, the copy buttons still work. Tell
  Claude which field broke so the extension can be updated.
- **Price ideas are AI estimates from the photos, not live sold prices.** Your price is always
  the one that's used.
- **Items are stored in the browser you use.** Use Settings → Download backup to move them to
  another device.
- **The extension needs Chrome (or Edge or Brave) on a computer.** On a phone, use the app and
  its copy buttons.

## Setup

### 1. Claude API key (pay as you go, about 2 to 5 cents per item)
1. Go to https://console.anthropic.com, sign up, and add a little credit under **Billing**.
2. **Settings → API keys → Create key.** Copy it.
3. Open the app → **Settings** → paste the key → **Save key**. It stays in that browser only.

### 2. Put the app online (GitHub Pages, free)
1. In this repository on GitHub: **Settings → Pages → Deploy from a branch → `main` / `(root)` → Save.**
   (Free GitHub accounts need the repository to be **public** for Pages. No keys are stored in the code.)
2. After a minute the app is at `https://<your-username>.github.io/resell-lister/app/`.
3. Phone: open that link → **Share → Add to Home Screen** (iPhone) or **Install app** (Android).

### 3. Install the Chrome extension
1. Download this repository (**Code → Download ZIP**) and unzip it.
2. In Chrome go to `chrome://extensions`, turn on **Developer mode** (top right).
3. **Load unpacked** → choose the `extension` folder.
4. Reload the app page. The "extension isn't detected" note goes away.

## Privacy
Photos and listings stay in your browser. Photos are sent only to Anthropic (Claude) when you
press the AI button. The extension only runs on the app page and on ebay.com, poshmark.com
and vinted.com.
