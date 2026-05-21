# Paper Updater

<img src="icon-128.png" width="80" align="left" hspace="12" />

A small Zotero plugin that keeps your papers up to date.

If you save an arXiv preprint and the authors later upload a new version — or
the paper gets published in a journal — Paper Updater notices and attaches the
new PDF next to the original.

<br clear="left" />

## What it does

- Detects newer **arXiv versions** (v2, v3, …) of papers in your library.
- Detects when a preprint has been **published** in a journal/conference (via Semantic Scholar).
- Attaches the new PDF alongside the original — never deletes anything.
- Updates the item's metadata (title, authors, DOI, venue, date) when a published version is found.

## Install

1. Download `paper-updater-x.y.z.xpi` from the [latest release](https://github.com/qbit-liu/zotero-paper-updater/releases).
2. In Zotero: **Tools → Plugins → ⚙ → Install Plugin From File…**
3. Pick the `.xpi`.

Tested on Zotero 9.

## Usage

- Right-click items → **Check for paper updates** to scan a selection.
- **Tools → Paper Updater: Scan library now** to scan everything.
- **Tools → Paper Updater: Cancel running scan** to stop mid-scan.
- A scheduled background scan also runs every 24 h by default. Adjust in **Settings → Paper Updater**.

## Build from source

```sh
git clone https://github.com/qbit-liu/zotero-paper-updater.git
cd zotero-paper-updater
./build.sh
```

That's it — `build.sh` just zips the directory into a `.xpi`.

## License

[MIT](LICENSE)
