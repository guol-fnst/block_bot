/* Block Bot - Zhihu page tweaks
 * Runs only on zhihu.com.
 */
(() => {
  'use strict';

  if (!/(^|\.)zhihu\.com$/i.test(location.hostname)) return;

  const style = document.createElement('style');
  style.id = 'block-bot-hide-zhihu-logo';
  style.textContent = `
    .AppHeader-logo,
    .ZhihuLogo,
    .AppHeader a[href="/"],
    .AppHeader a[href="//www.zhihu.com"],
    .AppHeader a[href="https://www.zhihu.com"],
    .AppHeader a[href="https://www.zhihu.com/"],
    header a[href="/"],
    header a[href="//www.zhihu.com"],
    header a[href="https://www.zhihu.com"],
    header a[href="https://www.zhihu.com/"],
    a[aria-label="知乎"],
    a[href="//www.zhihu.com"] .ZhihuLogo,
    a[href="https://www.zhihu.com"] .ZhihuLogo,
    a[href="https://www.zhihu.com/"] .ZhihuLogo {
      display: none !important;
    }
  `;

  (document.documentElement || document.head).appendChild(style);

  function hideLogoLinks() {
    const links = document.querySelectorAll('header a, .AppHeader a');
    links.forEach(link => {
      const href = link.getAttribute('href') || '';
      const label = link.getAttribute('aria-label') || '';
      const text = (link.textContent || '').replace(/\s+/g, '');
      const hasLogoSvg = Boolean(link.querySelector('.ZhihuLogo, .Zi--Logo, svg[aria-label="知乎"]'));
      const isHomeHref = href === '/' || href === '//www.zhihu.com' || href === 'https://www.zhihu.com' || href === 'https://www.zhihu.com/';
      if (label === '知乎' || hasLogoSvg || (isHomeHref && text === '知乎')) {
        link.style.setProperty('display', 'none', 'important');
      }
    });
  }

  hideLogoLinks();
  new MutationObserver(hideLogoLinks).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
})();
