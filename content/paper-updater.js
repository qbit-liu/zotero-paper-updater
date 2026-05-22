/* global Zotero, Services, Components, DOMParser */

Zotero.PaperUpdater = (() => {
  const PLUGIN_ID = "paper-updater@phyxyi01.local";

  const PREF = {
    SCAN_ENABLED: "extensions.paper-updater.scanEnabled",
    SCAN_INTERVAL: "extensions.paper-updater.scanIntervalHours",
    LAST_SCAN: "extensions.paper-updater.lastScan",
    USE_S2: "extensions.paper-updater.useSemanticScholar",
    UPDATE_META: "extensions.paper-updater.updateMetadata",
    DELAY: "extensions.paper-updater.requestDelayMs"
  };

  const ARXIV_API = "https://export.arxiv.org/api/query";
  const S2_API = "https://api.semanticscholar.org/graph/v1/paper";
  const MARKER = "Paper-Updater-Applied:";

  // arXiv identifiers
  const RX_NEW = /(\d{4}\.\d{4,5})(v\d+)?/;
  const RX_OLD = /([a-z\-]+(?:\.[A-Z]{2})?\/\d{7})(v\d+)?/i;

  const addedElements = []; // { win, id }
  let scanTimer = null;
  let initialized = false;
  let rootURI = null;

  // Scan state for interruption. null when idle; object while a scan runs.
  let scanState = null; // { cancelRequested: boolean, progress, line }

  const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";

  function sleep(ms) {
    return new Promise(res => setTimeout(res, ms));
  }

  // Sleep that polls for cancellation every 200 ms. Returns true if cancelled.
  async function cancellableSleep(ms) {
    const step = 200;
    let waited = 0;
    while (waited < ms) {
      if (scanState && scanState.cancelRequested) return true;
      const chunk = Math.min(step, ms - waited);
      await new Promise(r => setTimeout(r, chunk));
      waited += chunk;
    }
    return !!(scanState && scanState.cancelRequested);
  }

  function isScanning() {
    return scanState !== null;
  }

  function cancelScan() {
    if (!scanState) return false;
    if (scanState.cancelRequested) return true;
    scanState.cancelRequested = true;
    log("scan cancellation requested");
    try {
      if (scanState.line && typeof scanState.line.setText === "function") {
        scanState.line.setText("Cancelling after current item...");
      }
    } catch (_) {}
    return true;
  }

  const TB_ICON_IDLE = "chrome://paper-updater/content/tb-idle.png";
  const TB_ICON_SCANNING = "chrome://paper-updater/content/tb-scanning.png";

  // Reflects the current scan state across menus and the toolbar toggle button.
  function updateUIState() {
    const scanning = isScanning();
    for (const entry of addedElements) {
      const el = entry.win.document.getElementById(entry.id);
      if (!el) continue;

      if (entry.id === "paper-updater-cancel") {
        if (scanning) el.removeAttribute("disabled");
        else el.setAttribute("disabled", "true");
      }

      if (entry.id === "paper-updater-tb-button") {
        if (scanning) {
          el.setAttribute("tooltiptext", "Cancel running scan");
          el.setAttribute("image", TB_ICON_SCANNING);
          el.style.listStyleImage = `url('${TB_ICON_SCANNING}')`;
        } else {
          el.setAttribute("tooltiptext", "Check for paper updates");
          el.setAttribute("image", TB_ICON_IDLE);
          el.style.listStyleImage = `url('${TB_ICON_IDLE}')`;
        }
      }
    }
  }

  function log(msg) {
    Zotero.debug("[Paper Updater] " + msg);
  }

  function createXUL(doc, tagName) {
    if (typeof doc.createXULElement === "function") {
      return doc.createXULElement(tagName);
    }
    return doc.createElementNS(XUL_NS, tagName);
  }

  // -------- ID extraction --------

  function findArxivIn(text) {
    if (!text) return null;
    let m = text.match(RX_NEW);
    if (m) return { id: m[1], version: m[2] ? parseInt(m[2].slice(1), 10) : null };
    m = text.match(RX_OLD);
    if (m) return { id: m[1], version: m[2] ? parseInt(m[2].slice(1), 10) : null };
    return null;
  }

  function extractArxivId(item) {
    const candidates = [
      item.getField("url"),
      item.getField("archiveLocation"),
      item.getField("extra"),
      item.getField("callNumber"),
      item.getField("DOI")
    ];
    for (const c of candidates) {
      const r = findArxivIn(c || "");
      if (r) return r;
    }
    // Check child attachments
    try {
      for (const attID of item.getAttachments()) {
        const att = Zotero.Items.get(attID);
        const r = findArxivIn(att.getField("url") || "");
        if (r) return r;
      }
    } catch (e) {}
    return null;
  }

  function readMarker(item) {
    const extra = item.getField("extra") || "";
    const m = extra.match(new RegExp("^" + MARKER + "\\s*(.+)$", "m"));
    if (!m) return {};
    try { return JSON.parse(m[1]); } catch (_) { return {}; }
  }

  function writeMarker(item, data) {
    let extra = item.getField("extra") || "";
    const re = new RegExp("^" + MARKER + ".*$", "m");
    const line = MARKER + " " + JSON.stringify(data);
    if (re.test(extra)) extra = extra.replace(re, line);
    else extra = (extra.trim() + "\n" + line).trim();
    item.setField("extra", extra);
  }

  // -------- HTTP --------

  async function httpGet(url, opts = {}) {
    return Zotero.HTTP.request("GET", url, {
      timeout: 20000,
      responseType: opts.json ? "json" : "text",
      headers: opts.headers || {}
    });
  }

  // -------- arXiv lookup --------

  function parseArxivXML(text) {
    let doc;
    try {
      doc = new DOMParser().parseFromString(text, "application/xml");
    } catch (_) {
      const parser = Components.classes["@mozilla.org/xmlextras/domparser;1"]
        .createInstance(Components.interfaces.nsIDOMParser);
      doc = parser.parseFromString(text, "application/xml");
    }
    const entry = doc.querySelector("entry");
    if (!entry) return null;

    const text1 = sel => {
      const el = entry.querySelector(sel);
      return el ? el.textContent.trim().replace(/\s+/g, " ") : "";
    };

    const idUrl = text1("id");
    const versionMatch = idUrl.match(/abs\/(.+?)v(\d+)$/);
    const latestId = versionMatch ? versionMatch[1] : idUrl.split("/").pop();
    const latestVersion = versionMatch ? parseInt(versionMatch[2], 10) : 1;

    const authors = Array.from(entry.querySelectorAll("author > name"))
      .map(n => n.textContent.trim());

    const pdfLink = Array.from(entry.querySelectorAll("link"))
      .find(l => l.getAttribute("title") === "pdf");
    const pdfUrl = pdfLink
      ? pdfLink.getAttribute("href")
      : `https://arxiv.org/pdf/${latestId}v${latestVersion}.pdf`;

    // Namespaced lookups (arxiv:doi, arxiv:journal_ref)
    const nsLookup = name => {
      const els = entry.getElementsByTagName("*");
      for (const el of els) {
        if (el.localName === name) return el.textContent.trim();
      }
      return "";
    };

    return {
      arxivId: latestId,
      latestVersion,
      title: text1("title"),
      summary: text1("summary"),
      published: text1("published"),
      updated: text1("updated"),
      authors,
      pdfUrl,
      absUrl: `https://arxiv.org/abs/${latestId}v${latestVersion}`,
      doi: nsLookup("doi"),
      journalRef: nsLookup("journal_ref")
    };
  }

  async function fetchArxivMeta(arxivId) {
    const url = `${ARXIV_API}?id_list=${encodeURIComponent(arxivId)}`;
    const resp = await httpGet(url);
    return parseArxivXML(resp.responseText);
  }

  // -------- Semantic Scholar lookup --------

  async function fetchSemanticScholarMeta(arxivId) {
    try {
      const fields = [
        "externalIds", "title", "authors", "venue", "year",
        "publicationVenue", "journal", "publicationDate",
        "openAccessPdf", "abstract"
      ].join(",");
      const url = `${S2_API}/ARXIV:${encodeURIComponent(arxivId)}?fields=${fields}`;
      const resp = await httpGet(url, { json: true, headers: { Accept: "application/json" } });
      return resp.response;
    } catch (e) {
      log(`Semantic Scholar lookup failed for ${arxivId}: ${e.message || e}`);
      return null;
    }
  }

  // -------- Check + apply --------

  async function checkItem(item) {
    const arxiv = extractArxivId(item);
    if (!arxiv) return null;

    const currentVersion = arxiv.version || 1;
    const marker = readMarker(item);

    const arxivMeta = await fetchArxivMeta(arxiv.id);
    if (!arxivMeta) return null;

    let s2Meta = null;
    if (Zotero.Prefs.get(PREF.USE_S2)) {
      s2Meta = await fetchSemanticScholarMeta(arxiv.id);
    }

    const knownVersion = Math.max(currentVersion, marker.arxivVersion || 0);
    const newerArxiv = arxivMeta.latestVersion > knownVersion;

    const itemDoi = (item.getField("DOI") || "").toLowerCase();
    const s2Doi = s2Meta && s2Meta.externalIds && s2Meta.externalIds.DOI
      ? s2Meta.externalIds.DOI.toLowerCase()
      : null;
    const venue = s2Meta && (
      (s2Meta.publicationVenue && s2Meta.publicationVenue.name)
      || (s2Meta.journal && s2Meta.journal.name)
      || s2Meta.venue
    );
    const hasPublished = !!(s2Doi && venue && s2Doi !== itemDoi && marker.publishedDoi !== s2Doi);

    return {
      item, arxiv, currentVersion, knownVersion,
      arxivMeta, s2Meta, newerArxiv, hasPublished, venue, s2Doi, marker
    };
  }

  function nameToCreator(name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) {
      return { creatorType: "author", lastName: parts[0], firstName: "" };
    }
    return {
      creatorType: "author",
      firstName: parts.slice(0, -1).join(" "),
      lastName: parts[parts.length - 1]
    };
  }

  async function applyUpdate(result) {
    const { item, arxivMeta, s2Meta, newerArxiv, hasPublished, venue, s2Doi, marker } = result;
    const updateMeta = Zotero.Prefs.get(PREF.UPDATE_META);
    const newMarker = Object.assign({}, marker);

    const toAttach = [];

    if (newerArxiv) {
      toAttach.push({
        url: arxivMeta.pdfUrl,
        title: `arXiv v${arxivMeta.latestVersion} (${arxivMeta.arxivId})`,
        contentType: "application/pdf"
      });
      newMarker.arxivVersion = arxivMeta.latestVersion;
      newMarker.arxivAppliedAt = new Date().toISOString();

      if (updateMeta) {
        item.setField("url", arxivMeta.absUrl);
        let extra = item.getField("extra") || "";
        const re = /^arXiv:\s*\S+/m;
        const line = `arXiv:${arxivMeta.arxivId}v${arxivMeta.latestVersion}`;
        extra = re.test(extra) ? extra.replace(re, line) : (extra.trim() + "\n" + line).trim();
        item.setField("extra", extra);
      }
    }

    if (hasPublished && s2Meta) {
      if (s2Meta.openAccessPdf && s2Meta.openAccessPdf.url) {
        toAttach.push({
          url: s2Meta.openAccessPdf.url,
          title: `Published: ${venue || "journal"}`.slice(0, 100),
          contentType: "application/pdf"
        });
      }
      newMarker.publishedDoi = s2Doi;
      newMarker.publishedAppliedAt = new Date().toISOString();

      if (updateMeta) {
        if (s2Doi) item.setField("DOI", s2Meta.externalIds.DOI);
        if (s2Meta.title) item.setField("title", s2Meta.title);
        if (s2Meta.publicationDate) item.setField("date", s2Meta.publicationDate);
        else if (s2Meta.year) item.setField("date", String(s2Meta.year));

        const ptype = Zotero.ItemTypes.getName(item.itemTypeID);
        if (venue) {
          try {
            if (ptype === "journalArticle") item.setField("publicationTitle", venue);
            else if (ptype === "conferencePaper") item.setField("conferenceName", venue);
            else {
              let extra = item.getField("extra") || "";
              if (!extra.includes(venue)) {
                extra = (extra.trim() + "\nPublication: " + venue).trim();
                item.setField("extra", extra);
              }
            }
          } catch (e) { log("venue set failed: " + e.message); }
        }

        if (s2Meta.authors && s2Meta.authors.length) {
          try {
            const creators = s2Meta.authors.map(a => nameToCreator(a.name || ""));
            item.setCreators(creators);
          } catch (e) { log("setCreators failed: " + e.message); }
        }
      }
    }

    writeMarker(item, newMarker);
    await item.saveTx();

    // Attach PDFs, skipping any whose title already exists on the item
    const existingTitles = new Set();
    for (const attID of item.getAttachments()) {
      const att = Zotero.Items.get(attID);
      existingTitles.add(att.getField("title"));
    }

    for (const att of toAttach) {
      if (existingTitles.has(att.title)) {
        log(`Skipping duplicate attachment: ${att.title}`);
        continue;
      }
      try {
        await Zotero.Attachments.importFromURL({
          url: att.url,
          parentItemID: item.id,
          title: att.title,
          contentType: att.contentType
        });
      } catch (e) {
        log(`PDF download failed (${att.url}): ${e.message || e}`);
      }
    }

    return { item, attached: toAttach.length };
  }

  // -------- Batch runners --------

  async function runOnItems(items, headline) {
    const win = Zotero.getMainWindow();

    if (isScanning()) {
      if (win) {
        Services.prompt.alert(win, "Paper Updater",
          "A scan is already in progress. Use Tools → Paper Updater: Cancel running scan to stop it.");
      }
      return 0;
    }

    const delay = Zotero.Prefs.get(PREF.DELAY) || 3500;

    const progress = new Zotero.ProgressWindow({ closeOnClick: false });
    progress.changeHeadline(headline);
    if (typeof progress.addDescription === "function") {
      progress.addDescription("Tools → Paper Updater: Cancel running scan to stop.");
    }
    progress.show();
    const line = new progress.ItemProgress(
      "chrome://zotero/skin/treeitem-attachment-pdf.png",
      `0 / ${items.length}`
    );

    scanState = { cancelRequested: false, progress, line };
    updateUIState();

    let updated = 0;
    let checked = 0;
    let skipped = 0;
    let cancelled = false;
    const summaries = [];

    try {
      for (const item of items) {
        if (scanState.cancelRequested) { cancelled = true; break; }

        checked++;
        const titleSnip = (item.getField("title") || "").slice(0, 60);
        line.setText(`${checked} / ${items.length} — ${titleSnip}`);

        try {
          const result = await checkItem(item);
          if (!result) { skipped++; continue; }

          // Cancellation may have been requested while checkItem awaited;
          // finish applying for this item so we don't leave half-state.
          if (result.newerArxiv || result.hasPublished) {
            await applyUpdate(result);
            updated++;
            const bits = [];
            if (result.newerArxiv) {
              bits.push(`arXiv v${result.currentVersion} → v${result.arxivMeta.latestVersion}`);
            }
            if (result.hasPublished) {
              bits.push(`Published: ${result.venue}`);
            }
            summaries.push(`• ${titleSnip}\n   ${bits.join(" | ")}`);
          }
        } catch (e) {
          Zotero.logError(e);
        }

        if (checked < items.length) {
          const wasCancelled = await cancellableSleep(delay);
          if (wasCancelled) { cancelled = true; break; }
        }
      }
    } finally {
      scanState = null;
      updateUIState();
    }

    if (cancelled) {
      line.setText(`Cancelled at ${checked} / ${items.length}. ${updated} updated.`);
    } else {
      line.setProgress(100);
      line.setText(`Done. ${updated} updated, ${checked - updated - skipped} unchanged, ${skipped} skipped`);
    }
    progress.startCloseTimer(10000);

    if (updated > 0 && win) {
      const heading = cancelled
        ? `Paper Updater cancelled — applied ${updated} update(s) before stopping:`
        : `Paper Updater applied ${updated} update(s):`;
      Services.prompt.alert(win, "Paper Updater", `${heading}\n\n` + summaries.join("\n\n"));
    }

    return updated;
  }

  async function checkSelectedItems() {
    const pane = Zotero.getActiveZoteroPane();
    if (!pane) return;
    const items = pane.getSelectedItems().filter(i => i.isRegularItem());
    if (!items.length) {
      Services.prompt.alert(Zotero.getMainWindow(), "Paper Updater",
        "Select one or more regular items in the library pane first.");
      return;
    }
    await runOnItems(items, `Checking ${items.length} selected item(s)...`);
  }

  async function scanLibrary(interactive) {
    const search = new Zotero.Search();
    search.libraryID = Zotero.Libraries.userLibraryID;
    search.addCondition("itemType", "isNot", "attachment");
    search.addCondition("itemType", "isNot", "note");
    const itemIDs = await search.search();
    const items = await Zotero.Items.getAsync(itemIDs);
    const arxivItems = items.filter(i => i.isRegularItem() && extractArxivId(i));

    if (!arxivItems.length) {
      if (interactive) {
        Services.prompt.alert(Zotero.getMainWindow(), "Paper Updater",
          "No arXiv items found in your library.");
      }
      Zotero.Prefs.set(PREF.LAST_SCAN, Date.now());
      return;
    }

    if (interactive) {
      const win = Zotero.getMainWindow();
      const proceed = Services.prompt.confirm(win, "Paper Updater",
        `Scan ${arxivItems.length} arXiv item(s) for updates? ` +
        `This respects the arXiv rate limit and may take a few minutes.`);
      if (!proceed) return;
    }

    await runOnItems(arxivItems, `Scanning ${arxivItems.length} arXiv item(s)...`);
    Zotero.Prefs.set(PREF.LAST_SCAN, Date.now());
  }

  // -------- UI wiring --------

  function addToWindow(win) {
    const doc = win.document;

    const itemMenu = doc.getElementById("zotero-itemmenu");
    if (itemMenu) {
      const sep = createXUL(doc, "menuseparator");
      sep.id = "paper-updater-sep";
      itemMenu.appendChild(sep);
      addedElements.push({ win, id: "paper-updater-sep" });

      const mi = createXUL(doc, "menuitem");
      mi.id = "paper-updater-check-selected";
      mi.setAttribute("label", "Check for paper updates");
      mi.addEventListener("command", () => {
        checkSelectedItems().catch(e => Zotero.logError(e));
      });
      itemMenu.appendChild(mi);
      addedElements.push({ win, id: "paper-updater-check-selected" });
    }

    const toolsMenu = doc.getElementById("menu_ToolsPopup");
    if (toolsMenu) {
      const mi = createXUL(doc, "menuitem");
      mi.id = "paper-updater-scan-all";
      mi.setAttribute("label", "Paper Updater: Scan library now");
      mi.addEventListener("command", () => {
        scanLibrary(true).catch(e => Zotero.logError(e));
      });
      toolsMenu.appendChild(mi);
      addedElements.push({ win, id: "paper-updater-scan-all" });

      const cancelMi = createXUL(doc, "menuitem");
      cancelMi.id = "paper-updater-cancel";
      cancelMi.setAttribute("label", "Paper Updater: Cancel running scan");
      cancelMi.setAttribute("disabled", "true");
      cancelMi.addEventListener("command", () => {
        cancelScan();
      });
      toolsMenu.appendChild(cancelMi);
      addedElements.push({ win, id: "paper-updater-cancel" });
    }

    // Toolbar toggle button: click to scan, click again to cancel.
    addToolbarButton(win);

    // Reflect any in-progress scan state on this newly opened window.
    updateUIState();
  }

  // Candidate parents for the toolbar button, in priority order. The first one
  // found in the document wins. Inserting next to the sync button puts us in a
  // sensible, visible spot across Zotero 7/8/9 layouts.
  const TOOLBAR_ANCHORS = [
    "zotero-tb-sync-stop",
    "zotero-tb-sync",
    "zotero-tb-sync-error",
    "zotero-toolbar",
  ];

  function addToolbarButton(win) {
    const doc = win.document;
    for (const id of TOOLBAR_ANCHORS) {
      const anchor = doc.getElementById(id);
      if (!anchor) continue;

      const btn = createXUL(doc, "toolbarbutton");
      btn.id = "paper-updater-tb-button";
      btn.setAttribute("class", "zotero-tb-button paper-updater-tb-button");
      btn.setAttribute("tooltiptext", "Check for paper updates");
      btn.setAttribute("image", TB_ICON_IDLE);
      btn.style.listStyleImage = `url('${TB_ICON_IDLE}')`;
      btn.addEventListener("command", () => {
        if (isScanning()) {
          cancelScan();
        } else {
          scanLibrary(true).catch(e => Zotero.logError(e));
        }
      });

      const isToolbar = anchor.tagName === "toolbar"
                     || anchor.tagName === "toolbaritems"
                     || anchor.tagName === "hbox";
      if (isToolbar) {
        anchor.appendChild(btn);
      } else if (anchor.parentNode) {
        anchor.parentNode.insertBefore(btn, anchor.nextSibling);
      } else {
        continue;
      }
      addedElements.push({ win, id: "paper-updater-tb-button" });
      log(`toolbar button inserted at #${id}`);
      return true;
    }
    log("no suitable toolbar anchor found; button not added");
    return false;
  }

  function removeFromWindow(win) {
    for (const e of addedElements) {
      if (e.win !== win) continue;
      const el = win.document.getElementById(e.id);
      if (el) el.remove();
    }
    for (let i = addedElements.length - 1; i >= 0; i--) {
      if (addedElements[i].win === win) addedElements.splice(i, 1);
    }
  }

  const windowListener = {
    onOpenWindow(xulWin) {
      const domWin = xulWin.docShell.domWindow;
      domWin.addEventListener("load", () => {
        try {
          if (domWin.Zotero && domWin.document.getElementById("zotero-itemmenu")) {
            addToWindow(domWin);
          }
        } catch (e) { Zotero.logError(e); }
      }, { once: true });
    },
    onCloseWindow() {},
    onWindowTitleChange() {}
  };

  function scheduleScans() {
    if (!Zotero.Prefs.get(PREF.SCAN_ENABLED)) return;
    const hours = Math.max(1, Zotero.Prefs.get(PREF.SCAN_INTERVAL) || 24);
    const intervalMs = hours * 3600 * 1000;
    const lastScan = Zotero.Prefs.get(PREF.LAST_SCAN) || 0;
    const elapsed = Date.now() - lastScan;
    const initialDelay = Math.max(120_000, intervalMs - elapsed); // wait at least 2 min after startup

    const tick = () => {
      scanLibrary(false).catch(e => Zotero.logError(e));
      scanTimer = setTimeout(tick, intervalMs);
    };
    scanTimer = setTimeout(tick, initialDelay);
    log(`Next scheduled scan in ${Math.round(initialDelay / 60000)} min (interval ${hours}h)`);
  }

  // -------- Lifecycle --------

  function init({ rootURI: root }) {
    if (initialized) return;
    rootURI = root;
    initialized = true;

    for (const w of Zotero.getMainWindows()) addToWindow(w);
    Services.wm.addListener(windowListener);

    scheduleScans();
    log(`v0.1.0 ready`);
  }

  function shutdown() {
    if (!initialized) return;
    // Ask any running scan to stop so its loop returns and releases state.
    cancelScan();
    try { Services.wm.removeListener(windowListener); } catch (_) {}
    for (const w of Zotero.getMainWindows()) removeFromWindow(w);
    if (scanTimer) { clearTimeout(scanTimer); scanTimer = null; }
    initialized = false;
    log("shut down");
  }

  return {
    PLUGIN_ID, PREF,
    init, shutdown,
    checkSelectedItems,
    scanLibrary,
    cancelScan,
    isScanning,
    // exposed for prefs pane
    runScanNow: () => scanLibrary(true),
    cancelScanNow: () => cancelScan(),
    rescheduleScans: () => {
      if (scanTimer) { clearTimeout(scanTimer); scanTimer = null; }
      scheduleScans();
    }
  };
})();
