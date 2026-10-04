# Tests

Both run against the Firebase emulators (local copies of Firebase), never your real project.
Needs Node 20+ and Java 11+.

```bash
cd tests
npm install
npm run test:rules   # 48 checks: outsiders, invites, joining, removing members, photo limits
# The browser test needs the site served on port 8766 from the repository root:
(cd .. && python3 -m http.server 8766 &)
npm run test:e2e     # two people (Tom and Jane) sign up, share a household, list, ship, sell and relist
node extension.test.mjs   # loads the real Chrome extension and checks the eBay/Vinted sell-page panel
```

`e2e.test.mjs` options: `CHROME=/path/to/chrome` to pick a browser, `SHOTS=/some/folder` for screenshots.
