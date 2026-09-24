# Boeing–Technion SAF Innovation Center

Static HTML/CSS/JS site for the Boeing–Technion Sustainable Aviation Fuel Innovation Center.

Open `index.html` directly in a browser, or serve the directory statically (e.g. `python3 -m http.server`).

## Updating researcher links

The About section's website/LinkedIn icon links (11 PIs + 4 staff) are generated from a
spreadsheet:

1. Copy `data/pi-links.template.xlsx` to `data/pi-links.xlsx` (git-ignored, stays local) if you
   haven't already, or use an export from the shared tracking sheet directly.
2. Fill in the link columns for each person already listed. Don't rename, add, or remove people.
   Two header formats are accepted (case-insensitive):
   - Template format: `Name`, `Website`, `LinkedIn`, optional `Label` — sheet named `PI Links`.
   - Tracking-sheet export: `Researcher`, `Website URL`, `LinkedIn URL`, optional
     `Research Website` (used as the website's display label) — sheet named `Researchers`, with
     any other column (e.g. `Team`) ignored. Cells may be plain URLs or hyperlinked text; the
     hyperlink target is used either way.
3. Run `python3 scripts/import_pi_links.py` (or pass a different xlsx path as an argument) to
   regenerate `assets/pi-links.js`. The script validates every name and URL first and refuses to
   write anything if the sheet has an unknown/duplicate/missing name or an invalid URL (must be
   `http://`/`https://`, no userinfo, and LinkedIn links must be on `linkedin.com`). As an
   exception, if a LinkedIn cell holds a non-LinkedIn URL and the Website cell is empty, it's used
   as the website instead and a warning (not an error) is printed.
4. Reload the site — no other files need touching. A person's icon is hidden automatically until
   its URL is filled in.
5. Commit the regenerated `assets/pi-links.js` (but not `data/pi-links.xlsx`, which stays local).

Requires `openpyxl` (`pip install openpyxl`) if not already installed.
