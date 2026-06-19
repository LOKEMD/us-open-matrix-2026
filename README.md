# 2026 U.S. Open — Matrix Pool (live site)

A live web version of the "Matrix" pool spreadsheet. Team scores recompute
automatically from the live U.S. Open leaderboard — no manual updating.

## Files
- `index.html` — the whole app (HTML + CSS + JS, no dependencies)
- `data.js` — the 233 team rosters (names + winner pick), generated from the spreadsheet

## How it works
- Live scores come from ESPN's public golf API (event 401811952, Shinnecock Hills, par 70),
  refreshed every 60 seconds.
- Each golfer's per-round and total to-par is pulled live and matched to the rosters by name
  (accents and nicknames handled automatically).
- **Scoring is the exact spreadsheet rule**, verified against all 233 stored totals:
  team total = sum of the 5 starters; if a starter misses the cut, the first available bench
  player subs in; 2 cut starters = all 7 count; 3+ cut = DQ.
- Cut handling is automatic — once ESPN marks players cut after Friday, bench subs kick in.

## Run it locally
Open `index.html` directly in a browser, or (more reliable) serve the folder:

    cd this-folder
    python3 -m http.server 8765
    # then open http://localhost:8765

## Share it with the pool
It's a static site — drop the folder on any static host (Netlify drop, Vercel,
GitHub Pages, Cloudflare Pages) and share the URL. No server or database needed.

## Regenerating rosters
Rosters are fixed once picks are locked, so `data.js` rarely changes. If picks
change, re-run the extraction from the source spreadsheet.
