const ZMS_AUTO_UPDATE_ADDON_ID = "zotero-markdown-summary@diantao.local";

async function zmsApplyAddonAutoUpdatePreference(enabled, options = {}) {
  const addonId = options.addonId || ZMS_AUTO_UPDATE_ADDON_ID;
  try {
    const manager = zmsAddonManager();
    if (!manager?.getAddonByID) {
      return { ok: false, reason: "AddonManager is not available" };
    }
    const addon = await zmsGetAddonByID(manager, addonId);
    if (!addon) {
      return { ok: false, reason: `Addon not found: ${addonId}` };
    }
    if (!("applyBackgroundUpdates" in addon)) {
      return { ok: false, reason: "Addon does not expose applyBackgroundUpdates" };
    }
    addon.applyBackgroundUpdates = zmsAddonAutoUpdateMode(!!enabled, manager);
    return { ok: true, enabled: !!enabled, mode: addon.applyBackgroundUpdates };
  } catch (err) {
    return { ok: false, reason: zmsAutoUpdateError(err) };
  }
}

function zmsAddonManager() {
  const chromeUtils = zmsRuntimeChromeUtils();
  try {
    if (typeof chromeUtils?.importESModule === "function") {
      const imported = chromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
      if (imported?.AddonManager) return imported.AddonManager;
    }
  } catch (_err) {}
  try {
    if (typeof chromeUtils?.import === "function") {
      const imported = chromeUtils.import("resource://gre/modules/AddonManager.jsm");
      if (imported?.AddonManager) return imported.AddonManager;
    }
  } catch (_err) {}
  try {
    const components = zmsRuntimeComponents();
    if (typeof components?.utils?.import === "function") {
      const imported = {};
      components.utils.import("resource://gre/modules/AddonManager.jsm", imported);
      if (imported?.AddonManager) return imported.AddonManager;
    }
  } catch (_err) {}
  try {
    if (typeof AddonManager !== "undefined" && AddonManager) return AddonManager;
  } catch (_err) {}
  return null;
}

function zmsGetAddonByID(manager, addonId) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      const returned = manager.getAddonByID(addonId, finish);
      if (returned && typeof returned.then === "function") {
        returned.then(finish, reject);
      } else if (returned !== undefined && manager.getAddonByID.length < 2) {
        finish(returned);
      }
    } catch (err) {
      reject(err);
    }
  });
}

function zmsAddonAutoUpdateMode(enabled, manager) {
  if (enabled && manager?.AUTOUPDATE_ENABLE !== undefined) return manager.AUTOUPDATE_ENABLE;
  if (!enabled && manager?.AUTOUPDATE_DISABLE !== undefined) return manager.AUTOUPDATE_DISABLE;
  return enabled ? 2 : 0;
}

function zmsAutoUpdateError(err) {
  return String(err?.message || err || "Unknown error").replace(/\s+/g, " ").trim();
}

function zmsRuntimeChromeUtils() {
  try {
    if (typeof ChromeUtils !== "undefined" && ChromeUtils) return ChromeUtils;
  } catch (_err) {}
  return zmsRuntimeWindowValue("ChromeUtils");
}

function zmsRuntimeComponents() {
  try {
    if (typeof Components !== "undefined" && Components) return Components;
  } catch (_err) {}
  return zmsRuntimeWindowValue("Components");
}

function zmsRuntimeWindowValue(key) {
  try {
    if (typeof window !== "undefined" && window?.[key]) return window[key];
  } catch (_err) {}
  try {
    if (typeof window !== "undefined" && window?.parent?.[key]) return window.parent[key];
  } catch (_err) {}
  try {
    if (typeof globalThis !== "undefined" && globalThis?.[key]) return globalThis[key];
  } catch (_err) {}
  return null;
}
