# Resell Lister

Take photos, type a price. AI writes your eBay, Poshmark and Vinted listings (title, description,
category, condition, brand, size, colors, item specifics). A Chrome extension then fills in each
site's sell form for you.

- **app/**: the web app. Works on phone and computer, and installs like an app.
- **extension/**: the Chrome extension that fills the sell forms on eBay, Poshmark and Vinted (US sites).

## How it works

1. **New item**: add photos, your price and (optionally) what you paid and any notes.
2. **Write my listings with AI**: Claude looks at the photos and writes a listing for each site,
   using that site's own categories and condition wording. It also lists flaws it spotted, gives a
   price idea and a "check before posting" list. Edit anything you like.
3. **Send to extension**, then **Open eBay / Poshmark / Vinted**. On the sell page, click the
   green **Resell Lister** button (bottom-right) and then **Fill this form**. It adds the photos,
   title, description, price and brand. Category, condition, size and color menus have copy
   buttons next to them. Check the form and press the site's own List button.
4. When something sells, set its status to **Sold**. The app flags the other sites where it's
   still listed so you remember to remove it there.

## What it can't do (and why)

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
