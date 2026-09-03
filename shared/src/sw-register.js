// Single source of truth (projects/CLAUDE.md §2a) for registering sw.js across every app.
// sw.js (repo root) does network-first fetch for navigation/JS/CSS so a deploy is visible
// without a hard refresh — but that guarantee only holds once the browser is actually
// running the current sw.js. A registration that never calls update() can leave a tab
// controlled by a stale worker for up to 24h (the browser's own periodic recheck interval),
// during which even a hard refresh won't show a new deploy, because Ctrl+Shift+R bypasses
// the HTTP cache but not an already-installed service worker's fetch handler.
//
// This registers, forces an immediate update check on every load, and reloads the page
// once (guarded against a loop) the instant a new worker takes control — so a deploy is
// visible on the very next navigation, with no manual DevTools/unregister step ever needed.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then(function(reg) {
    reg.update();
  });
  navigator.serviceWorker.addEventListener('controllerchange', function() {
    if (sessionStorage.getItem('sw-reloaded')) return;
    sessionStorage.setItem('sw-reloaded', '1');
    window.location.reload();
  });
}
