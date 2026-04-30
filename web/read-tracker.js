document.addEventListener('DOMContentLoaded', () => {

  const READ_KEY = 'digest-read-posts';
  const readState = JSON.parse(localStorage.getItem(READ_KEY) || '{}');

  function isPostRead(date) {
    const val = readState[date];
    if (val === true) return true;
    if (val === false) return false;
    if (typeof val === 'object') return false;
    return !!(readState.readBefore && date <= readState.readBefore);
  }

  function isArticleRead(date, articleId) {
    const val = readState[date];
    if (val === true) return true;
    if (typeof val === 'object' && val[articleId] === true) return true;
    if (val === false || typeof val === 'object') return false;
    return !!(readState.readBefore && date <= readState.readBefore);
  }

  function saveReadState() {
    localStorage.setItem(READ_KEY, JSON.stringify(readState));
  }

  function markAllRead(date) {
    readState.readBefore = date;
    for (const key of Object.keys(readState)) {
      if (key !== 'readBefore' && key <= date) delete readState[key];
    }
    saveReadState();
    updateReadUI();
  }

  function markArticleRead(date, articleId) {
    let val = readState[date];
    if (val === true) return;
    if (typeof val !== 'object') val = {};
    val[articleId] = true;
    readState[date] = val;
    markAllArticlesBefore(date, articleId);
    saveReadState();
    checkAutoPromote(date);
    updateReadUI();
  }

  function markAllArticlesBefore(date, articleId) {
    const articlePage = document.querySelector('.article-page[data-post-date="' + date + '"]');
    if (!articlePage) return;
    let val = readState[date];
    if (val === true) return;
    if (typeof val !== 'object') val = {};
    const articles = articlePage.querySelectorAll('.digest-article[data-article-id]:not([data-priority="5"])');
    for (const el of articles) {
      const id = el.dataset.articleId;
      if (id === articleId) break;
      val[id] = true;
    }
    readState[date] = val;
  }

  function checkAutoPromote(date) {
    const articlePage = document.querySelector('.article-page[data-post-date="' + date + '"]');
    if (!articlePage) return;
    const articles = articlePage.querySelectorAll('.digest-article[data-article-id]:not([data-priority="5"])');
    if (articles.length === 0) return;
    const allRead = Array.from(articles).every(el => isArticleRead(date, el.dataset.articleId));
    if (allRead) {
      readState[date] = true;
      saveReadState();
    }
  }



  function updateReadUI() {
    for (const el of document.querySelectorAll('[data-post-date]')) {
      const date = el.dataset.postDate;
      const read = isPostRead(date);
      el.classList.toggle('is-read', read);
      for (const btn of el.querySelectorAll('.digest-btn-mark-read')) {
        btn.classList.toggle('is-active', read);
      }
    }
    updateArticleReadUI();
  }

  function updateArticleReadUI() {
    const articlePage = document.querySelector('.article-page[data-post-date]');
    if (!articlePage) return;
    const date = articlePage.dataset.postDate;
    for (const el of articlePage.querySelectorAll('.digest-article[data-article-id]')) {
      el.classList.toggle('is-article-read', isArticleRead(date, el.dataset.articleId));
    }
  }

  // Per-article scroll tracking on detail pages
  const articlePage = document.querySelector('.article-page[data-post-date]');
  const activeObservers = [];

  function setupArticleObservers() {
    for (const obs of activeObservers) obs.disconnect();
    activeObservers.length = 0;

    if (!articlePage) return;
    const date = articlePage.dataset.postDate;
    if (isPostRead(date)) return;

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting && entry.boundingClientRect.top < 0) {
          const articleId = entry.target.dataset.articleId;
          if (articleId && !isArticleRead(date, articleId)) {
            markArticleRead(date, articleId);
          }
          observer.unobserve(entry.target);
        }
      }
    }, { threshold: 0 });
    activeObservers.push(observer);

    const mainArticles = [];
    for (const el of articlePage.querySelectorAll('.digest-article[data-article-id]:not([data-priority="5"])')) {
      if (!el.closest('.digest-quick-links') && !isArticleRead(date, el.dataset.articleId)) {
        mainArticles.push(el);
        observer.observe(el);
      }
    }

    const footer = articlePage.querySelector('.page-footer');
    if (footer) {
      let footerReady = false;
      requestAnimationFrame(() => { footerReady = true; });
      const footerObs = new IntersectionObserver((entries) => {
        if (!footerReady) return;
        for (const entry of entries) {
          if (entry.isIntersecting) {
            for (const el of articlePage.querySelectorAll('.digest-article[data-article-id]:not([data-priority="5"])')) {
              const id = el.dataset.articleId;
              if (!isArticleRead(date, id)) markArticleRead(date, id);
            }
            footerObs.disconnect();
          }
        }
      }, { threshold: 0 });
      activeObservers.push(footerObs);
      footerObs.observe(footer);
    }

    const quickLinks = articlePage.querySelector('.digest-quick-links');
    if (quickLinks && mainArticles.length > 0) {
      const lastMain = mainArticles[mainArticles.length - 1];
      const lastId = lastMain.dataset.articleId;
      const qlObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting && entry.boundingClientRect.top < 0) {
            if (entry.target.dataset.articleId === lastId) {
              let val = readState[date];
              if (val === true) return;
              if (typeof val !== 'object') val = {};
              for (const el of quickLinks.querySelectorAll('.digest-article[data-article-id]')) {
                val[el.dataset.articleId] = true;
              }
              readState[date] = val;
              saveReadState();
              checkAutoPromote(date);
              updateReadUI();
              qlObserver.disconnect();
            }
          }
        }
      }, { threshold: 0 });
      activeObservers.push(qlObserver);
      qlObserver.observe(lastMain);
    }
  }

  function toggleRead(date) {
    if (isPostRead(date)) {
      readState[date] = false;
    } else {
      readState[date] = true;
    }
    saveReadState();
    updateReadUI();
    setupArticleObservers();
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.digest-btn-mark-read, .digest-btn-mark-all-read');
    if (!btn) return;
    const container = btn.closest('[data-post-date]');
    if (!container) return;
    const date = container.dataset.postDate;
    if (btn.classList.contains('digest-btn-devour-again')) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      const onScrollEnd = () => {
        toggleRead(date);
        window.removeEventListener('scrollend', onScrollEnd);
      };
      window.addEventListener('scrollend', onScrollEnd);
    } else if (btn.classList.contains('digest-btn-mark-all-read')) {
      markAllRead(date);
    } else {
      toggleRead(date);
    }
  });

  if (articlePage) {
    const digestContainer = document.querySelector('.digest-articles');
    if (digestContainer) {
      if (digestContainer.dataset.ready !== undefined) {
        setupArticleObservers();
      } else {
        new MutationObserver((mutations, obs) => {
          if (digestContainer.dataset.ready !== undefined) {
            obs.disconnect();
            setupArticleObservers();
          }
        }).observe(digestContainer, { attributes: true, attributeFilter: ['data-ready'] });
      }
    }
  }

  updateReadUI();
});
