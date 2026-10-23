# Browser checks

Requires Node.js, Playwright, and Microsoft Edge. With Playwright available to Node, run:

```text
node tests/browser.cjs
```

If Playwright is in a shared installation, set `NODE_PATH` to its parent `node_modules` directory. Optional `SCREENSHOT_DIR` saves a mobile profile screenshot.

The checks start a temporary local server and use isolated browser profiles. They cover database upgrades, atomic writes, recovery, backup rankings and favourites, sync edits and deletions, director filmographies and filters, adding films, offline browsing, keyboard focus, safe rendering, navigation races, and layouts at phone and desktop sizes. They do not access your normal browser collection or call live film APIs.

Watching notes checks cover add/edit/delete, optional film times, collapsed text, draft retention after failed writes, keyboard expansion, reloads, watchlist conversion, concurrent additions, backup/restore, and offline saving.
