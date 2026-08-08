/* Readability-lite article extraction.

   A deliberately small, dependency-free extractor: find the subtree that carries the
   article's paragraphs, then serialise it back to plain text with headings and list
   markers preserved. It doesn't need to be perfect — the model tolerates some
   leftover chrome far better than it tolerates a missing article body. */

(() => {
  if (window.__distillerExtract) return;

  const STRIP = 'script,style,noscript,iframe,svg,canvas,form,button,input,select,textarea,nav,aside,footer,header,figure figcaption,video,audio,template';
  const JUNK_RE = /(^|[\s_-])(ad|ads|advert|promo|banner|cookie|consent|newsletter|subscribe|signup|paywall|share|social|related|recommend|comment|disqus|sidebar|breadcrumb|nav|menu|toolbar|masthead|footer|header|popup|modal|skip|hidden|byline-share)([\s_-]|$)/i;
  const BLOCK_SEL = 'p, pre, blockquote, li, h1, h2, h3, h4, dd, dt';

  const textOf = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();

  function looksLikeJunk(el) {
    const id = el.getAttribute?.('id') || '';
    const cls = typeof el.className === 'string' ? el.className : '';
    const role = el.getAttribute?.('role') || '';
    if (role === 'navigation' || role === 'banner' || role === 'complementary') return true;
    return JUNK_RE.test(`${id} ${cls}`);
  }

  function prune(root) {
    root.querySelectorAll(STRIP).forEach((el) => el.remove());
    root.querySelectorAll('[aria-hidden="true"], [hidden]').forEach((el) => el.remove());
    root.querySelectorAll('div,section,ul,ol,span,aside').forEach((el) => {
      if (looksLikeJunk(el) && textOf(el).length < 1200) el.remove();
    });
    return root;
  }

  /* Score every block's ancestors; the winner is the node whose descendants hold the
     most substantial prose. Long paragraphs count for more than many short ones,
     which is what separates an article body from a list of links. */
  function findArticleRoot(doc) {
    const semantic = doc.querySelector('article, [itemprop~="articleBody"], [role="main"] article');
    if (semantic && textOf(semantic).length > 500) return semantic;

    const scores = new Map();
    for (const block of doc.querySelectorAll(BLOCK_SEL)) {
      const len = textOf(block).length;
      if (len < 30) continue;
      const linkDensity = linkDensityOf(block);
      if (linkDensity > 0.5) continue;

      const points = 1 + Math.min(len / 100, 4) + Math.min((textOf(block).match(/[,.;:]/g) || []).length / 4, 3);
      let node = block.parentElement;
      let depth = 0;
      while (node && depth < 4) {
        scores.set(node, (scores.get(node) || 0) + points / (depth + 1));
        node = node.parentElement;
        depth += 1;
      }
    }

    let best = null;
    let bestScore = 0;
    for (const [node, score] of scores) {
      const adjusted = score * (1 - linkDensityOf(node));
      if (adjusted > bestScore) { best = node; bestScore = adjusted; }
    }
    return best || doc.querySelector('main') || doc.body;
  }

  function linkDensityOf(el) {
    const total = textOf(el).length;
    if (!total) return 0;
    let linked = 0;
    el.querySelectorAll('a').forEach((a) => { linked += textOf(a).length; });
    return linked / total;
  }

  /* Walk in document order so the model receives the article's real sequence. */
  function serialise(root) {
    const out = [];
    const seen = new Set();

    root.querySelectorAll(BLOCK_SEL).forEach((el) => {
      // Skip a block already covered by an ancestor we emitted (nested lists, etc.)
      for (let anc = el.parentElement; anc && anc !== root; anc = anc.parentElement) {
        if (seen.has(anc)) return;
      }

      const txt = textOf(el);
      if (!txt || txt.length < 2) return;

      const tag = el.tagName.toLowerCase();
      if (/^h[1-4]$/.test(tag)) {
        if (txt.length > 200) return;
        out.push(`\n## ${txt}\n`);
      } else if (tag === 'li' || tag === 'dd' || tag === 'dt') {
        if (txt.length < 15) return;
        out.push(`- ${txt}`);
      } else if (tag === 'blockquote') {
        out.push(`> ${txt}`);
      } else {
        if (txt.length < 25) return;
        out.push(txt);
      }
      seen.add(el);
    });

    return out.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function metaContent(...selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      const v = el?.getAttribute('content') || el?.textContent;
      if (v && v.trim()) return v.trim();
    }
    return '';
  }

  function extractArticle() {
    const selection = (window.getSelection?.().toString() || '').trim();

    const title = metaContent('meta[property="og:title"]', 'meta[name="twitter:title"]')
      || document.querySelector('article h1, h1')?.textContent?.trim()
      || document.title
      || '';

    const byline = metaContent('meta[name="author"]', 'meta[property="article:author"]', '[rel="author"]', '.byline');
    const siteName = metaContent('meta[property="og:site_name"]') || location.hostname.replace(/^www\./, '');

    let text;
    let source;
    if (selection.length > 400) {
      // An explicit selection is a stronger signal than any heuristic.
      text = selection;
      source = 'selection';
    } else {
      const clone = document.body.cloneNode(true);
      prune(clone);
      const root = findArticleRoot(clone);
      text = serialise(root);
      source = 'article';

      if (text.length < 400) {
        const fallback = (document.body.innerText || '').replace(/\n{3,}/g, '\n\n').trim();
        if (fallback.length > text.length) { text = fallback; source = 'fallback'; }
      }
    }

    return {
      title: title.replace(/\s+/g, ' ').trim(),
      byline: byline.replace(/\s+/g, ' ').trim().slice(0, 120),
      siteName,
      url: location.href,
      text,
      source,
      wordCount: text ? text.split(/\s+/).length : 0,
    };
  }

  window.__distillerExtract = extractArticle;
})();
