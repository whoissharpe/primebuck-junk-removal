/* Prime Buck Junk Removal — small enhancements only.
   Everything on this page works without JavaScript. */
(function () {
  'use strict';

  // Keep only one FAQ answer open at a time.
  var faqs = document.querySelectorAll('.faq details');
  faqs.forEach(function (d) {
    d.addEventListener('toggle', function () {
      if (!d.open) return;
      faqs.forEach(function (o) { if (o !== d) o.open = false; });
    });
  });

  // Pause the hero animation while it is off screen, so it is not
  // burning cycles on a phone the whole time someone reads the page.
  var stage = document.querySelector('.stage__svg');
  if (stage && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        stage.style.animationPlayState = e.isIntersecting ? 'running' : 'paused';
        stage.querySelectorAll('.pc, .floor, .shaft rect').forEach(function (n) {
          n.style.animationPlayState = e.isIntersecting ? 'running' : 'paused';
        });
      });
    }, { threshold: 0 });
    io.observe(stage);
  }
})();

/* Gallery lightbox — click a photo to browse the full set. */
(function () {
  'use strict';
  var items = Array.prototype.slice.call(document.querySelectorAll('.gal__item img'));
  if (!items.length) return;

  var lb = document.getElementById('lightbox');
  var lbImg = document.getElementById('lbImg');
  var idx = 0;

  function show(i) {
    idx = (i + items.length) % items.length;
    lbImg.src = items[idx].src;
    lbImg.alt = items[idx].alt;
  }
  function open(i) {
    show(i);
    lb.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }
  function close() {
    lb.classList.remove('is-open');
    document.body.style.overflow = '';
  }

  items.forEach(function (img, i) {
    img.closest('.gal__item').addEventListener('click', function () { open(i); });
  });
  document.getElementById('lbClose').addEventListener('click', close);
  document.getElementById('lbPrev').addEventListener('click', function () { show(idx - 1); });
  document.getElementById('lbNext').addEventListener('click', function () { show(idx + 1); });
  lb.addEventListener('click', function (e) { if (e.target === lb) close(); });
  document.addEventListener('keydown', function (e) {
    if (!lb.classList.contains('is-open')) return;
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowLeft') show(idx - 1);
    if (e.key === 'ArrowRight') show(idx + 1);
  });
})();
