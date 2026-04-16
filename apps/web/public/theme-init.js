/* eslint-env browser */
/* eslint-disable @typescript-eslint/no-unused-vars */
// Theme initialization script
// Must run synchronously before page render to prevent flash
(function () {
  var t = 'system';
  try {
    t = localStorage.getItem('theme') || 'system';
  } catch (_e) {
    // Ignore localStorage errors
  }
  var d =
    t === 'dark' ||
    (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (d) document.documentElement.classList.add('dark');
})();
