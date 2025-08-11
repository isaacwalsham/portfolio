(function () {
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  // ---- Theme toggle / persistence ----
  const root = document.documentElement;
  const storedTheme = localStorage.getItem('theme');
  if (storedTheme === 'light' || storedTheme === 'dark') {
    if (storedTheme === 'light') root.setAttribute('data-theme', 'light');
    else root.removeAttribute('data-theme');
  }

  const applyIcon = () => {
    const btn = $('.theme-toggle');
    if (!btn) return;
    const isLight = root.getAttribute('data-theme') === 'light';
    btn.textContent = isLight ? '🌙' : '☀️';
    btn.setAttribute('aria-label', isLight ? 'Switch to dark mode' : 'Switch to light mode');
  };
  applyIcon();

  const toggleTheme = () => {
    const isLight = root.getAttribute('data-theme') === 'light';
    if (isLight) { root.removeAttribute('data-theme'); localStorage.setItem('theme', 'dark'); }
    else { root.setAttribute('data-theme', 'light'); localStorage.setItem('theme', 'light'); }
    applyIcon();
  };

  document.addEventListener('click', (e) => {
    const t = e.target;
    if (t && t.classList && t.classList.contains('theme-toggle')) toggleTheme();
  });

  // ---- Mobile nav toggle ----
  const toggleBtn = $('.toggle-btn');
  const nav = $('#primary-nav');
  if (toggleBtn && nav) {
    const setExpanded = (val) => toggleBtn.setAttribute('aria-expanded', String(val));

    toggleBtn.addEventListener('click', () => {
      const isOpen = nav.classList.toggle('open');
      setExpanded(isOpen);
    });

    $$('.nav-links a', nav).forEach((a) =>
      a.addEventListener('click', () => {
        if (nav.classList.contains('open')) {
          nav.classList.remove('open');
          setExpanded(false);
        }
      })
    );
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
          const target = fill.getAttribute('style')?.match(/width:\\s*([^;]+)/)?.[1] || '80%';
          bar.style.setProperty('--target', target);
          bar.classList.add('revealed');
          obs.unobserve(bar);
        }
      }
    };

    if (prefersReduced) {
      bars.forEach((bar) => {
        const fill = $('.fill', bar);
        const target = fill?.getAttribute('style')?.match(/width:\\s*([^;]+)/)?.[1] || '80%';
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
      const isPlus = /\\+$/.test(el.textContent || '');
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
        const isPlus = /\\+$/.test(el.textContent || '');
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
})();