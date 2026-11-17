/* Accessibility toolbar for the Boeing–Technion SAF Innovation Center site
 * (adapted from the Dana Research Group site's toolbar).
 *
 * A self-contained, zero-dependency, classic <script> (works from file://) that injects
 * its own styles + DOM. It offers user-invoked display adjustments on top of the site's
 * native support (browser zoom, prefers-contrast, forced-colors): text size, higher
 * contrast, grayscale, link highlighting, and a plainer readable font. State persists in
 * localStorage so it carries across pages and visits.
 *
 * Loaded from <head> (blocking): the <style> and the root-level settings (--drg-zoom /
 * --drg-filter / html classes) are applied SYNCHRONOUSLY before <body> paints, so a
 * persisted preference shows no flash of unadjusted content when navigating between pages.
 * The toolbar DOM itself is mounted once the body is available.
 *
 * Design notes:
 *  - Adjustments apply to every direct child of <body> EXCEPT this toolbar
 *    (`.drg-a11y`) and the video dialog (`#vmodal`). Text size uses `zoom` (keeps layout
 *    flow; the site is px-based so a root font-size change would not reach it). Engines
 *    that ignore `zoom` degrade gracefully — native browser zoom still works.
 *  - No colour INVERSION is offered: a CSS `filter:invert()` on a rich, image-heavy layout
 *    produces seams (re-inverted media vs inverted background) and unreadable results.
 *  - "High contrast" is a colour-variable override (strengthens text/link/border colours),
 *    NOT a CSS `filter:contrast()` — a filter would also distort institutional logos, which
 *    must keep their original appearance. Grayscale stays a filter (desaturating images is
 *    the point of a grayscale mode).
 *  - The toolbar is a normal <body> child, so the video dialog's setBackgroundInert()
 *    inerts it while a video plays (no conflict).
 */
(function () {
  'use strict';
  if (window.__drgA11yToolbar) return;        // guard against double-injection
  window.__drgA11yToolbar = true;

  var STORE_KEY = 'saf-a11y';
  var MIN_STEP = -2, MAX_STEP = 10;           // text-size steps: zoom = 1 + step*0.1  (0.8×–2.0×)
  var TOGGLES = ['contrast', 'grayscale', 'links', 'readable'];

  var state = { step: 0, contrast: false, grayscale: false, links: false, readable: false };
  try {
    var saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      // Sanitize strictly: coerce each field rather than trusting stored types
      // (a hostile/legacy value like "false" or [] would otherwise read as truthy).
      var step = Number(saved.step);
      if (!isNaN(step)) state.step = Math.max(MIN_STEP, Math.min(MAX_STEP, Math.round(step)));
      TOGGLES.forEach(function (k) { state[k] = saved[k] === true; });
    }
  } catch (e) { /* private mode / disabled storage — run with defaults */ }

  /* ---- styles ---- */
  var css =
    /* Contrast/grayscale + zoom apply to every top-level block EXCEPT this toolbar and
       the video dialog. Excluding #vmodal preserves the iframe's fixed-position containing
       block (a `filter` on it would otherwise re-root fixed descendants). */
    'body>*:not(.drg-a11y):not(#vmodal){zoom:var(--drg-zoom,1);filter:var(--drg-filter,none)}' +
    /* High contrast: strengthen text/link/border colours via the site's CSS variables.
       Images (logos) are never filtered, so they keep their original appearance. */
    'html.a11y-contrast body>*:not(.drg-a11y):not(#vmodal){' +
    '--foreground:0 0% 0%;--card-foreground:0 0% 0%;--muted-foreground:215 30% 18%;--border:215 15% 35%;--primary:214 90% 24%}' +
    'html.a11y-contrast body>*:not(.drg-a11y) .gradient-navy{background:#000!important}' +
    'html.a11y-links body>*:not(.drg-a11y) a{text-decoration:underline!important;outline:1px solid currentColor;outline-offset:2px}' +
    'html.a11y-readable body>*:not(.drg-a11y),html.a11y-readable body>*:not(.drg-a11y) *{' +
    'font-family:Arial,Helvetica,system-ui,sans-serif!important;letter-spacing:.01em!important;line-height:1.75!important}' +
    /* toolbar chrome */
    '.drg-a11y{position:fixed;left:18px;bottom:18px;z-index:995}' +
    '.drg-a11y *{box-sizing:border-box}' +
    '.drg-a11y .drg-launch{width:48px;height:48px;border-radius:50%;border:2px solid #fff;background:#1a4fa0;color:#fff;' +
    'display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.25);padding:0}' +
    '.drg-a11y .drg-launch:hover{background:#123a78}' +
    '.drg-a11y .drg-launch:focus-visible{outline:3px solid #123a78;outline-offset:2px}' +
    '.drg-a11y .drg-panel{position:absolute;left:0;bottom:58px;width:250px;background:#fff;color:#16191D;border:1px solid #767D86;' +
    'border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.18);padding:14px;font-family:system-ui,sans-serif;display:none}' +
    '.drg-a11y[data-open="true"] .drg-panel{display:block}' +
    '.drg-a11y .drg-panel h2{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#1a4fa0;margin:0 0 10px;font-weight:700}' +
    '.drg-a11y .drg-row{display:flex;gap:8px;margin-bottom:8px}' +
    '.drg-a11y .drg-b{flex:1;min-height:38px;border:1px solid #767D86;background:#F7F8FA;color:#16191D;border-radius:8px;' +
    'font-size:13px;cursor:pointer;padding:6px 8px;text-align:center;line-height:1.3}' +
    '.drg-a11y .drg-b:hover{border-color:#1a4fa0}' +
    '.drg-a11y .drg-b:focus-visible{outline:2px solid #1a4fa0;outline-offset:1px}' +
    '.drg-a11y .drg-b[aria-pressed="true"]{background:#1a4fa0;border-color:#1a4fa0;color:#fff;font-weight:600}' +
    '.drg-a11y .drg-reset{width:100%;margin-top:2px;min-height:36px;border:1px solid #767D86;background:#fff;color:#123a78;' +
    'border-radius:8px;font-size:13px;font-weight:600;cursor:pointer}' +
    '.drg-a11y .drg-reset:hover{background:#EAF1F9}' +
    '.drg-a11y .drg-reset:focus-visible{outline:2px solid #1a4fa0;outline-offset:1px}' +
    '@media (forced-colors:active){.drg-a11y .drg-launch{border-color:ButtonText}' +
    '.drg-a11y .drg-b[aria-pressed="true"]{outline:2px solid}}';

  function injectStyle() {
    if (document.getElementById('drg-a11y-style')) return;
    var styleEl = document.createElement('style');
    styleEl.id = 'drg-a11y-style';
    styleEl.appendChild(document.createTextNode(css));
    (document.head || document.documentElement).appendChild(styleEl);
  }

  /* ---- apply root-level state (no DOM dependency; safe to run before <body>) ---- */
  function applyRoot() {
    var d = document.documentElement;
    d.style.setProperty('--drg-zoom', String(1 + state.step * 0.1));
    // Grayscale is the only filter (desaturating images is expected in that mode).
    // High contrast is a colour-variable override (below), never an image filter, so
    // every logo keeps its original appearance.
    d.style.setProperty('--drg-filter', state.grayscale ? 'grayscale(1)' : 'none');
    d.classList.toggle('a11y-contrast', state.contrast);
    d.classList.toggle('a11y-links', state.links);
    d.classList.toggle('a11y-readable', state.readable);
  }

  /* ---- DOM ---- */
  var ICON =
    '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" focusable="false">' +
    '<circle cx="12" cy="12" r="11" fill="none" stroke="currentColor" stroke-width="1.6"/>' +
    '<circle cx="12" cy="6.4" r="1.6" fill="currentColor"/>' +
    '<path d="M5 9.3c2.2 1 4.6 1.4 7 1.4s4.8-.4 7-1.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
    '<path d="M12 10.3v4.4M12 14.7l-2.4 4.6M12 14.7l2.4 4.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
    '</svg>';

  var root = null;
  function buildDOM() {
    root = document.createElement('div');
    root.className = 'drg-a11y';
    root.innerHTML =
      '<button type="button" class="drg-launch" aria-label="Accessibility options" aria-expanded="false" aria-controls="drg-a11y-panel">' + ICON + '</button>' +
      '<div class="drg-panel" id="drg-a11y-panel" role="region" aria-label="Accessibility options">' +
      '<h2>Accessibility</h2>' +
      '<div class="drg-row">' +
      '<button type="button" class="drg-b" data-act="dec" aria-label="Decrease text size">A&minus;</button>' +
      '<button type="button" class="drg-b" data-act="inc" aria-label="Increase text size">A+</button>' +
      '</div>' +
      '<div class="drg-row">' +
      '<button type="button" class="drg-b" data-act="contrast" aria-pressed="false">High contrast</button>' +
      '<button type="button" class="drg-b" data-act="grayscale" aria-pressed="false">Grayscale</button>' +
      '</div>' +
      '<div class="drg-row">' +
      '<button type="button" class="drg-b" data-act="links" aria-pressed="false">Highlight links</button>' +
      '<button type="button" class="drg-b" data-act="readable" aria-pressed="false">Readable font</button>' +
      '</div>' +
      '<button type="button" class="drg-reset" data-act="reset">Reset all</button>' +
      '</div>';
  }

  function syncButtons() {
    if (!root) return;
    TOGGLES.forEach(function (act) {
      var b = root.querySelector('.drg-b[data-act="' + act + '"]');
      if (b) b.setAttribute('aria-pressed', state[act] ? 'true' : 'false');
    });
  }

  function apply() {
    applyRoot();
    syncButtons();
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  /* ---- interactions ---- */
  var launch, panel;
  function openPanel() {
    root.setAttribute('data-open', 'true');
    launch.setAttribute('aria-expanded', 'true');
    var first = panel.querySelector('.drg-b');
    if (first) first.focus();
  }
  function closePanel(returnFocus) {
    root.removeAttribute('data-open');
    launch.setAttribute('aria-expanded', 'false');
    if (returnFocus) launch.focus();
  }
  function isOpen() { return root.getAttribute('data-open') === 'true'; }

  function act(name) {
    switch (name) {
      case 'inc': state.step = Math.min(MAX_STEP, state.step + 1); break;
      case 'dec': state.step = Math.max(MIN_STEP, state.step - 1); break;
      case 'contrast': state.contrast = !state.contrast; break;
      case 'grayscale': state.grayscale = !state.grayscale; break;
      case 'links': state.links = !state.links; break;
      case 'readable': state.readable = !state.readable; break;
      case 'reset': state = { step: 0, contrast: false, grayscale: false, links: false, readable: false }; break;
    }
    apply();
  }

  function mount() {
    if (root) return;
    injectStyle();          // idempotent; ensures style present even if head-run was skipped
    buildDOM();
    document.body.appendChild(root);
    launch = root.querySelector('.drg-launch');
    panel = root.querySelector('.drg-panel');
    syncButtons();
    launch.addEventListener('click', function () { isOpen() ? closePanel(false) : openPanel(); });
    root.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-act]') : null;
      if (b) act(b.getAttribute('data-act'));
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen()) closePanel(true);
    });
    document.addEventListener('click', function (e) {
      if (isOpen() && !root.contains(e.target)) closePanel(false);
    });
  }

  // Apply persisted look immediately (before <body> paints, when loaded from <head>),
  // then mount the toolbar DOM once the body exists.
  injectStyle();
  applyRoot();
  if (document.body) {
    mount();
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
