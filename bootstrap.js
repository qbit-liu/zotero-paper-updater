/* global Zotero, Services, Components */

var chromeHandle;

async function install(_data, _reason) {}

async function startup({ id, version, rootURI }, _reason) {
  await Zotero.initializationPromise;

  const aomStartup = Components.classes["@mozilla.org/addons/addon-manager-startup;1"]
    .getService(Components.interfaces.amIAddonManagerStartup);
  const manifestURI = Services.io.newURI(rootURI + "manifest.json");
  chromeHandle = aomStartup.registerChrome(manifestURI, [
    ["content", "paper-updater", rootURI + "content/"],
    ["locale", "paper-updater", "en-US", rootURI + "locale/en-US/"]
  ]);

  Services.scriptloader.loadSubScript(rootURI + "content/paper-updater.js");

  Zotero.PreferencePanes.register({
    pluginID: "paper-updater@phyxyi01.local",
    src: rootURI + "content/preferences.xhtml",
    label: "Paper Updater",
    image: ""
  });

  Zotero.PaperUpdater.init({ id, version, rootURI });
}

function shutdown(_data, reason) {
  if (reason === APP_SHUTDOWN) return;

  if (Zotero.PaperUpdater) {
    try { Zotero.PaperUpdater.shutdown(); } catch (e) { Zotero.logError(e); }
    Zotero.PaperUpdater = undefined;
  }

  if (chromeHandle) {
    try { chromeHandle.destruct(); } catch (e) {}
    chromeHandle = null;
  }
}

function uninstall(_data, _reason) {}
