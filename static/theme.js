// Loaded in <head> so the saved theme is applied before the first paint (no flash of the default look).
// A separate file because the Content Security Policy blocks inline scripts.
try {
  if (localStorage.getItem('theme') === 'night') document.documentElement.dataset.theme = 'night';
} catch { /* storage blocked: keep the default theme */ }
