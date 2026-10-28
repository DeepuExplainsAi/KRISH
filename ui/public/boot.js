// Built with TODOforAI — https://todofor.ai
// Runs before the first paint (a blocking script; the CSP forbids inline ones): sets the saved theme so the app never flashes the wrong colours.
(function () {
  try {
    var saved = JSON.parse(localStorage.getItem("krish:settings") || "{}");
    var pref = saved.theme || "auto";
    var dark = matchMedia("(prefers-color-scheme: dark)").matches;
    var h = new Date().getHours();
    var night = h >= 19 || h < 7;
    var theme = pref === "auto" ? (night ? "dark" : "light") : pref === "system" ? (dark ? "dark" : "light") : pref;
    document.documentElement.dataset.theme = theme;
  } catch {
    // no saved settings yet: the app sets the theme itself once it is ready
  }
})();
