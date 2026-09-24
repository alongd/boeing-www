// Partners carousel: clone each tile once so the flex track holds two identical,
// flattened sets — CSS translateX(-50%) then loops seamlessly. Enhances the static
// grid into a scrolling marquee; skips the clone + animation entirely under
// prefers-reduced-motion (stays a static grid).
(function () {
  var marquee = document.querySelector('.marquee[data-carousel]');
  if (!marquee) return;
  var track = marquee.querySelector('.marquee-track');
  if (!track) return;

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (!reduceMotion) {
    var tiles = Array.prototype.slice.call(track.children);
    tiles.forEach(function (tile) {
      var clone = tile.cloneNode(true);
      clone.setAttribute('aria-hidden', 'true');
      var links = clone.querySelectorAll('a');
      for (var i = 0; i < links.length; i++) {
        links[i].setAttribute('tabindex', '-1');
      }
      var imgs = clone.querySelectorAll('img');
      for (var j = 0; j < imgs.length; j++) {
        imgs[j].setAttribute('alt', '');
      }
      track.appendChild(clone);
    });

    track.setAttribute('aria-label', 'Partners and sponsors');
    marquee.classList.add('is-enhanced');

    // Keyboard/touch users can't hover, so give them an explicit pause control (WCAG 2.2.2).
    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'marquee-toggle';
    toggle.setAttribute('aria-label', 'Pause partners carousel');
    toggle.textContent = 'Pause';
    toggle.addEventListener('click', function () {
      var paused = marquee.classList.toggle('is-paused');
      toggle.setAttribute('aria-label', (paused ? 'Play' : 'Pause') + ' partners carousel');
      toggle.textContent = paused ? 'Play' : 'Pause';
    });
    marquee.insertAdjacentElement('afterend', toggle);
  }
})();
