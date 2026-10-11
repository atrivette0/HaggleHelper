// Runs in the extension's own context, where the on/off setting can be read,
// and hands it to the page-context scripts: an attribute on <html> they can
// read at any time, plus an "hh:setting" event whenever it changes.
(function () {
  "use strict";

  function publish(enabled) {
    document.documentElement.setAttribute("data-hh-enabled", enabled === false ? "false" : "true");
    document.dispatchEvent(new CustomEvent("hh:setting"));
  }

  chrome.storage.local.get("enabled", (items) => publish(items && items.enabled));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.enabled) publish(changes.enabled.newValue);
  });
})();
