# Paper Updater

<p align="center">
  <img src="icon-128.png" width="96" alt="Paper Updater icon" />
</p>

<p align="center">
  <em>A Zotero plugin that keeps your papers up to date.</em>
</p>

<p align="center">
  <a href="https://github.com/qbit-liu/zotero-paper-updater/releases"><img alt="Release" src="https://img.shields.io/github/v/release/qbit-liu/zotero-paper-updater?include_prereleases"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <img alt="Zotero" src="https://img.shields.io/badge/Zotero-7%20%7C%208%20%7C%209-CC2936">
</p>

---

You saved an arXiv preprint as v1. The authors uploaded v2 a month later. Then
it got accepted at a conference and a polished camera-ready PDF appeared. Your
Zotero library still has the v1 you originally pulled — and there's no easy way
to know.

**Paper Updater** scans your library, finds the items that have moved on, and
attaches the new PDFs alongside the originals (so you never lose what you
actually cited). It also keeps the item's metadata — title, authors, DOI,
venue, date — in sync with the published version when one exists.

## Features

- **Detects arXiv revisions.** If you stored `2301.12345v1` and arXiv now hosts
  `v3`, the new PDF is attached.
- **Detects journal/conference publication.** Uses [Semantic Scholar](https://www.semanticscholar.org/)
  to find out whether the preprint has been published. If an open-access PDF
  exists, it's attached and tagged as `Published: <venue>`.
- **Keeps both PDFs.** Originals are never deleted — you keep the version you
  cited as a record, and gain the newer one as a sibling attachment.
- **Updates metadata automatically.** Title, authors, DOI, venue, and date are
  refreshed when a published version is found. Configurable.
- **Manual or scheduled.** Right-click items for an on-demand check, or let it
  scan your whole library every N hours in the background.
- **Cancellable.** Long scans can be interrupted from the Tools menu — the
  current item finishes cleanly, the loop stops within ~200 ms.
- **No telemetry. No accounts.** Talks only to `export.arxiv.org` and
  `api.semanticscholar.org`. No API keys required.

## Requirements

- **Zotero 7, 8, or 9.** Tested on Zotero 9. Earlier versions may work but the
  XHTML preference pane assumes Zotero 7+.
- macOS / Windows / Linux — same build, no platform-specific code.

## Install

### Option 1 — from a release (recommended)

1. Download the latest `paper-updater-<version>.xpi` from the
   [Releases page](https://github.com/qbit-liu/zotero-paper-updater/releases).
2. In Zotero: **Tools → Plugins → ⚙ → Install Plugin From File…**
3. Pick the `.xpi`. The plugin should appear under **Enabled**.

### Option 2 — build from source

```sh
git clone https://github.com/qbit-liu/zotero-paper-updater.git
cd zotero-paper-updater
./build.sh
# Then install build/paper-updater-<version>.xpi the same way as above.
```

`build.sh` is a thin wrapper around `zip` — no Node toolchain or npm install
needed.

## Usage

### Check a single item or selection

Select one or more items in the library pane, right-click → **Check for paper
updates**. A progress popup shows what was checked and what was updated.

### Scan the whole library

**Tools → Paper Updater: Scan library now.** Useful the first time you install,
or after importing a batch of preprints. The plugin asks for confirmation
before starting and shows a count of arXiv items it found.

### Cancel a running scan

**Tools → Paper Updater: Cancel running scan.** The menu item is greyed out
when no scan is active. The currently-processing item finishes (so nothing is
left half-applied), then the loop stops.

### Scheduled scans

By default a background scan runs every 24 hours while Zotero is open. Toggle
or retime it under **Settings → Paper Updater**.

## Settings

Open via **Settings → Paper Updater** (Edit → Preferences on Linux).

| Setting | Default | What it does |
|---|---|---|
| Run a scheduled background scan | ✓ | Periodically scans the whole library while Zotero is open. |
| Scan interval (hours) | 24 | How often the background scan fires. |
| Check Semantic Scholar for published versions | ✓ | Disable to use arXiv only (faster, no published-version detection). |
| Update item metadata automatically | ✓ | Refreshes title / authors / DOI / venue / date when a published version is found. |
| Delay between API requests (ms) | 3500 | arXiv asks for ≥ 3 s between requests. Don't lower below 3000 unless you know what you're doing. |

## How it works

For each item it considers, the plugin:

1. **Extracts the arXiv ID** from the item's URL, DOI, `archiveLocation`,
   `extra`, `callNumber`, or any child attachment's URL. Both the new format
   (`2301.12345`) and the legacy format (`cs/0501001`) are recognised, with or
   without a version suffix (`v3`).
2. **Asks arXiv** (`export.arxiv.org/api/query`) for the latest version. If
   `latest > known`, the new PDF is queued for attachment.
3. **Asks Semantic Scholar** (`api.semanticscholar.org/graph/v1/paper/ARXIV:<id>`)
   whether the preprint now has a journal DOI. If yes, the open-access PDF (if
   any) is queued, and metadata fields are updated.
4. **Writes a marker** to the item's `Extra` field
   (`Paper-Updater-Applied: {...}`) so the same updates aren't reapplied next
   scan.
5. **Attaches new PDFs** with descriptive titles:
   `arXiv v3 (2301.12345)` or `Published: NeurIPS 2024`. Original attachments
   are never touched.

## Privacy

The plugin only talks to:

- `export.arxiv.org` — the public arXiv API. No authentication.
- `api.semanticscholar.org` — Semantic Scholar's free public API. No
  authentication.

Both calls send the arXiv ID of the item being checked. No personal data, no
analytics, no telemetry.

## Limits and known issues

- The arXiv API rate-limits at ~1 request per 3 seconds. A scan of 100 items
  takes roughly 6 minutes.
- Semantic Scholar's free tier rate-limits too; transient failures are logged
  to the Zotero debug output and the scan continues.
- Author parsing for the Semantic Scholar response uses a naive
  "last word = surname" split. If you have authors with multi-word surnames or
  particles (de la Cruz, von Neumann), disable automatic metadata updates or
  fix the entry by hand after the scan.
- The plugin currently only looks for **arXiv-indexed** preprints. bioRxiv /
  ChemRxiv / OSF preprints are not detected.

## Development

Project layout:

```
manifest.json              Plugin manifest (Zotero 7+)
bootstrap.js               install / startup / shutdown lifecycle
prefs.js                   default preference values
content/paper-updater.js   core logic: ID extraction, API calls, apply
content/preferences.xhtml  settings pane UI
locale/en-US/*.ftl         localized strings
icon-*.png                 plugin icons
icon-source.svg            editable icon source
make_icons.py              regenerates the PNG icons from a Pillow render
build.sh                   packages the directory into a .xpi
```

To make changes, edit the JS, run `./build.sh`, and reinstall the resulting
`.xpi`. Zotero's **Help → Debug Output Logging** is your friend for tracing
runtime errors — search the output for `[Paper Updater]`.

## Contributing

Issues and pull requests welcome. Some areas that could use help:

- More preprint sources (bioRxiv, ChemRxiv, OSF, ChemRxiv).
- Better author-name parsing.
- A diff dialog showing old vs. new metadata before applying.
- i18n: the `.ftl` file is in place but most strings are still hard-coded in
  `paper-updater.js`.

## License

[MIT](LICENSE) © qbit-liu
