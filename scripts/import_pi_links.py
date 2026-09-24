#!/usr/bin/env python3
"""Regenerate assets/pi-links.js from a researcher-links spreadsheet.

Usage:
    python3 scripts/import_pi_links.py [path/to/pi-links.xlsx]

Defaults to data/pi-links.xlsx (the blank template is never used implicitly).
Validates the sheet before writing anything: an unknown or duplicate name, a
duplicate/missing header, or an invalid Website/LinkedIn URL aborts with a
clear message and no change to assets/pi-links.js.

Two header formats are accepted (case-insensitive; aliases in parentheses):
    Name (Researcher) | Website (Website URL) | LinkedIn (LinkedIn URL) | Label (Research Website)
Label is optional; any other column (e.g. Team) is ignored.
"""

import json
import os
import re
import sys
import tempfile
import unicodedata
from pathlib import Path
from urllib.parse import urlsplit

import openpyxl

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"
DEFAULT_XLSX = DATA_DIR / "pi-links.xlsx"
TEMPLATE_XLSX = DATA_DIR / "pi-links.template.xlsx"
OUTPUT_JS = REPO_ROOT / "assets" / "pi-links.js"
SHEET_NAMES = ("PI Links", "Researchers")

# Fixed order — output is always written in this order regardless of row
# order in the spreadsheet, so re-running with the same data is deterministic.
PI_NAMES = [
    "Prof. Gidi Grader",
    "Prof. Oz Gazit",
    "Prof. Moris Eisen",
    "Prof. Michael Patrascu",
    "Prof. David Eisenberg",
    "Prof. Sabrina Spatari",
    "Prof. Maytal Caspary Toroker",
    "Prof. Alon Grinberg Dana",
    "Prof. Beni Cukurel",
    "Prof. Joseph Lefkowitz",
    "Prof. Dan Michaels",
]

STAFF_NAMES = [
    "Keren-Or Rosner",
    "Melad Atrash",
    "Victor Halperin",
    "Jawan Muhamed",
]

ALL_NAMES = PI_NAMES + STAFF_NAMES

_DASH_CHARS = "‐‑‒–—−"  # ‐ ‑ ‒ – — −
_DASH_RE = re.compile("[" + _DASH_CHARS + "]")
_WS_RE = re.compile(r"[ \t ​]+")
_HYPERLINK_RE = re.compile(r'^=HYPERLINK\(', re.IGNORECASE)
_HYPERLINK_URL_RE = re.compile(r'"([^"]*)"')
_CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")
_TITLE_RE = re.compile(r"^(prof\.?|dr\.?)\s+")


def die(message):
    print(message, file=sys.stderr)
    sys.exit(1)


def normalize_name(name):
    """NFKC-normalize, collapse NBSP/whitespace runs to a single space,
    normalize unicode dashes to '-', and casefold — for name matching only.
    Output keys always use the canonical spelling from ALL_NAMES."""
    n = unicodedata.normalize("NFKC", name)
    n = _DASH_RE.sub("-", n)
    n = _WS_RE.sub(" ", n)
    n = n.strip()
    return n.casefold()


def match_key(name):
    """normalize_name() plus stripping a leading 'Prof.'/'Dr.' title, so a
    spreadsheet row can match a canonical name whether or not it repeats the
    title (the source spreadsheet's PI names never include it)."""
    return _TITLE_RE.sub("", normalize_name(name), count=1)


# Explicit aliases for names that don't line up with the canonical spelling
# even after title-stripping (nicknames, extra/omitted middle names, etc).
# Keys are match_key()-normalized forms of the spreadsheet's spelling.
NAME_ALIASES = {
    "michael shoham patrascu": "Prof. Michael Patrascu",
}

CANONICAL_BY_KEY = {match_key(n): n for n in ALL_NAMES}


def resolve_name(raw_name):
    """Return the canonical display name for a spreadsheet name, or None."""
    key = match_key(raw_name)
    if key in NAME_ALIASES:
        return NAME_ALIASES[key]
    return CANONICAL_BY_KEY.get(key)


def cell_text(cell):
    """Extract the intended string value of a cell per the read rules:
    hyperlink target > first quoted URL of a HYPERLINK() formula > str(value)."""
    if cell.hyperlink and cell.hyperlink.target:
        return cell.hyperlink.target.strip()
    value = cell.value
    if value is None:
        return ""
    if isinstance(value, str):
        stripped = value.strip()
        if _HYPERLINK_RE.match(stripped):
            m = _HYPERLINK_URL_RE.search(stripped)
            if m:
                return m.group(1).strip()
            return ""
        return stripped
    return str(value).strip()


def is_linkedin_host(hostname):
    host = hostname.lower()
    return host == "linkedin.com" or host.endswith(".linkedin.com")


def validate_url(value, row, col_name, errors, require_linkedin_host=False):
    """Return a validated URL string, or "" if empty, or None on failure
    (with a message appended to errors)."""
    if value == "":
        return ""
    if _CONTROL_RE.search(value) or re.search(r"\s", value):
        errors.append(f"row {row}, column {col_name}: contains whitespace/control characters: {value!r}")
        return None
    try:
        parts = urlsplit(value)
    except ValueError:
        errors.append(f"row {row}, column {col_name}: unparseable URL: {value!r}")
        return None
    if parts.scheme not in ("http", "https"):
        errors.append(f"row {row}, column {col_name}: scheme must be http or https: {value!r}")
        return None
    if not parts.hostname:
        errors.append(f"row {row}, column {col_name}: missing hostname: {value!r}")
        return None
    if parts.username or parts.password:
        errors.append(f"row {row}, column {col_name}: userinfo not allowed: {value!r}")
        return None
    if require_linkedin_host and not is_linkedin_host(parts.hostname):
        errors.append(
            f"row {row}, column {col_name}: host must be linkedin.com or a subdomain of it: {value!r}"
        )
        return None
    return value


def find_sheet(wb):
    for name in SHEET_NAMES:
        if name in wb.sheetnames:
            return wb[name]
    if len(wb.sheetnames) == 1:
        return wb[wb.sheetnames[0]]
    die(
        f"Error: no sheet named {SHEET_NAMES!r} found, and workbook has "
        f"{len(wb.sheetnames)} sheets ({wb.sheetnames!r}) so the target sheet is ambiguous."
    )


# Canonical field -> accepted header spellings (case/whitespace-insensitive).
HEADER_ALIASES = {
    "Name": ["name", "researcher"],
    "Website": ["website", "website url"],
    "LinkedIn": ["linkedin", "linkedin url"],
    "Label": ["label", "research website"],
}
REQUIRED_HEADERS = ("Name", "Website", "LinkedIn")


def find_headers(ws):
    header_row = next(ws.iter_rows(min_row=1, max_row=1), None)
    if header_row is None:
        die("Error: sheet has no header row.")

    seen = {}
    for idx, cell in enumerate(header_row):
        raw = cell.value
        if raw is None:
            continue
        key = _WS_RE.sub(" ", str(raw).strip()).casefold()
        if not key:
            continue
        seen.setdefault(key, []).append(idx)

    positions = {}
    for label, aliases in HEADER_ALIASES.items():
        matches = []
        for alias in aliases:
            matches.extend(seen.get(alias, []))
        if len(matches) > 1:
            die(f"Error: duplicate header column {label!r} found in header row.")
        if matches:
            positions[label] = matches[0]
        elif label in REQUIRED_HEADERS:
            die(f"Error: missing required header column {label!r} in header row.")

    return positions


def load_rows(xlsx_path):
    wb = openpyxl.load_workbook(xlsx_path, data_only=False)
    try:
        ws = find_sheet(wb)
        positions = find_headers(ws)
        name_col = positions["Name"]
        website_col = positions["Website"]
        linkedin_col = positions["LinkedIn"]
        label_col = positions.get("Label")

        rows = []
        for row in ws.iter_rows(min_row=2):
            if row[0].row is None:
                continue
            row_idx = row[0].row
            cols = [name_col, website_col, linkedin_col] + ([label_col] if label_col is not None else [])
            max_col = max(cols)
            if max_col >= len(row):
                cells = list(row) + [None] * (max_col + 1 - len(row))
            else:
                cells = row

            def get(col):
                c = cells[col]
                return c if c is not None else None

            values_blank = all(
                (c is None or c.value is None or (isinstance(c.value, str) and c.value.strip() == ""))
                for c in cells
            )
            if values_blank:
                continue

            name_cell = get(name_col)
            website_cell = get(website_col)
            linkedin_cell = get(linkedin_col)
            label_cell = get(label_col) if label_col is not None else None

            name = cell_text(name_cell) if name_cell is not None else ""
            website = cell_text(website_cell) if website_cell is not None else ""
            linkedin = cell_text(linkedin_cell) if linkedin_cell is not None else ""
            label = cell_text(label_cell) if label_cell is not None else ""

            if name == "" and website == "" and linkedin == "" and label == "":
                continue

            rows.append({
                "row": row_idx,
                "name": name,
                "website": website,
                "linkedin": linkedin,
                "label": label,
            })

        return rows
    finally:
        wb.close()


def validate(rows):
    errors = []
    warnings = []
    by_canonical = {}
    seen_rows_by_canonical = {}

    for r in rows:
        canonical = resolve_name(r["name"])
        if canonical is None:
            errors.append(f"row {r['row']}: unknown name: {r['name']!r}")
            continue
        if canonical in seen_rows_by_canonical:
            errors.append(
                f"row {r['row']}: duplicate row for {canonical!r} "
                f"(already seen at row {seen_rows_by_canonical[canonical]})"
            )
            continue
        seen_rows_by_canonical[canonical] = r["row"]

        website = validate_url(r["website"], r["row"], "Website", errors)
        if website is None:
            continue

        linkedin_raw = r["linkedin"]
        linkedin = ""
        if linkedin_raw != "":
            # First check it's a syntactically valid http(s) URL without the
            # LinkedIn-host restriction, so we can tell "not a URL at all"
            # apart from "a URL, but not on linkedin.com".
            probe_errors = []
            candidate = validate_url(linkedin_raw, r["row"], "LinkedIn", probe_errors)
            if candidate is None:
                errors.extend(probe_errors)
                continue
            host = urlsplit(candidate).hostname or ""
            if is_linkedin_host(host):
                linkedin = candidate
            elif website == "":
                # Some staff rows carry a non-LinkedIn URL in the LinkedIn
                # column (e.g. a department people page). Use it as the
                # website instead of failing, but flag it.
                website = candidate
                warnings.append(
                    f"row {r['row']} ({canonical}): LinkedIn column holds a non-LinkedIn URL "
                    f"with no Website value; using it as the website instead: {candidate!r}"
                )
            else:
                errors.append(
                    f"row {r['row']}, column LinkedIn: host must be linkedin.com or a "
                    f"subdomain of it: {linkedin_raw!r}"
                )
                continue

        by_canonical[canonical] = {
            "website": website,
            "websiteLabel": r["label"],
            "linkedin": linkedin,
        }

    if errors:
        die("Error: pi-links import failed validation.\n" + "\n".join(f"  - {e}" for e in errors))

    missing = [n for n in ALL_NAMES if n not in by_canonical]
    if missing:
        die("Error: no row found for these people (keep one row per person, blank cells are fine):\n"
            + "\n".join(f"  - {name!r}" for name in missing))

    for w in warnings:
        print(f"Warning: {w}", file=sys.stderr)

    return by_canonical


def render_js(by_canonical):
    data = {
        name: {
            "website": by_canonical.get(name, {}).get("website", ""),
            "websiteLabel": by_canonical.get(name, {}).get("websiteLabel", ""),
            "linkedin": by_canonical.get(name, {}).get("linkedin", ""),
        }
        for name in ALL_NAMES
    }
    body = json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True)
    return (
        "// generated by scripts/import_pi_links.py — do not edit\n"
        "window.PI_LINKS = " + body + ";\n"
    )


def atomic_write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=str(path.parent), prefix=path.name + ".", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(content)
        os.replace(tmp_path, str(path))
    except BaseException:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def main():
    if len(sys.argv) > 1:
        xlsx_path = Path(sys.argv[1])
    else:
        xlsx_path = DEFAULT_XLSX

    if not xlsx_path.exists():
        die(f"Error: spreadsheet not found: {xlsx_path}\n"
            f"Copy {TEMPLATE_XLSX.relative_to(REPO_ROOT)} to {DEFAULT_XLSX.relative_to(REPO_ROOT)} and fill it in.")

    try:
        rows = load_rows(xlsx_path)
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001 - convert any read error to a clean message
        die(f"Error: failed to read {xlsx_path}: {exc}")

    by_canonical = validate(rows)
    output = render_js(by_canonical)

    atomic_write(OUTPUT_JS, output)
    print(f"Wrote {OUTPUT_JS}")


if __name__ == "__main__":
    main()
