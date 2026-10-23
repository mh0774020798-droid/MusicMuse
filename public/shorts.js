import { escapeHtml as esc } from './core.js';
import { tikTokPlayerURL, parseTikTokPlayerMessage } from './tiktok.js';

// Only the visible slide owns an iframe. Removing it also stops playback when
// the provider cannot receive a pause message (for example during a network error).
export class TikTokFeed {
  constructor(root, callbacks = {}) {
    this.root = root; this.callbacks = callbacks; this.items = []; this.index = 0;
    this.frame = null; this.signature = ''; this.muted = true; this.preferredMute = true; this.playing = false;
    this.nativeControls = false; this.readyTimer = null; this.scrollFrame = null;
    this.resizeObserver = null; this.recorded = new Set();
    root.addEventListener('click', event => this.click(event));
    root.addEventListener('keydown', event => {
      if (!this.items.length || event.target.closest('input,textarea,select')) return;
      if (['ArrowDown', 'PageDown', 'ArrowUp', 'PageUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        if (event.key === 'Home') this.focusIndex(0);
        else if (event.key === 'End') this.focusIndex(this.items.length - 1);
        else this.navigate(['ArrowDown', 'PageDown'].includes(event.key) ? 1 : -1);
      } else if (event.code === 'Space' && (!event.target.closest('button,a') || event.target.closest('.shorts-touch-zone'))) { event.preventDefault(); event.stopPropagation(); this.togglePlay(); }
    });
    window.addEventListener('message', event => this.message(event));
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.pause(); });
  }
  render(items, { likes = [], saved = [], reducedMotion = false } = {}) {
    this.reducedMotion = reducedMotion;
    const signature = JSON.stringify(items.map(x => [x.id, x.title, x.artist, x.url]));
    if (signature !== this.signature || !this.root.firstElementChild) {
      const previousId = this.items[this.index]?.id;
      this.destroyFrame(); this.resizeObserver?.disconnect();
      this.signature = signature; this.items = items;
      this.index = Math.max(0, items.findIndex(x => x.id === previousId));
      this.root.innerHTML = this.markup();
      this.viewport = this.root.querySelector('.shorts-feed');
      if (this.viewport) {
        this.viewport.addEventListener('scroll', () => {
          if (this.scrollFrame) return;
          this.scrollFrame = requestAnimationFrame(() => {
            this.scrollFrame = null;
            if (!this.root.hidden && this.viewport.clientHeight) this.activate(Math.min(this.items.length - 1, Math.max(0, Math.round(this.viewport.scrollTop / this.viewport.clientHeight))));
          });
        }, { passive: true });
        if ('ResizeObserver' in window) {
          this.resizeObserver = new ResizeObserver(() => { if (!this.root.hidden) this.viewport.scrollTop = this.index * this.viewport.clientHeight; });
          this.resizeObserver.observe(this.viewport);
        }
        this.viewport.scrollTop = this.index * this.viewport.clientHeight;
      }
    }
    this.syncActions(likes, saved);
    if (this.viewport && this.resizeObserver) this.resizeObserver.observe(this.viewport);
    if (this.items.length && !this.frame) this.activate(this.index, true);
  }
  markup() {
    if (!this.items.length) return `<section class="shorts-empty"><div class="shorts-empty-phone"><span>♪</span><i></i><i></i><i></i></div><span class="eyebrow">A LITTLE SCROLL. A LOT OF SOUND.</span><h3>מקום לעוד צליל.</h3><p>הסרטונים שבאוסף הוסתרו או סוננו.<br>אפשר להחזיר אותם דרך הגדרות התוכן.</p><button class="primary" data-tt-action="settings">הגדרות תצוגה</button><small>הרצף נטען אוטומטית — אין צורך בחשבון, מפתח או קישור.</small></section>`;
    return `<div class="shorts-toolbar"><div><span class="shorts-live-dot"></span><b>TikTok <span class="shorts-muse">× Music Muse</span></b><small>בחירת האתר נטענת אוטומטית. גוללים, בוחרים וצופים.</small></div><button class="secondary" data-tt-action="add">＋ סרטון אישי</button></div><div class="shorts-shell"><div class="shorts-feed" tabindex="0" role="region" aria-label="סרטוני TikTok בגלילה אנכית">${this.items.map((x, i) => `<article class="shorts-slide" data-short-id="${esc(x.id)}" aria-label="סרטון ${i + 1} מתוך ${this.items.length}: ${esc(x.title)}"><div class="shorts-content"><div class="shorts-post-header"><a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer"><span class="shorts-avatar">♪</span><strong>${esc(x.artist)}</strong></a><span class="shorts-source">TikTok</span></div><div class="shorts-phone"><div class="shorts-frame-host" data-frame-host="${esc(x.id)}"></div><button class="shorts-touch-zone" data-tt-action="toggle" aria-label="ניגון או השהיית הסרטון; ניתן לגלול כאן"><span class="shorts-center-play" hidden>▶</span></button><div class="shorts-player-status" role="status"><span>♪</span><p>הנגן ייטען כשהסרטון יופיע במסך</p><button class="secondary" data-tt-action="retry" hidden>ניסיון נוסף</button><a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">פתיחה ב־TikTok ↗</a></div></div><div class="shorts-description"><h3>${esc(x.title)}</h3><a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">הסרטון המקורי ↗</a></div></div><div class="shorts-rail"><button data-tt-action="like" data-id="${esc(x.id)}" aria-label="אהבתי את ${esc(x.title)}" aria-pressed="false"><span>♡</span><small>אהבתי</small></button><button data-tt-action="save" data-id="${esc(x.id)}" aria-label="שמירת ${esc(x.title)}" aria-pressed="false"><span>＋</span><small>שמירה</small></button><button data-tt-action="share" data-id="${esc(x.id)}" aria-label="שיתוף קישור לסרטון"><span>↗</span><small>שיתוף</small></button><button data-tt-action="menu" data-id="${esc(x.id)}" aria-label="אפשרויות לסרטון"><span>⋯</span><small>עוד</small></button><div class="shorts-swipe-hint" aria-hidden="true"><span>↕</span><small>גוללים</small></div></div></article>`).join('')}</div><div class="shorts-navigation" aria-label="מעבר בין סרטונים"><button class="icon-btn" data-tt-action="previous" aria-label="הסרטון הקודם">↑</button><span class="shorts-counter" aria-live="polite"></span><button class="icon-btn" data-tt-action="next" aria-label="הסרטון הבא">↓</button></div></div><div class="shorts-controls"><button class="secondary shorts-mute" data-tt-action="mute" aria-pressed="${this.muted}">הפעלת צליל</button><button class="secondary shorts-controls-toggle" data-tt-action="native" aria-pressed="${this.nativeControls}">פקדי הנגן</button><span>אפשר לגלול על הסרטון או ברצועה שלצדו.</span></div>`;
  }
  syncActions(likes, saved) {
    for (const b of this.root.querySelectorAll('[data-tt-action="like"], [data-tt-action="save"]')) {
      const active = (b.dataset.ttAction === 'like' ? likes : saved).includes(b.dataset.id);
      b.classList.toggle('on', active); b.setAttribute('aria-pressed', String(active));
      b.querySelector('span').textContent = b.dataset.ttAction === 'like' ? active ? '♥' : '♡' : active ? '✓' : '＋';
      b.querySelector('small').textContent = b.dataset.ttAction === 'save' && active ? 'נשמר' : b.dataset.ttAction === 'save' ? 'שמירה' : 'אהבתי';
    }
    this.root.classList.toggle('shorts-native-controls', this.nativeControls);
    this.updateControls();
  }
  activate(index, force = false, startAt = 0) {
    if (!this.items[index] || this.root.hidden || document.hidden || (!force && index === this.index && this.frame)) return;
    this.destroyFrame(); this.index = index; this.playing = false; this.position = 0; this.seekAfterReady = startAt;
    this.callbacks.onActivate?.(this.items[index]);
    const slide = this.root.querySelectorAll('.shorts-slide')[index];
    this.root.querySelectorAll('.shorts-slide').forEach((node, i) => node.classList.toggle('shorts-active', i === index));
    const host = slide.querySelector('.shorts-frame-host');
    const frame = document.createElement('iframe'); frame.src = tikTokPlayerURL(this.items[index].tiktokId, { muted: this.preferredMute });
    frame.title = `TikTok — ${this.items[index].title}`; frame.allow = 'autoplay; fullscreen; encrypted-media; picture-in-picture'; frame.allowFullscreen = true; frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.addEventListener('load', () => {
      if (this.frame !== frame) return;
      clearTimeout(this.readyTimer);
      const status = slide.querySelector('.shorts-player-status'); if (status) status.hidden = true;
      // A loaded iframe is not a playback success. History is recorded only
      // after an authenticated onStateChange message from this active frame.
      this.send(this.preferredMute ? 'mute' : 'unMute');
      if (this.seekAfterReady > 0) this.send('seekTo', this.seekAfterReady);
      this.send(this.root.hidden || document.hidden ? 'pause' : 'play');
    });
    this.frame = frame; host.replaceChildren(frame);
    this.showStatus('טוענים את הסרטון…');
    this.readyTimer = setTimeout(() => { if (this.frame === frame) this.showStatus('הנגן עדיין לא השיב. אפשר לנסות שוב או לפתוח את הסרטון ב־TikTok.', true); }, 12000);
    this.updateControls();
  }
  destroyFrame() {
    clearTimeout(this.readyTimer); this.readyTimer = null;
    this.send('pause'); this.frame?.remove(); this.frame = null; this.playing = false;
  }
  hide() { this.destroyFrame(); this.resizeObserver?.disconnect(); this.root.hidden = true; }
  pause() { this.send('pause'); this.playing = false; this.updateControls(); }
  send(type, value) { this.frame?.contentWindow?.postMessage({ type, ...(value === undefined ? {} : { value }), 'x-tiktok-player': true }, 'https://www.tiktok.com'); }
  showStatus(message, error = false) {
    const status = this.root.querySelectorAll('.shorts-slide')[this.index]?.querySelector('.shorts-player-status');
    if (!status) return;
    status.hidden = false; status.classList.toggle('shorts-status-error', error); status.querySelector('p').textContent = message; status.querySelector('button').hidden = !error;
  }
  message(event) {
    const message = parseTikTokPlayerMessage(event, this.frame?.contentWindow);
    if (!message) return;
    if (message.type === 'onPlayerReady') {
      clearTimeout(this.readyTimer);
      const status = this.root.querySelectorAll('.shorts-slide')[this.index]?.querySelector('.shorts-player-status'); if (status) status.hidden = true;
      this.send(this.preferredMute ? 'mute' : 'unMute');
      if (this.seekAfterReady > 0) this.send('seekTo', this.seekAfterReady);
      this.send(this.root.hidden || document.hidden ? 'pause' : 'play');
    } else if (message.type === 'onStateChange') {
      this.playing = message.value === 1;
      if (this.playing && (this.root.hidden || document.hidden)) { this.pause(); return; }
      if (this.playing) {
        const item = this.items[this.index];
        if (!this.recorded.has(item.id)) { this.recorded.add(item.id); this.callbacks.onPlay?.(item); }
      }
    } else if (message.type === 'onCurrentTime') {
      if (Number.isFinite(message.value?.currentTime)) this.position = Math.max(0, Math.min(message.value.currentTime, 604800));
    } else if (message.type === 'onMute') this.muted = Boolean(message.value);
    else if (['onPlayerError', 'onError'].includes(message.type)) {
      clearTimeout(this.readyTimer); this.playing = false;
      const code = message.value?.errorCode ?? message.value;
      this.showStatus(code === 3002 ? 'הדפדפן מבקש לחיצה על הניגון. הפעל את ״פקדי הנגן״ ולחץ ▶ בנגן.' : 'הסרטון אינו זמין כרגע בנגן המוטמע. אפשר לנסות שוב או לפתוח אותו ב־TikTok.', true);
    }
    this.updateControls();
  }
  updateControls() {
    const counter = this.root.querySelector('.shorts-counter'); if (counter) counter.textContent = `${this.index + 1} / ${this.items.length}`;
    const prev = this.root.querySelector('[data-tt-action="previous"]'), next = this.root.querySelector('[data-tt-action="next"]');
    if (prev) prev.disabled = this.index <= 0; if (next) next.disabled = this.index >= this.items.length - 1;
    const mute = this.root.querySelector('.shorts-mute'); if (mute) { mute.textContent = this.muted ? '♫ הפעלת צליל' : '⊘ השתקה'; mute.setAttribute('aria-pressed', String(this.muted)); }
    const native = this.root.querySelector('.shorts-controls-toggle'); if (native) { native.textContent = this.nativeControls ? '↕ חזרה למצב גלילה' : 'פקדי הנגן'; native.setAttribute('aria-pressed', String(this.nativeControls)); }
    const hint = this.root.querySelector('.shorts-controls>span'); if (hint) hint.textContent = this.nativeControls && !this.preferredMute && this.muted ? 'להפעלת צליל, לחץ גם על סמל הרמקול בנגן.' : this.nativeControls ? 'עוברים בין סרטונים בעזרת החצים או הרצועה שלצד הנגן.' : 'אפשר לגלול על הסרטון או ברצועה שלצדו.';
    this.root.querySelectorAll('.shorts-center-play').forEach((node, i) => { node.hidden = i !== this.index || this.playing; });
  }
  focusIndex(index) {
    if (!this.viewport || !this.items.length) return;
    const target = Math.min(this.items.length - 1, Math.max(0, index));
    this.viewport.scrollTo({ top: target * this.viewport.clientHeight, behavior: this.reducedMotion ? 'auto' : 'smooth' });
  }
  focus(id) { const index = this.items.findIndex(x => x.id === id); if (index >= 0) this.focusIndex(index); }
  navigate(delta) { this.focusIndex(this.index + delta); }
  togglePlay() { if (this.frame) this.send(this.playing ? 'pause' : 'play'); else this.activate(this.index, true); }
  toggleMute() {
    this.preferredMute = !this.muted; this.muted = this.preferredMute;
    if (!this.muted) { this.nativeControls = true; this.root.classList.add('shorts-native-controls'); }
    // TikTok's muted=1 URL option locks the player's volume. Recreate it with
    // volume controls enabled after the user's explicit sound request.
    if (!this.muted && this.frame && new URL(this.frame.src).searchParams.get('muted') === '1') this.activate(this.index, true, this.position || 0);
    else this.send(this.muted ? 'mute' : 'unMute');
    this.updateControls();
  }
  click(event) {
    const b = event.target.closest('[data-tt-action]'); if (!b || b.disabled) return;
    const action = b.dataset.ttAction;
    if (action === 'next' || action === 'previous') this.navigate(action === 'next' ? 1 : -1);
    else if (action === 'toggle') this.togglePlay();
    else if (action === 'retry') this.activate(this.index, true);
    else if (action === 'mute') this.toggleMute();
    else if (action === 'native') { this.nativeControls = !this.nativeControls; this.root.classList.toggle('shorts-native-controls', this.nativeControls); this.updateControls(); }
    else this.callbacks[action]?.(b.dataset.id);
  }
}
