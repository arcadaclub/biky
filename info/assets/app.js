(() => {
  const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;

  const yearEl = document.getElementById('year');
  if (yearEl) {
    yearEl.textContent = String(new Date().getFullYear());
  }

  const parallaxNodes = Array.from(document.querySelectorAll('[data-parallax]'));
  const revealNodes = Array.from(document.querySelectorAll('[data-reveal]'));

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function applyParallax() {
    if (prefersReducedMotion) return;
    const y = window.scrollY || window.pageYOffset || 0;
    const vh = window.innerHeight || 800;
    const t = clamp(y / Math.max(1, vh * 1.2), 0, 1);

    parallaxNodes.forEach((el) => {
      const speed = Number(el.getAttribute('data-parallax')) || 0;
      const translate = Math.round((y * speed) / 6);
      const scale = 1 + speed * 0.04 * t;
      el.style.transform = `translate3d(0, ${translate}px, 0) scale(${scale})`;
    });
  }

  function initReveal() {
    if (!revealNodes.length) return;
    if (prefersReducedMotion || typeof IntersectionObserver === 'undefined') {
      revealNodes.forEach((n) => n.classList.add('is-visible'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          e.target.classList.add('is-visible');
          io.unobserve(e.target);
        });
      },
      { root: null, threshold: 0.18 }
    );
    revealNodes.forEach((n) => io.observe(n));
  }

  let rafId = 0;
  function scheduleParallax() {
    if (!parallaxNodes.length || prefersReducedMotion) return;
    if (rafId) return;
    rafId = window.requestAnimationFrame(() => {
      rafId = 0;
      applyParallax();
    });
  }

  initReveal();
  applyParallax();
  window.addEventListener('scroll', scheduleParallax, { passive: true });
  window.addEventListener('resize', scheduleParallax, { passive: true });
})();

