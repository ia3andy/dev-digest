document.addEventListener('DOMContentLoaded', () => {

  var root = document.querySelector('.swipe-page-root');
  if (!root) return;

  var postDate = root.dataset.postDate;
  var track = root.querySelector('.swipe-track');

  // --- Priority filtering ---

  var defaults = window.DEFAULT_TAG_PRIORITIES || {};
  var overrides = JSON.parse(localStorage.getItem('digest-tag-priorities') || '{}');
  var priorities = Object.assign({}, defaults, overrides);
  var storedUnsorted = localStorage.getItem('digest-unsorted-priority');
  var unsortedPri = window.UNSORTED_PRIORITY || 4;
  var defaultPriority = storedUnsorted !== null ? parseInt(storedUnsorted) : unsortedPri;

  function resolvePriority(tags) {
    if (tags.length === 0) return defaultPriority;
    var primary = priorities[tags[0]];
    if (primary !== undefined && primary !== 0) return primary;
    for (var i = 1; i < tags.length; i++) {
      var p = priorities[tags[i]];
      if (p !== undefined && p !== 0) return p;
    }
    return defaultPriority;
  }

  var PLACEHOLDER_SUFFIX = 'article-placeholder.svg';
  var FALLBACK_BG_COUNT = 15;

  function fallbackBg(id) {
    var hash = 0;
    for (var i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
    var n = (Math.abs(hash) % FALLBACK_BG_COUNT) + 1;
    return '/images/swipe-bg/' + n + '.jpg';
  }

  var frames = Array.from(track.querySelectorAll('.swipe-frame:not(.swipe-frame-completion)'));
  var completionFrame = track.querySelector('.swipe-frame-completion');
  var grouped = { high: [], low: [], hidden: [] };

  for (var i = 0; i < frames.length; i++) {
    var frame = frames[i];
    var tags = (frame.dataset.tags || '').split(',').map(function(t) { return t.trim(); }).filter(Boolean);
    var priority = resolvePriority(tags);
    frame.dataset.priority = priority;

    if (priority === 5) {
      grouped.hidden.push(frame);
    } else if (priority <= 2) {
      grouped.high.push(frame);
    } else {
      grouped.low.push(frame);
    }

    // Swap placeholder backgrounds to fallback images
    var bgEls = frame.querySelectorAll('.swipe-card-bg, .swipe-layer-bg');
    for (var j = 0; j < bgEls.length; j++) {
      var bgStyle = bgEls[j].style.backgroundImage;
      if (bgStyle && bgStyle.indexOf(PLACEHOLDER_SUFFIX) !== -1) {
        bgEls[j].style.backgroundImage = 'url(' + fallbackBg(frame.dataset.articleId) + ')';
      }
    }
  }

  // Remove all frames, reinsert in priority order
  for (var i = 0; i < frames.length; i++) frames[i].remove();
  var ordered = grouped.high.concat(grouped.low);
  for (var i = 0; i < ordered.length; i++) track.insertBefore(ordered[i], completionFrame);
  // Hidden frames stay removed

  var visibleFrames = ordered;
  var totalArticles = visibleFrames.length;

  // Build dot indicators per frame
  for (var i = 0; i < visibleFrames.length; i++) {
    var layers = visibleFrames[i].querySelector('.swipe-layers');
    var dots = visibleFrames[i].querySelector('.swipe-dots');
    var layerCount = layers.children.length;
    if (layerCount > 1) {
      for (var d = 0; d < layerCount; d++) {
        var dot = document.createElement('span');
        dot.className = d === 0 ? 'swipe-dot is-active' : 'swipe-dot';
        dots.appendChild(dot);
      }
      (function(layers, dots) {
        layers.addEventListener('scroll', function() {
          var idx = Math.round(layers.scrollLeft / layers.clientWidth);
          var allDots = dots.querySelectorAll('.swipe-dot');
          for (var k = 0; k < allDots.length; k++) {
            allDots[k].classList.toggle('is-active', k === idx);
          }
        });
      })(layers, dots);
    }
  }

  // Update progress text and completion stats
  var progressText = root.querySelector('.swipe-progress-text');
  var progressFill = root.querySelector('.swipe-progress-fill');
  var completionStats = root.querySelector('.swipe-completion-stats');
  if (progressText) progressText.textContent = '1 / ' + totalArticles;
  if (completionStats) completionStats.textContent = totalArticles + ' articles';

  // --- Scroll buttons ---

  function smoothScroll(element, delta, duration) {
    var start = element.scrollTop;
    var target = Math.max(0, Math.min(start + delta, element.scrollHeight - element.clientHeight));
    var startTime = null;
    function step(time) {
      if (!startTime) startTime = time;
      var t = Math.min((time - startTime) / duration, 1);
      var ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      element.scrollTop = start + (target - start) * ease;
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  track.addEventListener('click', function(e) {
    var btn = e.target.closest('.swipe-scroll-btn');
    if (!btn) return;
    e.stopPropagation();
    var viewport = btn.closest('.swipe-layer').querySelector('.swipe-text-viewport');
    if (!viewport) return;
    var delta = viewport.clientHeight * 0.6;
    if (btn.classList.contains('swipe-scroll-up')) delta = -delta;
    smoothScroll(viewport, delta, 600);
  });

  // Initialize scroll button visibility
  var viewports = track.querySelectorAll('.swipe-text-viewport');
  for (var i = 0; i < viewports.length; i++) {
    (function(viewport) {
      var layer = viewport.closest('.swipe-layer');
      var btnUp = layer.querySelector('.swipe-scroll-up');
      var btnDown = layer.querySelector('.swipe-scroll-down');
      if (!btnUp || !btnDown) return;

      function updateButtons() {
        var atTop = viewport.scrollTop <= 1;
        var atBottom = viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 1;
        btnUp.classList.toggle('is-hidden', atTop);
        btnDown.classList.toggle('is-hidden', atBottom);
      }

      viewport.addEventListener('scroll', updateButtons);
      viewport.addEventListener('touchmove', function(e) {
        if (viewport.scrollHeight > viewport.clientHeight + 2) e.stopPropagation();
      }, { passive: true });

      requestAnimationFrame(function check() {
        if (!layer.parentNode) return requestAnimationFrame(check);
        var overflows = viewport.scrollHeight > viewport.clientHeight + 2;
        btnDown.classList.toggle('is-hidden', !overflows);
        btnUp.classList.add('is-hidden');
        if (!overflows) {
          btnDown.classList.add('is-permanent-hidden');
          btnUp.classList.add('is-permanent-hidden');
        }
      });
    })(viewports[i]);
  }

  // --- Read tracking ---

  function getCurrentFrameIndex() {
    var idx = 0;
    var allFrames = track.querySelectorAll('.swipe-frame');
    for (var i = 0; i < allFrames.length; i++) {
      if (allFrames[i].offsetTop <= track.scrollTop + track.clientHeight / 2) idx = i;
    }
    return idx;
  }

  var obs = new IntersectionObserver(function(entries) {
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
        if (entry.target.classList.contains('swipe-frame-completion')) {
          document.dispatchEvent(new CustomEvent('digest-mark-read', { detail: { date: postDate } }));
        }
        // Update progress
        var visIdx = visibleFrames.indexOf(entry.target);
        if (visIdx >= 0) {
          var n = visIdx + 1;
          if (progressText) progressText.textContent = n + ' / ' + totalArticles;
          if (progressFill) progressFill.style.width = (n / totalArticles * 100) + '%';
        }
      }
      if (!entry.isIntersecting && entry.boundingClientRect.top < 0) {
        var aid = entry.target.dataset.articleId;
        if (aid) {
          document.dispatchEvent(new CustomEvent('digest-mark-article-read', { detail: { date: postDate, articleId: aid } }));
        }
      }
    }
  }, { root: track, threshold: [0, 0.5] });

  var allTrackFrames = track.querySelectorAll('.swipe-frame');
  for (var i = 0; i < allTrackFrames.length; i++) obs.observe(allTrackFrames[i]);

  // Scroll to first unread article
  for (var i = 0; i < visibleFrames.length; i++) {
    var evt = new CustomEvent('digest-is-article-read', {
      detail: { date: postDate, articleId: visibleFrames[i].dataset.articleId, result: false }
    });
    document.dispatchEvent(evt);
    if (!evt.detail.result) {
      if (i > 0) visibleFrames[i].scrollIntoView();
      break;
    }
  }

  // --- Share button ---

  var shareBtn = root.querySelector('.swipe-topbar .swipe-share-btn');

  function updateShare() {
    var idx = getCurrentFrameIndex();
    var allFrames = track.querySelectorAll('.swipe-frame:not(.swipe-frame-completion)');
    var frame = allFrames[idx];
    if (!frame || !shareBtn) return;
    shareBtn.dataset.shareArticle = frame.dataset.articleId;
    shareBtn.title = (frame.querySelector('.swipe-card-title') || {}).textContent || '';
  }

  track.addEventListener('scroll', updateShare);
  updateShare();

  // --- Hide loading indicator ---
  var loader = root.querySelector('.swipe-loading');
  if (loader) loader.remove();

  // --- Keyboard navigation ---

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      window.location.href = root.dataset.backUrl;
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      var allFrames = track.querySelectorAll('.swipe-frame');
      var idx = getCurrentFrameIndex();
      var next = e.key === 'ArrowDown' ? Math.min(idx + 1, allFrames.length - 1) : Math.max(idx - 1, 0);
      allFrames[next].scrollIntoView({ behavior: 'smooth' });
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      var allFrames = track.querySelectorAll('.swipe-frame');
      var idx = getCurrentFrameIndex();
      var layers = allFrames[idx].querySelector('.swipe-layers');
      if (!layers) return;
      var layerIdx = Math.round(layers.scrollLeft / layers.clientWidth);
      var target = e.key === 'ArrowRight' ? layerIdx + 1 : layerIdx - 1;
      if (target >= 0 && target < layers.children.length) {
        layers.children[target].scrollIntoView({ behavior: 'smooth', inline: 'start' });
      }
    }
  });
});
