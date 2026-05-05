document.addEventListener('DOMContentLoaded', () => {

  const articlePage = document.querySelector('.article-page[data-post-date]');
  if (!articlePage) return;

  // --- Helpers ---

  function el(tag, cls) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  function text(tag, cls, str) {
    var e = el(tag, cls);
    e.textContent = str || '';
    return e;
  }

  function svg(w, h, paths) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('width', w);
    s.setAttribute('height', h);
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '2');
    s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
    paths.forEach(p => {
      var node = document.createElementNS('http://www.w3.org/2000/svg', p.t || 'path');
      Object.keys(p).forEach(k => { if (k !== 't') node.setAttribute(k, p[k]); });
      s.appendChild(node);
    });
    return s;
  }

  var ICON_WHAT = [{t:'circle',cx:'12',cy:'12',r:'10'},{d:'M12 16v-4'},{d:'M12 8h.01'}];
  var ICON_WHY = [{d:'M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.582a.5.5 0 0 1 0 .963L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z'}];
  var ICON_TAKEAWAY = [{t:'circle',cx:'12',cy:'12',r:'10'},{d:'m9 12 2 2 4-4'}];
  var ICON_EXTERNAL = [{d:'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'},{t:'polyline',points:'15 3 21 3 21 9'},{t:'line',x1:'10',y1:'14',x2:'21',y2:'3'}];
  var ICON_CHEVRON_RIGHT = [{d:'m9 18 6-6-6-6'}];
  var ICON_CHEVRON_LEFT = [{d:'m15 18-6-6 6-6'}];
  var ICON_CHEVRON_DOWN = [{d:'m6 9 6 6 6-6'}];
  var ICON_CHEVRON_UP = [{d:'m18 15-6-6-6 6'}];
  var ICON_SHARE = [{t:'circle',cx:'18',cy:'5',r:'3'},{t:'circle',cx:'6',cy:'12',r:'3'},{t:'circle',cx:'18',cy:'19',r:'3'},{d:'m8.59 13.51 6.83 3.98'},{d:'m15.41 6.51-6.82 3.98'}];

  var FALLBACK_BG_COUNT = 15;
  var PLACEHOLDER_SUFFIX = 'article-placeholder.svg';

  function fallbackBg(id) {
    var hash = 0;
    for (var i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
    var n = (Math.abs(hash) % FALLBACK_BG_COUNT) + 1;
    return '/images/swipe-bg/' + n + '.jpg';
  }

  // --- Data extraction ---

  function extractArticles(root) {
    return Array.from(root.querySelectorAll('.digest-article[data-article-id]')).map(function(node) {
      return {
        id: node.dataset.articleId,
        section: node.dataset.section || '',
        tags: (node.dataset.tags || '').split(',').map(function(t) { return t.trim(); }).filter(Boolean),
        priority: parseInt(node.dataset.priority) || 4,
        link: node.dataset.link || '',
        title: q(node, '.digest-article-title'),
        image: (node.querySelector('.digest-article-img') || {}).src || '',
        oneLiner: q(node, '.digest-summary-toggle'),
        what: qAfterStrong(node, '.digest-summary-what div'),
        why: qAfterStrong(node, '.digest-summary-why div'),
        takeaway: qAfterStrong(node, '.digest-summary-takeaway div'),
        deepDive: html(node, '.digest-deep-content'),
        decoder: html(node, '.digest-decoder-content'),
        original: html(node, '.digest-description-content'),
        pageUrl: node.dataset.pageUrl || ''
      };
    });
  }

  function q(root, selector) {
    var e = root.querySelector(selector);
    return e ? e.textContent.trim() : '';
  }

  function html(root, selector) {
    var e = root.querySelector(selector);
    return e ? e.innerHTML.trim() : '';
  }

  function qAfterStrong(root, selector) {
    var e = root.querySelector(selector);
    if (!e) return '';
    var strong = e.querySelector('strong');
    if (!strong) return e.textContent.trim();
    var clone = e.cloneNode(true);
    clone.querySelector('strong').remove();
    return clone.textContent.trim();
  }

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

  function extractPostMeta(root) {
    var page = root.querySelector('.article-page[data-post-date]');
    var prev = root.querySelector('.digest-post-nav-prev');
    var next = root.querySelector('.digest-post-nav-next');
    return {
      date: page ? page.dataset.postDate : '',
      prevUrl: prev ? prev.href || prev.getAttribute('href') : null,
      nextUrl: next ? next.href || next.getAttribute('href') : null,
      nextTitle: next ? (next.querySelector('.digest-post-nav-title') || {}).textContent || '' : ''
    };
  }

  // --- Frame builders ---

  function buildCardLayer(a, imgUrl) {
    var layer = el('div', 'swipe-layer swipe-layer-card');
    var bg = el('div', 'swipe-card-bg');
    bg.style.backgroundImage = 'url(' + imgUrl + ')';
    layer.appendChild(bg);
    var content = el('div', 'swipe-card-content');

    var meta = el('div', 'swipe-card-meta');
    meta.appendChild(text('span', 'swipe-badge', a.section));
    a.tags.forEach(t => {
      if (t.toLowerCase() !== a.section.toLowerCase())
        meta.appendChild(text('span', 'swipe-tag', t));
    });
    content.appendChild(meta);
    content.appendChild(text('h2', 'swipe-card-title', a.title));
    if (a.oneLiner) content.appendChild(text('p', 'swipe-card-oneliner', a.oneLiner));

    if (a.link) {
      var actions = el('div', 'swipe-card-actions');
      var link = el('a', 'swipe-card-link');
      link.href = a.link;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.appendChild(svg(14, 14, ICON_EXTERNAL));
      link.appendChild(document.createTextNode(' Read original'));
      actions.appendChild(link);
      content.appendChild(actions);
    }

    var hint = el('div', 'swipe-layer-hint');
    hint.appendChild(svg(20, 20, ICON_CHEVRON_RIGHT));
    content.appendChild(hint);

    layer.appendChild(content);
    return layer;
  }

  function summaryItem(cls, icon, label, value) {
    var item = el('div', 'swipe-summary-item ' + cls);
    var iconWrap = el('span', 'swipe-summary-icon');
    iconWrap.appendChild(svg(16, 16, icon));
    item.appendChild(iconWrap);
    var div = el('div', '');
    div.appendChild(text('strong', '', label));
    div.appendChild(document.createTextNode(' ' + value));
    item.appendChild(div);
    return item;
  }

  function layerBg(imgUrl) {
    var bg = el('div', 'swipe-layer-bg');
    bg.style.backgroundImage = 'url(' + imgUrl + ')';
    return bg;
  }

  function buildSummaryLayer(a, imgUrl) {
    if (!a.what && !a.why && !a.takeaway) return null;
    var layer = el('div', 'swipe-layer swipe-layer-summary');
    layer.appendChild(layerBg(imgUrl));
    var inner = el('div', 'swipe-layer-inner');
    inner.appendChild(text('h3', 'swipe-layer-title', 'Summary'));

    var viewport = el('div', 'swipe-text-viewport');
    if (a.what) viewport.appendChild(summaryItem('swipe-summary-what', ICON_WHAT, 'What:', a.what));
    if (a.why) viewport.appendChild(summaryItem('swipe-summary-why', ICON_WHY, 'Why it matters:', a.why));
    if (a.takeaway) viewport.appendChild(summaryItem('swipe-summary-takeaway', ICON_TAKEAWAY, 'Takeaway:', a.takeaway));
    inner.appendChild(viewport);
    layer.appendChild(inner);

    var btnUp = el('button', 'swipe-scroll-btn swipe-scroll-up');
    btnUp.appendChild(svg(20, 20, ICON_CHEVRON_UP));
    btnUp.setAttribute('aria-label', 'Scroll up');
    layer.appendChild(btnUp);

    var btnDown = el('button', 'swipe-scroll-btn swipe-scroll-down');
    btnDown.appendChild(svg(20, 20, ICON_CHEVRON_DOWN));
    btnDown.setAttribute('aria-label', 'Scroll down');
    layer.appendChild(btnDown);

    function updateButtons() {
      var atTop = viewport.scrollTop <= 1;
      var atBottom = viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 1;
      btnUp.classList.toggle('is-hidden', atTop);
      btnDown.classList.toggle('is-hidden', atBottom);
    }

    var pageSize = function() { return viewport.clientHeight * 0.6; };

    btnDown.addEventListener('click', function(e) {
      e.stopPropagation();
      smoothScroll(viewport, pageSize(), 600);
    });

    btnUp.addEventListener('click', function(e) {
      e.stopPropagation();
      smoothScroll(viewport, -pageSize(), 600);
    });

    viewport.addEventListener('scroll', updateButtons);

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

    return layer;
  }

  function buildTextLayer(title, content, cls, imgUrl) {
    if (!content) return null;
    var layer = el('div', 'swipe-layer ' + cls);
    layer.appendChild(layerBg(imgUrl));
    var inner = el('div', 'swipe-layer-inner');
    inner.appendChild(text('h3', 'swipe-layer-title', title));

    var viewport = el('div', 'swipe-text-viewport');
    var body = el('div', 'swipe-text-body prose');
    body.innerHTML = content;
    viewport.appendChild(body);
    inner.appendChild(viewport);
    layer.appendChild(inner);

    var btnUp = el('button', 'swipe-scroll-btn swipe-scroll-up');
    btnUp.appendChild(svg(20, 20, ICON_CHEVRON_UP));
    btnUp.setAttribute('aria-label', 'Scroll up');
    layer.appendChild(btnUp);

    var btnDown = el('button', 'swipe-scroll-btn swipe-scroll-down');
    btnDown.appendChild(svg(20, 20, ICON_CHEVRON_DOWN));
    btnDown.setAttribute('aria-label', 'Scroll down');
    layer.appendChild(btnDown);

    function updateButtons() {
      var atTop = viewport.scrollTop <= 1;
      var atBottom = viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 1;
      btnUp.classList.toggle('is-hidden', atTop);
      btnDown.classList.toggle('is-hidden', atBottom);
    }

    var pageSize = function() { return viewport.clientHeight * 0.6; };

    btnDown.addEventListener('click', function(e) {
      e.stopPropagation();
      smoothScroll(viewport, pageSize(), 600);
    });

    btnUp.addEventListener('click', function(e) {
      e.stopPropagation();
      smoothScroll(viewport, -pageSize(), 600);
    });

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

    return layer;
  }

  function buildDots(count) {
    var wrap = el('div', 'swipe-dots');
    for (var i = 0; i < count; i++) {
      var dot = el('span', i === 0 ? 'swipe-dot is-active' : 'swipe-dot');
      wrap.appendChild(dot);
    }
    return wrap;
  }

  function buildFrame(article, postDate) {
    var frame = el('div', 'swipe-frame');
    frame.dataset.articleId = article.id;
    frame.dataset.postDate = postDate;
    if (article.pageUrl) frame.dataset.pageUrl = article.pageUrl;

    var img = article.image && !article.image.endsWith(PLACEHOLDER_SUFFIX) ? article.image : fallbackBg(article.id);

    var layers = el('div', 'swipe-layers');
    layers.appendChild(buildCardLayer(article, img));

    var optionals = [
      buildSummaryLayer(article, img),
      buildTextLayer('Deep Dive', article.deepDive, 'swipe-layer-deep', img),
      buildTextLayer('Decoder', article.decoder, 'swipe-layer-decoder', img),
      buildTextLayer('Original Article', article.original, 'swipe-layer-original', img)
    ];
    optionals.forEach(l => { if (l) layers.appendChild(l); });

    frame.appendChild(layers);

    if (layers.children.length > 1) {
      var dots = buildDots(layers.children.length);
      frame.appendChild(dots);
      layers.addEventListener('scroll', () => {
        var idx = Math.round(layers.scrollLeft / layers.clientWidth);
        dots.querySelectorAll('.swipe-dot').forEach((d, i) => d.classList.toggle('is-active', i === idx));
      });
    }

    return frame;
  }

  // --- Completion frame ---

  var ICON_CHECK_CIRCLE = [{t:'circle',cx:'12',cy:'12',r:'10'},{d:'m9 12 2 2 4-4'}];
  var ICON_ARROW_RIGHT = [{d:'M5 12h14'},{d:'m12 5 7 7-7 7'}];

  function buildCompletionFrame(total, postDate, meta) {
    var frame = el('div', 'swipe-frame swipe-frame-completion');

    var bg = el('div', 'swipe-completion-bg');
    frame.appendChild(bg);

    var content = el('div', 'swipe-completion-content');

    var icon = el('div', 'swipe-completion-icon');
    icon.appendChild(svg(48, 48, ICON_CHECK_CIRCLE));
    content.appendChild(icon);

    content.appendChild(text('h2', 'swipe-completion-title', 'Digest devoured!'));
    content.appendChild(text('p', 'swipe-completion-subtitle', formatDate(postDate)));
    content.appendChild(text('p', 'swipe-completion-stats', total + ' articles'));

    if (meta.nextUrl) {
      var nextBtn = el('a', 'swipe-completion-next');
      nextBtn.href = meta.nextUrl + '#swipe';
      nextBtn.appendChild(document.createTextNode('Next: ' + meta.nextTitle + ' '));
      nextBtn.appendChild(svg(16, 16, ICON_ARROW_RIGHT));
      content.appendChild(nextBtn);
    }

    var exitBtn = el('button', 'swipe-completion-exit');
    exitBtn.textContent = 'Back to article';
    exitBtn.addEventListener('click', exit);
    content.appendChild(exitBtn);

    frame.appendChild(content);
    return frame;
  }

  // --- Top bar ---

  function formatDate(dateStr) {
    var parts = dateStr.split('-');
    var d = new Date(+parts[0], +parts[1] - 1, +parts[2]);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function updateShareButton(shareBtn, track) {
    var frames = track.querySelectorAll('.swipe-frame:not(.swipe-frame-completion)');
    var idx = 0;
    for (var i = 0; i < frames.length; i++) {
      if (frames[i].offsetTop <= track.scrollTop + track.clientHeight / 2) idx = i;
    }
    var frame = frames[idx];
    if (!frame) return;
    if (frame.dataset.pageUrl) {
      shareBtn.dataset.shareUrl = frame.dataset.pageUrl;
      delete shareBtn.dataset.shareArticle;
    } else {
      shareBtn.dataset.shareArticle = frame.dataset.articleId;
      delete shareBtn.dataset.shareUrl;
    }
    shareBtn.title = (frame.querySelector('.swipe-card-title') || {}).textContent || '';
  }

  function buildTopBar(total, postDate) {
    var bar = el('div', 'swipe-topbar');

    var close = el('button', 'swipe-close-btn');
    close.appendChild(svg(20, 20, ICON_CHEVRON_LEFT));
    close.setAttribute('aria-label', 'Exit swipe mode');
    bar.appendChild(close);

    var progress = el('div', 'swipe-progress');
    var dateLabel = text('span', 'swipe-progress-date', formatDate(postDate));
    progress.appendChild(dateLabel);
    var progressBar = el('div', 'swipe-progress-bar');
    var fill = el('div', 'swipe-progress-fill');
    progressBar.appendChild(fill);
    progress.appendChild(progressBar);
    progress.appendChild(text('span', 'swipe-progress-text', '1 / ' + total));
    bar.appendChild(progress);

    var share = el('button', 'swipe-share-btn digest-share-btn');
    share.appendChild(svg(18, 18, ICON_SHARE));
    share.setAttribute('aria-label', 'Share article');
    bar.appendChild(share);

    return { el: bar, close: close, fill: fill, text: progress.querySelector('.swipe-progress-text'), date: dateLabel, share: share };
  }

  // --- Overlay ---

  var overlay = null;
  var savedScrollY = 0;

  function enter() {
    if (overlay) return;

    var articles = extractArticles(document).filter(a => a.priority >= 1 && a.priority <= 4);
    if (!articles.length) return;
    var meta = extractPostMeta(document);

    savedScrollY = window.scrollY;
    document.body.classList.add('swipe-active');
    document.body.style.top = -savedScrollY + 'px';

    overlay = el('div', 'swipe-overlay');
    var topBar = buildTopBar(articles.length, meta.date);
    overlay.appendChild(topBar.el);

    var track = el('div', 'swipe-track');
    articles.forEach(a => track.appendChild(buildFrame(a, meta.date)));
    track.appendChild(buildCompletionFrame(articles.length, meta.date, meta));
    overlay.appendChild(track);

    document.body.appendChild(overlay);

    var allFrames = track.querySelectorAll('.swipe-frame');

    var startIdx = 0;
    for (var i = 0; i < articles.length; i++) {
      var evt = new CustomEvent('digest-is-article-read', { detail: { date: meta.date, articleId: articles[i].id, result: false } });
      document.dispatchEvent(evt);
      if (!evt.detail.result) { startIdx = i; break; }
    }
    if (startIdx > 0) {
      allFrames[startIdx].scrollIntoView();
    }

    requestAnimationFrame(() => overlay.classList.add('is-visible'));
    var obs = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        var idx = Array.from(allFrames).indexOf(entry.target);
        if (idx < 0) return;

        if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
          var n = Math.min(idx + 1, articles.length);
          topBar.text.textContent = n + ' / ' + articles.length;
          topBar.fill.style.width = (n / articles.length * 100) + '%';

          if (entry.target.classList.contains('swipe-frame-completion')) {
            document.dispatchEvent(new CustomEvent('digest-mark-read', { detail: { date: meta.date } }));
          }
        }

        if (!entry.isIntersecting && entry.boundingClientRect.top < 0) {
          var aid = entry.target.dataset.articleId;
          if (aid) {
            document.dispatchEvent(new CustomEvent('digest-mark-article-read', { detail: { date: meta.date, articleId: aid } }));
          }
        }
      });
    }, { root: track, threshold: [0, 0.5] });
    allFrames.forEach(f => obs.observe(f));

    updateShareButton(topBar.share, track);
    track.addEventListener('scroll', function() { updateShareButton(topBar.share, track); });

    topBar.close.addEventListener('click', exit);
    document.addEventListener('keydown', onKeydown);
    overlay._obs = obs;
  }

  function onKeydown(e) {
    if (e.key === 'Escape') return exit();
    if (!overlay) return;
    var track = overlay.querySelector('.swipe-track');
    if (!track) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      var frames = track.querySelectorAll('.swipe-frame');
      var idx = 0;
      for (var i = 0; i < frames.length; i++) {
        if (frames[i].offsetTop <= track.scrollTop + track.clientHeight / 2) idx = i;
      }
      var next = e.key === 'ArrowDown' ? Math.min(idx + 1, frames.length - 1) : Math.max(idx - 1, 0);
      frames[next].scrollIntoView({ behavior: 'smooth' });
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      var frames = track.querySelectorAll('.swipe-frame');
      var idx = 0;
      for (var i = 0; i < frames.length; i++) {
        if (frames[i].offsetTop <= track.scrollTop + track.clientHeight / 2) idx = i;
      }
      var layers = frames[idx].querySelector('.swipe-layers');
      if (!layers) return;
      var layerIdx = Math.round(layers.scrollLeft / layers.clientWidth);
      var target = e.key === 'ArrowRight' ? layerIdx + 1 : layerIdx - 1;
      if (target >= 0 && target < layers.children.length) {
        layers.children[target].scrollIntoView({ behavior: 'smooth', inline: 'start' });
      }
    }
  }

  function closeOverlay() {
    if (!overlay) return;
    var el = overlay;
    overlay = null;
    if (el._obs) el._obs.disconnect();
    document.removeEventListener('keydown', onKeydown);
    el.classList.remove('is-visible');
    var cleaned = false;
    function cleanup() {
      if (cleaned) return;
      cleaned = true;
      el.remove();
      document.body.classList.remove('swipe-active');
      document.body.style.top = '';
      window.scrollTo(0, savedScrollY);
    }
    el.addEventListener('transitionend', cleanup);
    setTimeout(cleanup, 400);
  }

  function exit() {
    closeOverlay();
    if (window.location.hash === '#swipe') history.replaceState(null, '', window.location.pathname);
  }

  // --- Entry points ---

  function waitForReady(cb) {
    var container = document.querySelector('.digest-articles');
    if (!container) return;
    if (container.dataset.ready !== undefined) return cb();
    new MutationObserver((_, obs) => {
      if (container.dataset.ready !== undefined) { obs.disconnect(); cb(); }
    }).observe(container, { attributes: true, attributeFilter: ['data-ready'] });
  }

  function showLoading() {
    var loader = el('div', 'swipe-loading');
    var spinner = el('div', 'swipe-loading-spinner');
    loader.appendChild(spinner);
    loader.appendChild(text('p', 'swipe-loading-text', 'Loading articles...'));
    document.body.appendChild(loader);
    return loader;
  }

  var btn = document.querySelector('.swipe-cta-btn');
  if (btn) btn.addEventListener('click', function() {
    var container = document.querySelector('.digest-articles');
    if (container && container.dataset.ready === undefined) {
      var loader = showLoading();
      waitForReady(function() { loader.remove(); enter(); });
    } else {
      waitForReady(enter);
    }
  });

  if (window.location.hash === '#swipe') {
    history.replaceState(null, '', window.location.pathname);
    var container = document.querySelector('.digest-articles');
    if (container && container.dataset.ready === undefined) {
      var loader = showLoading();
      waitForReady(function() { loader.remove(); enter(); });
    } else {
      waitForReady(enter);
    }
  }
});
