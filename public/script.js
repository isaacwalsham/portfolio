(function () {
  // ---- Theme toggle / persistence ----
  const root = document.documentElement;
  const storedTheme = localStorage.getItem('theme');
  if (storedTheme === 'light') root.setAttribute('data-theme', 'light');
  else if (storedTheme === 'dark') root.removeAttribute('data-theme');

  const themeBtn = document.querySelector('.theme-toggle');

  const setThemeIcon = () => {
    if (!themeBtn) return;
    const isLight = root.getAttribute('data-theme') === 'light';
    themeBtn.textContent = isLight ? '☀️' : '🌙'; // show current mode (sun in light, moon in dark)
    themeBtn.setAttribute('aria-label', isLight ? 'Switch to dark mode' : 'Switch to light mode');
  };
  setThemeIcon();

  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const isLight = root.getAttribute('data-theme') === 'light';
      if (isLight) {
        root.removeAttribute('data-theme');          // go to dark
        localStorage.setItem('theme', 'dark');
      } else {
        root.setAttribute('data-theme', 'light');     // go to light
        localStorage.setItem('theme', 'light');
      }
      setThemeIcon();
    });
  }

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

    // Toggle on button click
    toggleBtn.addEventListener('click', toggleMenu);

    // Close when tapping a link inside the menu and navigate
    nav.addEventListener('click', (e) => {
      const link = e.target && e.target.closest('a[href]');
      if (!link) return;
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
      window.location.href = link.href;
    });

    // Close on ESC
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeMenu();
    });

    // Close when clicking outside the menu/burger
    document.addEventListener('click', (e) => {
      if (!nav.classList.contains('open')) return;
      const insideNav = e.target.closest('.nav-links');
      const onToggle = e.target.closest('.toggle-btn');
      if (!insideNav && !onToggle) closeMenu();
    });

    document.addEventListener('click', (e) => {
      const bd = e.target.closest('.nav-backdrop');
      if (bd) closeMenu();
    });

    // Close when resizing above mobile breakpoint
    window.addEventListener('resize', () => {
      if (window.innerWidth > 768) closeMenu();
    });
  }

  // ---- Footer year ----
  const yearEl = $('#year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- Skill bars reveal ----
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

  // ---- Stats counter animation ----
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

  // ---- AOS init ----
  if (window.AOS && typeof window.AOS.init === 'function') {
    try { window.AOS.init(); } catch {}
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

    links.forEach((a) => a.classList.remove('active'));
    const match = links.find((a) => normalize(a.getAttribute('href')) === current.toLowerCase());
    if (match) match.classList.add('active');
  })();
})();