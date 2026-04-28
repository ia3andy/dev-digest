document.addEventListener('DOMContentLoaded', () => {
  const container = document.querySelector('.digest-articles');
  if (!container) return;

  const priorities = window.DEFAULT_TAG_PRIORITIES || {};
  const defaultPriority = priorities['default'] || 3;

  function resolvePriority(tags) {
    let best = defaultPriority;
    for (const tag of tags) {
      const p = priorities[tag];
      if (p !== undefined && p < best) best = p;
    }
    return best;
  }

  const articles = Array.from(container.querySelectorAll('.digest-article'));
  const grouped = { 1: [], 2: [], 3: [], 4: [], 5: [] };

  for (const el of articles) {
    const tags = (el.dataset.tags || '').split(',').map(t => t.trim()).filter(Boolean);
    const priority = resolvePriority(tags);
    el.dataset.priority = priority;
    grouped[priority] = grouped[priority] || [];
    grouped[priority].push(el);
  }

  for (const el of articles) el.remove();

  for (const p of [1, 2]) {
    for (const el of grouped[p]) {
      if (p >= 2) {
        const details = el.querySelector('.digest-summary-details');
        if (details) details.removeAttribute('open');
      }
      container.appendChild(el);
    }
  }

  const otherNews = [...grouped[3], ...grouped[4]];
  if (otherNews.length > 0) {
    const card = document.createElement('div');
    card.className = 'digest-quick-links';

    const heading = document.createElement('h3');
    heading.className = 'digest-quick-links-title';
    heading.textContent = 'Other news';
    card.appendChild(heading);

    for (const el of otherNews) {
      const title = el.querySelector('.digest-article-title')?.textContent || '';
      const oneLiner = el.querySelector('.digest-one-liner')?.textContent || '';
      const badge = el.querySelector('.digest-badge')?.textContent || '';
      const tags = (el.dataset.tags || '').split(',').map(t => t.trim()).filter(Boolean);
      const tagsHtml = tags.map(t => '<span class="digest-quick-link-tag">' + t.replace(/</g, '&lt;') + '</span>').join('');

      const details = document.createElement('details');
      details.className = 'digest-quick-link-item';

      const summary = document.createElement('summary');
      summary.innerHTML = '<span class="digest-deep-icon"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></span>' +
        '<span class="digest-quick-link-text">' +
        '<span class="digest-quick-link-header"><span class="digest-quick-link-title">' + title.replace(/</g, '&lt;') + '</span>' +
        '<span class="digest-badge">' + badge.replace(/</g, '&lt;') + '</span></span>' +
        '<span class="digest-quick-link-meta"><span class="digest-quick-link-desc">' + oneLiner.replace(/</g, '&lt;') + '</span>' +
        '<span class="digest-quick-link-tags">' + tagsHtml + '</span></span></span>';
      details.appendChild(summary);

      el.classList.add('digest-quick-link-expanded');
      details.appendChild(el);

      card.appendChild(details);
    }
    container.appendChild(card);
  }

  container.dataset.ready = '';
});
