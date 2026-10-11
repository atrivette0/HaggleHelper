// The toolbar menu's on/off switch. Open Haggle tabs pick the change up
// right away through src/bridge.js.
const box = document.getElementById("enabled");
const hint = document.getElementById("hint");

function show(enabled) {
  box.checked = enabled;
  hint.textContent = enabled
    ? "On: full results list, grouped listings and MSRP links."
    : "Off: Haggle's own pages, unchanged.";
}

chrome.storage.local.get("enabled", (items) => show(items.enabled !== false));
box.addEventListener("change", () => {
  chrome.storage.local.set({ enabled: box.checked });
  show(box.checked);
});
