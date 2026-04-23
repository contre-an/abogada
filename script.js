/* ============================================================
   OSSA & ABOGADOS ASESORES S.A.S. — Script global
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {

  // ── MOBILE NAV ─────────────────────────────────────────────
  const navToggle = document.getElementById('navToggle');
  const navLinks  = document.getElementById('navLinks');

  navToggle?.addEventListener('click', () => {
    const open = navLinks.classList.toggle('open');
    navToggle.setAttribute('aria-expanded', String(open));
    document.body.style.overflow = open ? 'hidden' : '';
  });

  // Cerrar menú al hacer click en un link
  navLinks?.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => {
      navLinks.classList.remove('open');
      document.body.style.overflow = '';
    });
  });

  // Cerrar menú al hacer click fuera
  document.addEventListener('click', (e) => {
    if (navLinks?.classList.contains('open') &&
        !navLinks.contains(e.target) &&
        !navToggle.contains(e.target)) {
      navLinks.classList.remove('open');
      document.body.style.overflow = '';
    }
  });

  // ── SCROLL REVEAL ──────────────────────────────────────────
  const revealEls = document.querySelectorAll('.reveal');

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        // Stagger siblings en el mismo grid/flex parent
        const siblings = entry.target.parentElement?.querySelectorAll('.reveal:not(.visible)');
        siblings?.forEach((el, idx) => {
          setTimeout(() => el.classList.add('visible'), idx * 80);
        });
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

  revealEls.forEach(el => observer.observe(el));

  // ── CONTADORES ANIMADOS ────────────────────────────────────
  const counters = document.querySelectorAll('.exp-num, .impact-num');

  const animCounter = (el) => {
    const target = parseInt(el.dataset.target, 10);
    if (isNaN(target)) return;
    const duration = 1600;
    const start = performance.now();

    const tick = (now) => {
      const p = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.floor(ease * target).toLocaleString('es-CO');
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  const counterObs = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        animCounter(e.target);
        counterObs.unobserve(e.target);
      }
    });
  }, { threshold: 0.5 });

  counters.forEach(c => counterObs.observe(c));

  // ── FORMULARIO DE CONTACTO ─────────────────────────────────
  const form    = document.getElementById('contactForm');
  const success = document.getElementById('formSuccess');

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Enviando…'; }

    // Simular envío (aquí integrar con backend/EmailJS/Formspree)
    setTimeout(() => {
      form.style.display = 'none';
      if (success) success.style.display = 'block';
    }, 1200);
  });

  // ── SMOOTH SCROLL para anclas internas ─────────────────────
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const id = a.getAttribute('href').slice(1);
      const target = id ? document.getElementById(id) : null;
      if (target) {
        e.preventDefault();
        const top = target.getBoundingClientRect().top + window.scrollY - 80;
        window.scrollTo({ top, behavior: 'smooth' });
      }
    });
  });

  // ── WHATSAPP FLOTANTE ──────────────────────────────────────
  const waBtn = document.createElement('a');
  waBtn.href    = 'https://wa.me/573185720495?text=Hola,%20deseo%20información%20sobre%20sus%20servicios%20legales.';
  waBtn.target  = '_blank';
  waBtn.rel     = 'noopener noreferrer';
  waBtn.title   = 'Contáctenos por WhatsApp';
  waBtn.setAttribute('aria-label', 'WhatsApp');
  waBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="white" width="28" height="28">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>`;
  Object.assign(waBtn.style, {
    position:     'fixed',
    bottom:       '28px',
    right:        '28px',
    width:        '56px',
    height:       '56px',
    borderRadius: '50%',
    background:   '#25D366',
    display:      'flex',
    alignItems:   'center',
    justifyContent: 'center',
    boxShadow:    '0 4px 16px rgba(37,211,102,0.45)',
    zIndex:       '9999',
    transition:   'transform 0.2s ease, box-shadow 0.2s ease',
  });
  waBtn.addEventListener('mouseenter', () => {
    waBtn.style.transform  = 'scale(1.08)';
    waBtn.style.boxShadow  = '0 6px 24px rgba(37,211,102,0.6)';
  });
  waBtn.addEventListener('mouseleave', () => {
    waBtn.style.transform  = 'scale(1)';
    waBtn.style.boxShadow  = '0 4px 16px rgba(37,211,102,0.45)';
  });
  document.body.appendChild(waBtn);

});
