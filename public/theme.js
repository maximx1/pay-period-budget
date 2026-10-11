// Applies a saved light/dark choice before the page first paints, so there is no flash of
// the other scheme. A file rather than an inline script so the Content-Security-Policy
// needs no exception. The key and values must match src/client/lib/theme.ts.
try {
  var choice = localStorage.getItem("ppb-theme");
  if (choice === "light" || choice === "dark") document.documentElement.setAttribute("data-theme", choice);
} catch (error) {
  // Storage unavailable (private mode, blocked): follow the system setting.
}
