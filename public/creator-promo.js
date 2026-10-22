export const CREATOR_PROMO_KEY = 'music-muse-creator-promo-last-shown';
export const CREATOR_PROMO_COOLDOWN = 5 * 60 * 1000;
export const CREATOR_PROMO_LOCK = 5000;

export function creatorPromoDue(lastShownAt, now = Date.now()) {
  const timestamp = Number(lastShownAt);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) return true;
  // A clock adjustment must not turn a refresh into another advertisement.
  return now - timestamp >= CREATOR_PROMO_COOLDOWN;
}

export function creatorPromoSeconds(startedAt, now) {
  return Math.max(0, Math.ceil((CREATOR_PROMO_LOCK - Math.max(0, now - startedAt)) / 1000));
}

export function claimCreatorPromo(storages, now = Date.now()) {
  const readable = [];
  for (const storage of storages) {
    try {
      if (!creatorPromoDue(storage.getItem(CREATOR_PROMO_KEY), now)) return false;
      readable.push(storage);
    } catch { /* Try the other browser storage when one is unavailable. */ }
  }
  let recorded = false;
  for (const storage of readable) {
    try {
      storage.setItem(CREATOR_PROMO_KEY, String(now));
      recorded = storage.getItem(CREATOR_PROMO_KEY) === String(now) || recorded;
    } catch { /* Do not interrupt the music app when storage is full or blocked. */ }
  }
  // If the timestamp cannot be saved, skip the promo rather than repeat on refresh.
  return recorded;
}

export function initCreatorPromo(dialog) {
  if (!dialog || typeof dialog.showModal !== 'function') return;
  const closeButtons = [...dialog.querySelectorAll('[data-creator-close]')];
  const countdown = dialog.querySelector('[data-creator-countdown]');
  const status = dialog.querySelector('[data-creator-status]');
  const label = dialog.querySelector('[data-creator-label]');
  const close = dialog.querySelector('.creator-promo-close');
  let startedAt = 0, timer, previousSeconds, opening = false;

  function update() {
    const seconds = creatorPromoSeconds(startedAt, performance.now());
    if (seconds === previousSeconds) return seconds;
    previousSeconds = seconds;
    for (const button of closeButtons) button.disabled = seconds > 0;
    dialog.dataset.unlocked = String(seconds === 0);
    countdown.textContent = String(seconds);
    label.textContent = seconds ? 'עוד רגע, נכנסים' : 'כניסה ל־Music Muse';
    close.title = seconds ? `אפשר לסגור בעוד ${seconds === 1 ? 'שנייה אחת' : seconds + ' שניות'}` : 'סגירת חלונית היוצר';
    status.textContent = seconds ? `אפשר להמשיך בעוד ${seconds === 1 ? 'שנייה אחת' : seconds + ' שניות'}` : 'תודה על הרגע שלכם. עכשיו, למוזיקה.';
    if (!seconds) clearInterval(timer);
    return seconds;
  }

  function restorePage() {
    clearInterval(timer);
    document.body.classList.remove('creator-promo-visible');
    if (!document.activeElement || document.activeElement === document.body) document.getElementById('discoverBtn')?.focus({ preventScroll: true });
  }

  function dismiss() {
    if (dialog.open && update() === 0) { dialog.close(); restorePage(); }
  }

  for (const button of closeButtons) button.addEventListener('click', dismiss);
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    dismiss();
  });
  dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dismiss();
  });
  dialog.addEventListener('close', restorePage);
  document.addEventListener('visibilitychange', () => { if (dialog.open) update(); });

  async function showIfDue() {
    if (opening || dialog.open || document.querySelector('dialog[open]')) return;
    opening = true;
    const show = () => {
      if (document.querySelector('dialog[open]')) return;
      const storages = [];
      for (const name of ['localStorage', 'sessionStorage']) {
        try { storages.push(window[name]); } catch { /* Storage can be disabled by browser settings. */ }
      }
      if (!claimCreatorPromo(storages)) return;
      startedAt = performance.now();
      previousSeconds = undefined;
      update();
      dialog.showModal();
      document.body.classList.add('creator-promo-visible');
      timer = setInterval(update, 100);
    };
    try {
      // Coordinate simultaneous entries in different tabs when Web Locks is supported.
      if (navigator.locks?.request) await navigator.locks.request('music-muse-creator-promo', show);
      else show();
    } catch { /* A nonessential promotion must never stop the app from loading. */ }
    finally { opening = false; }
  }

  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    if (dialog.open) update(); else showIfDue();
  });
  showIfDue();
}
