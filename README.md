# Boeing–Technion SAF Innovation Center

Static HTML/CSS/JS site for the Boeing–Technion Sustainable Aviation Fuel Innovation Center.

Open `index.html` directly in a browser, or serve the directory statically (e.g. `python3 -m http.server`).

## Updating PI links

The Team section's website/LinkedIn icon links are generated from a spreadsheet:

1. Copy `data/pi-links.template.xlsx` to `data/pi-links.xlsx` (git-ignored, stays local) if you
   haven't already.
2. Fill in the `Website` and `LinkedIn` columns on the `PI Links` sheet for each PI (one row per
   person already listed). Don't rename, add, or remove people.
3. Run `python3 scripts/import_pi_links.py` (or pass a different xlsx path as an argument) to
   regenerate `assets/pi-links.js`. The script validates every name and URL first and refuses to
   write anything if the sheet has an unknown/duplicate/missing name or an invalid URL (must be
   `http://`/`https://`, no userinfo, and LinkedIn links must be on `linkedin.com`).
4. Reload the site — no other files need touching. A PI's icon is hidden automatically until its
   URL is filled in.
5. Commit the regenerated `assets/pi-links.js` (but not `data/pi-links.xlsx`, which stays local).

Requires `openpyxl` (`pip install openpyxl`) if not already installed.
