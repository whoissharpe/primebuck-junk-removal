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

/* Photo upload — compress client-side to small JPEGs so uploads are fast
   on mobile data and stay well under D1 row-size limits. */
var quotePhotos = [];

(function () {
  'use strict';
  var input = document.getElementById('photos');
  var dropzone = document.getElementById('dropzone');
  var previews = document.getElementById('photoPreviews');
  if (!input || !dropzone || !previews) return;

  var MAX_PHOTOS = 3;
  var MAX_DIM = 1000;
  var QUALITY = 0.7;

  dropzone.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
  });

  input.addEventListener('change', function () {
    var files = Array.prototype.slice.call(input.files || []).slice(0, MAX_PHOTOS - quotePhotos.length);
    files.forEach(addPhoto);
    input.value = '';
  });

  function addPhoto(file) {
    if (!file.type || file.type.indexOf('image/') !== 0) return;
    if (quotePhotos.length >= MAX_PHOTOS) return;

    var img = new Image();
    var reader = new FileReader();
    reader.onload = function () {
      img.onload = function () {
        var scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
        var w = Math.round(img.width * scale);
        var h = Math.round(img.height * scale);
        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        var dataUrl = canvas.toDataURL('image/jpeg', QUALITY);
        quotePhotos.push(dataUrl);
        renderPreviews();
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  function renderPreviews() {
    previews.innerHTML = '';
    quotePhotos.forEach(function (src, i) {
      var wrap = document.createElement('div');
      wrap.className = 'photo-preview';
      var img = document.createElement('img');
      img.src = src;
      img.alt = 'Attached photo ' + (i + 1);
      var rm = document.createElement('button');
      rm.type = 'button';
      rm.setAttribute('aria-label', 'Remove photo');
      rm.textContent = '\u00d7';
      rm.addEventListener('click', function () {
        quotePhotos.splice(i, 1);
        renderPreviews();
      });
      wrap.appendChild(img);
      wrap.appendChild(rm);
      previews.appendChild(wrap);
    });
    dropzone.style.display = quotePhotos.length >= MAX_PHOTOS ? 'none' : 'flex';
  }

  window.resetQuotePhotos = function () {
    quotePhotos = [];
    renderPreviews();
    dropzone.style.display = 'flex';
  };
})();

/* Quote form — posts to our own /api/submit (Cloudflare Pages Function + D1). */
(function () {
  'use strict';
  var form = document.getElementById('quoteForm');
  if (!form) return;
  var status = document.getElementById('formStatus');
  var button = form.querySelector('button[type="submit"]');
  var DEFAULT_LABEL = 'Get my free quote';

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    var payload = {
      name: form.name.value.trim(),
      phone: form.phone.value.trim(),
      email: form.email.value.trim(),
      message: form.message.value.trim(),
      smsConsent: form.sms.checked,
      photos: quotePhotos.slice(),
    };
    if (!payload.name || !payload.phone || !payload.message) {
      status.textContent = 'Please fill in your name, phone and what needs to go.';
      status.className = 'form__status form__status--err';
      return;
    }

    button.disabled = true;
    button.textContent = 'Sending…';
    status.textContent = '';
    status.className = 'form__status';

    try {
      var res = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      var data = await res.json().catch(function () { return {}; });
      if (res.ok && data.ok) {
        form.reset();
        if (window.resetQuotePhotos) window.resetQuotePhotos();
        status.textContent = 'Thanks — we got it and will be in touch shortly.';
        status.className = 'form__status form__status--ok';
      } else {
        throw new Error(data.error || 'unknown');
      }
    } catch (err) {
      status.textContent = 'Something went wrong. Please call (904) 544-7889 instead.';
      status.className = 'form__status form__status--err';
    } finally {
      button.disabled = false;
      button.textContent = DEFAULT_LABEL;
    }
  });
})();
