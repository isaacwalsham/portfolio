(function () {
  const root = document.documentElement;
  const THEME_KEY = 'theme';
  const storedTheme = localStorage.getItem(THEME_KEY);
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

  const initialTheme = storedTheme || (prefersDark ? 'dark' : 'light');
  root.setAttribute('data-theme', initialTheme);

  const themeBtn = document.querySelector('.theme-toggle');

  const setThemeIcon = () => {
    if (!themeBtn) return;
    const isDark = root.getAttribute('data-theme') === 'dark';
    themeBtn.textContent = isDark ? '☀️' : '🌙';
    themeBtn.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
  };

  const applyTheme = (theme, persist = true) => {
    root.setAttribute('data-theme', theme);
    if (persist) localStorage.setItem(THEME_KEY, theme);
    setThemeIcon();
  };

  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const current = root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
      const next = current === 'dark' ? 'light' : 'dark';
      applyTheme(next);
    });
  }

  if (!storedTheme && window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e) => applyTheme(e.matches ? 'dark' : 'light', false);
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
    else if (typeof mq.addListener === 'function') mq.addListener(onChange);
  }

  setThemeIcon();

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  const toggleBtn = $('.toggle-btn');
  let nav = $('#primary-nav') || $('.nav-links');
  if (toggleBtn && nav) {
    if (!nav.id) nav.id = 'primary-nav';
    toggleBtn.setAttribute('aria-controls', nav.id);
    toggleBtn.setAttribute('aria-expanded', 'false');

    let backdrop = document.querySelector('.nav-backdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.className = 'nav-backdrop';
      document.body.appendChild(backdrop);
    }

    const setExpanded = (val) => toggleBtn.setAttribute('aria-expanded', String(val));
    const openMenu = () => {
      nav.classList.add('open');
      setExpanded(true);
      document.body.classList.add('nav-open');
      const bd = document.querySelector('.nav-backdrop');
      if (bd) bd.classList.add('show');
    };
    const closeMenu = () => {
      nav.classList.remove('open');
      setExpanded(false);
      document.body.classList.remove('nav-open');
      const bd = document.querySelector('.nav-backdrop');
      if (bd) bd.classList.remove('show');
    };
    const toggleMenu = () => (nav.classList.contains('open') ? closeMenu() : openMenu());

    toggleBtn.addEventListener('click', toggleMenu);

    nav.addEventListener('click', (e) => {
      const link = e.target && e.target.closest('a[href]');
      if (!link) return;
      closeMenu();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeMenu();
    });

    document.addEventListener('click', (e) => {
      if (!nav.classList.contains('open')) return;
      const onBackdrop = e.target.closest('.nav-backdrop');
      const insideNav = e.target.closest('.nav-links');
      const onToggle = e.target.closest('.toggle-btn');
      if (onBackdrop || (!insideNav && !onToggle)) closeMenu();
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth > 768) closeMenu();
    });
  }

  const yearEl = $('#year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const bars = $$('.bar');
  if (bars.length) {
    const onReveal = (entry, obs) => {
      const bar = entry.target;
      if (entry.isIntersecting) {
        const fill = $('.fill', bar);
        if (fill) {
          const target = fill.getAttribute('style')?.match(/width:\s*([^;]+)/)?.[1] || '80%';
          bar.style.setProperty('--target', target);
          bar.classList.add('revealed');
          obs.unobserve(bar);
        }
      }
    };

    if (prefersReduced) {
      bars.forEach((bar) => {
        const fill = $('.fill', bar);
        const target = fill?.getAttribute('style')?.match(/width:\s*([^;]+)/)?.[1] || '80%';
        bar.style.setProperty('--target', target);
        bar.classList.add('revealed');
      });
    } else {
      const barObserver = new IntersectionObserver((entries, obs) => entries.forEach((e) => onReveal(e, obs)), {
        threshold: 0.35,
      });
      bars.forEach((b) => barObserver.observe(b));
    }
  }

  const counters = $$('[data-counter] [data-count]');
  if (counters.length) {
    const animateCount = (el) => {
      const end = parseInt(el.getAttribute('data-count') || '0', 10);
      const isPlus = /\+$/.test(el.textContent || '');
      const duration = 1200;
      if (prefersReduced || end === 0) {
        el.textContent = isPlus ? `${end}+` : String(end);
        return;
      }
      const start = 0;
      const startTime = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - startTime) / duration);
        const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
        const val = Math.round(start + (end - start) * eased);
        el.textContent = isPlus ? `${val}+` : String(val);
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };

    const revealCounters = (entries, obs) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const group = entry.target;
          $$('[data-count]', group).forEach(animateCount);
          obs.unobserve(group);
        }
      });
    };

    if (prefersReduced) {
      counters.forEach((el) => {
        const end = parseInt(el.getAttribute('data-count') || '0', 10);
        const isPlus = /\+$/.test(el.textContent || '');
        el.textContent = isPlus ? `${end}+` : String(end);
      });
    } else {
      const group = $('[data-counter]');
      if (group) {
        const counterObserver = new IntersectionObserver(revealCounters, { threshold: 0.2 });
        counterObserver.observe(group);
      }
    }
  }

  if (window.AOS && typeof window.AOS.init === 'function') {
    try {
      window.AOS.init({
        disable: () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      });
    } catch {}
  }

  (() => {
    const nav = document.querySelector('#primary-nav') || document.querySelector('.nav-links');
    if (!nav) return;
    const links = Array.from(nav.querySelectorAll('a[href]'));
    if (!links.length) return;

    const path = window.location.pathname;
    let current = path.split('/').filter(Boolean).pop() || 'index.html';

    const normalize = (href) => {
      try {
        const url = new URL(href, window.location.origin);
        let name = url.pathname.split('/').filter(Boolean).pop() || 'index.html';
        if (!name.includes('.')) name += '.html';
        return name.toLowerCase();
      } catch {
        return '';
      }
    };

    links.forEach((a) => {
      a.classList.remove('active');
      a.removeAttribute('aria-current');
    });
    const match = links.find((a) => normalize(a.getAttribute('href')) === current.toLowerCase());
    if (match) {
      match.classList.add('active');
      match.setAttribute('aria-current', 'page');
    }
  })();
})();