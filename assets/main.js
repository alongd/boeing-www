// Vanilla JS re-implementation of the Lovable/framer-motion behavior:
// (1) mobile nav menu toggle + slide animation
// (2) scroll-triggered "whileInView" reveal animations
// (3) page-load hero animations
// (4) technology section rotating word
// (5) PI website/LinkedIn links
// (6) footer year
// No dependencies. Scripts run at the end of <body>, so each feature initializes
// synchronously (no DOMContentLoaded wait); every feature is wrapped in its own
// try/catch so a failure in one cannot block the others.

// ---------- Mobile menu ----------
(function () {
  "use strict";
  try {
    var toggle = document.getElementById("mobile-menu-toggle");
    var panel = document.getElementById("mobile-menu-panel");
    var iconMenu = document.getElementById("icon-menu");
    var iconClose = document.getElementById("icon-close");
    if (!toggle || !panel) return;

    var isOpen = false;
    var DURATION = 300; // framer-motion default transition duration (ms)
    var pendingTimer = null;

    function clearPending() {
      if (pendingTimer !== null) {
        window.clearTimeout(pendingTimer);
        pendingTimer = null;
      }
    }

    function setIcons(open) {
      if (iconMenu) iconMenu.style.display = open ? "none" : "";
      if (iconClose) iconClose.style.display = open ? "" : "none";
    }

    function setExpanded(open) {
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    }

    function openMenu() {
      if (isOpen) return;
      clearPending();
      isOpen = true;
      setIcons(true);
      setExpanded(true);
      panel.removeAttribute("hidden");
      // force reflow so the transition from the starting values is applied
      panel.style.height = "0px";
      panel.style.opacity = "0";
      panel.getBoundingClientRect();
      var target = panel.scrollHeight;
      panel.style.transition = "height " + DURATION + "ms ease, opacity " + DURATION + "ms ease";
      panel.style.height = target + "px";
      panel.style.opacity = "1";
      pendingTimer = window.setTimeout(function () {
        pendingTimer = null;
        if (isOpen) panel.style.height = "auto";
      }, DURATION);
    }

    function closeMenu() {
      if (!isOpen) return;
      clearPending();
      isOpen = false;
      setIcons(false);
      setExpanded(false);
      // animate from whatever height is currently rendered
      var current = panel.scrollHeight;
      panel.style.height = current + "px";
      panel.getBoundingClientRect();
      panel.style.transition = "height " + DURATION + "ms ease, opacity " + DURATION + "ms ease";
      panel.style.height = "0px";
      panel.style.opacity = "0";
      pendingTimer = window.setTimeout(function () {
        pendingTimer = null;
        if (!isOpen) {
          panel.setAttribute("hidden", "");
          panel.style.height = "";
          panel.style.opacity = "";
          panel.style.transition = "";
        }
      }, DURATION);
    }

    function resetClosed() {
      clearPending();
      isOpen = false;
      setIcons(false);
      setExpanded(false);
      panel.setAttribute("hidden", "");
      panel.style.height = "";
      panel.style.opacity = "";
      panel.style.transition = "";
    }

    toggle.addEventListener("click", function () {
      if (isOpen) closeMenu();
      else openMenu();
    });

    panel.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", closeMenu);
    });

    // >=768px is md: in Tailwind; the panel is desktop-hidden via the md:hidden
    // class regardless, but reset state so a stray inline height/opacity never
    // lingers and re-opening on mobile later starts clean.
    if (window.matchMedia) {
      var mq = window.matchMedia("(min-width: 768px)");
      var handleChange = function (e) {
        if (e.matches) resetClosed();
      };
      if (mq.addEventListener) mq.addEventListener("change", handleChange);
      else if (mq.addListener) mq.addListener(handleChange);
    }
  } catch (err) {
    /* mobile menu init failed; leave default (closed) markup in place */
  }
})();

// ---------- Scroll-triggered reveal animations ----------
(function () {
  "use strict";
  try {
    // Presets mirror the exact framer-motion params extracted from the bundle.
    var PRESETS = {
      header: { y: 20, duration: 500, margin: "-100px" },
      card: { y: 20, duration: 400 },
      "tech-image": { scale: 0.95, duration: 300 },
      "tech-feature": { y: 20, duration: 300 },
      publication: { y: 20, duration: 300 },
      partner: { y: 15, duration: 300 },
      media: { y: 20, duration: 300 },
      "contact-info": { y: 20, duration: 300 },
      "contact-map": { y: 20, duration: 300 },
    };

    function reveal(el, preset) {
      var delay = parseInt(el.getAttribute("data-delay") || "0", 10);
      var transProps = [];
      if (preset.y !== undefined) transProps.push("transform");
      if (preset.scale !== undefined) transProps.push("transform");
      transProps.push("opacity");
      var uniqueProps = transProps.filter(function (v, i, a) {
        return a.indexOf(v) === i;
      });
      el.style.transition =
        uniqueProps.map(function (p) {
          return p + " " + preset.duration + "ms ease-out " + delay + "ms";
        }).join(", ");
      el.style.opacity = "1";
      el.style.transform = "none";
    }

    var elements = document.querySelectorAll("[data-anim]");

    if (typeof IntersectionObserver === "undefined") {
      // No IO support: reveal everything immediately, no offscreen pausing.
      elements.forEach(function (el) {
        var preset = PRESETS[el.getAttribute("data-anim")];
        if (preset) reveal(el, preset);
      });
      return;
    }

    var byMargin = {};
    elements.forEach(function (el) {
      var name = el.getAttribute("data-anim");
      var preset = PRESETS[name];
      if (!preset) return; // hero-left/hero-video handled separately (page-load)
      var margin = preset.margin || "0px";
      byMargin[margin] = byMargin[margin] || [];
      byMargin[margin].push({ el: el, preset: preset });
    });

    Object.keys(byMargin).forEach(function (margin) {
      var items = byMargin[margin];
      var observer = new IntersectionObserver(
        function (entries, obs) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) {
              var match = items.filter(function (i) {
                return i.el === entry.target;
              })[0];
              if (match) reveal(match.el, match.preset);
              obs.unobserve(entry.target);
            }
          });
        },
        { root: null, rootMargin: margin, threshold: 0 }
      );
      items.forEach(function (i) {
        observer.observe(i.el);
      });
    });
  } catch (err) {
    /* reveal init failed */
  }
})();

// ---------- Page-load hero animations ----------
(function () {
  "use strict";
  try {
    var left = document.querySelector('[data-anim="hero-left"]');
    var video = document.querySelector('[data-anim="hero-video"]');
    if (left) {
      left.style.transition = "opacity 700ms ease-out, transform 700ms ease-out";
      requestAnimationFrame(function () {
        left.style.opacity = "1";
        left.style.transform = "none";
      });
    }
    if (video) {
      video.style.transition = "opacity 700ms ease-out 300ms, transform 700ms ease-out 300ms";
      requestAnimationFrame(function () {
        video.style.opacity = "1";
        video.style.transform = "none";
      });
    }
  } catch (err) {
    /* hero init failed */
  }
})();

// ---------- Technology section: rotating word ----------
(function () {
  "use strict";
  try {
    var container = document.querySelector('[data-anim="tech-image"]');
    var rotatorEl = container ? container.querySelector(".tech-rotator") : document.querySelector(".tech-rotator");
    var words = rotatorEl ? rotatorEl.querySelectorAll(".tech-word") : [];
    if (!rotatorEl || !words.length) return;

    var TRANSITION_MS = 500; // matches the CSS transition duration
    var currentIndex = 0;
    var holdTimer = null;
    var transitionTimer = null;
    var running = false;
    var reducedMotion = false;
    var pausedOffscreen = false;
    var pausedHidden = false;

    function activeIndex() {
      for (var i = 0; i < words.length; i++) {
        if (words[i].classList.contains("is-active")) return i;
      }
      return 0;
    }
    currentIndex = activeIndex();

    function getHoldMs() {
      var raw = getComputedStyle(rotatorEl).getPropertyValue("--rotator-ms");
      var n = parseFloat(raw);
      return isNaN(n) ? 2200 : n;
    }

    function clearTimers() {
      if (holdTimer !== null) {
        window.clearTimeout(holdTimer);
        holdTimer = null;
      }
      if (transitionTimer !== null) {
        window.clearTimeout(transitionTimer);
        transitionTimer = null;
      }
    }

    function scheduleNext() {
      holdTimer = window.setTimeout(function () {
        holdTimer = null;
        rotateStep();
      }, getHoldMs());
    }

    function rotateStep() {
      var current = words[currentIndex];
      var nextIndex = (currentIndex + 1) % words.length;
      var next = words[nextIndex];
      current.classList.remove("is-active");
      current.classList.add("is-leaving");
      next.classList.add("is-active");
      transitionTimer = window.setTimeout(function () {
        transitionTimer = null;
        current.classList.remove("is-leaving");
        currentIndex = nextIndex;
        scheduleNext();
      }, TRANSITION_MS);
    }

    function canRun() {
      return !reducedMotion && !pausedOffscreen && !pausedHidden;
    }

    function start() {
      if (running || !canRun()) return;
      running = true;
      scheduleNext();
    }

    function stop() {
      if (!running) return;
      running = false;
      if (transitionTimer !== null) {
        // finish any in-flight transition immediately so state stays consistent
        var current = words[currentIndex];
        var nextIndex = (currentIndex + 1) % words.length;
        current.classList.remove("is-leaving");
        currentIndex = nextIndex;
      }
      clearTimers();
    }

    function showStatic(word) {
      var match = null;
      words.forEach(function (w) {
        w.classList.remove("is-active", "is-leaving");
        if (!match && w.textContent.trim().toLowerCase() === word.toLowerCase()) match = w;
      });
      var target = match || words[0];
      target.classList.add("is-active");
      currentIndex = Array.prototype.indexOf.call(words, target);
    }

    function applyReducedMotion(reduced) {
      reducedMotion = reduced;
      if (reduced) {
        stop();
        showStatic("Innovation");
      } else {
        start();
      }
    }

    var reduceMq = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    if (reduceMq) {
      applyReducedMotion(reduceMq.matches);
      var onReduceChange = function (e) {
        applyReducedMotion(e.matches);
      };
      if (reduceMq.addEventListener) reduceMq.addEventListener("change", onReduceChange);
      else if (reduceMq.addListener) reduceMq.addListener(onReduceChange);
    } else {
      start();
    }

    if (typeof IntersectionObserver !== "undefined") {
      var io = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            pausedOffscreen = !entry.isIntersecting;
            if (pausedOffscreen) stop();
            else start();
          });
        },
        { threshold: 0 }
      );
      io.observe(container || rotatorEl);
    }

    document.addEventListener("visibilitychange", function () {
      pausedHidden = document.hidden;
      if (pausedHidden) stop();
      else start();
    });
  } catch (err) {
    /* rotator init failed */
  }
})();

// ---------- Team/PI website + LinkedIn links ----------
(function () {
  "use strict";
  try {
    function isValidHttpUrl(u) {
      if (!u || typeof u !== "string") return false;
      try {
        var parsed = new URL(u);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
      } catch (e) {
        return false;
      }
    }

    document.querySelectorAll("[data-pi]").forEach(function (card) {
      var name = card.getAttribute("data-pi");
      var links = (window.PI_LINKS && window.PI_LINKS[name]) || {};
      var row = card.querySelector("[data-pi-links]");
      if (!row) return;
      var anyVisible = false;
      row.querySelectorAll("[data-pi-link]").forEach(function (a) {
        var kind = a.getAttribute("data-pi-link");
        var url = links[kind];
        if (isValidHttpUrl(url)) {
          a.setAttribute("href", url);
          a.removeAttribute("hidden");
          anyVisible = true;
        } else {
          a.setAttribute("hidden", "");
          a.removeAttribute("href");
        }
      });
      if (anyVisible) row.removeAttribute("hidden");
      else row.setAttribute("hidden", "");
    });
  } catch (err) {
    /* PI links init failed; markup stays hidden by default */
  }
})();

// ---------- Footer year ----------
(function () {
  "use strict";
  try {
    var el = document.getElementById("footer-year");
    if (el) el.textContent = String(new Date().getFullYear());
  } catch (err) {
    /* leave the static fallback year in place */
  }
})();
