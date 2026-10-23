import { escapeHtml as esc, videoId, normalizeTrack } from './core.js';
import { loadYouTubeAPI, youtubeEmbedURL, channelEmbedURL } from './youtube.js';
import { togglePlayerSize, closePlayerSize } from './fullscreen.js';
import { mergeFeedSession } from './feed-order.js';

let playerId = 0;
const errors = { 2: 'מזהה הסרטון אינו תקין.', 5: 'הדפדפן אינו מצליח לנגן את הסרטון.', 100: 'הסרטון הוסר או אינו ציבורי.', 101: 'היוצר אינו מאפשר הטמעה של הסרטון.', 150: 'היוצר אינו מאפשר הטמעה של הסרטון.', 153: 'YouTube דורש כתובת אתר מזוהה. פתחו את האתר ב־HTTPS.' };

export class YouTubeFeed {
  constructor(root, callbacks = {}) {
    this.root = root; this.callbacks = callbacks; this.items = []; this.index = 0;
    this.frame = null; this.player = null; this.muted = true; this.playing = false;
    this.intent = true; this.suspended = false; this.recorded = new Set(); this.autoNext = true;
    this.discoveredChannels = new Map();
    root.addEventListener('click', event => this.click(event));
    root.addEventListener('keydown', event => {
      if (event.target.closest('button,a,input,select,textarea')) return;
      const directions = { ArrowDown: 1, PageDown: 1, ArrowUp: -1, PageUp: -1 };
      if (directions[event.key]) { event.preventDefault(); event.stopPropagation(); this.navigate(directions[event.key]); }
      else if (event.code === 'Space') { event.preventDefault(); event.stopPropagation(); this.togglePlay(); }
    });
    document.addEventListener('visibilitychange', () => this.syncVisibility());
    this.dialogObserver = new MutationObserver(() => this.syncVisibility());
    this.dialogObserver.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
  }
  canPlay() { return !this.root.hidden && !document.hidden && !document.querySelector('dialog[open]'); }
  render(items, { likes = [], saved = [], hidden = [], reducedMotion = false, autoNext = true } = {}) {
    this.reducedMotion = reducedMotion; this.autoNext = autoNext; this.hidden = new Set(hidden);
    const activeId = this.items[this.index]?.id;
    const ordered = mergeFeedSession(this.items, items);
    if (!this.viewport || !activeId || !ordered.some(x => x.id === activeId)) {
      this.destroyFrame(); this.resizeObserver?.disconnect();
      this.items = ordered; this.index = Math.min(this.index, Math.max(0, ordered.length - 1));
      this.root.innerHTML = this.markup();
      this.viewport = this.root.querySelector('.watch-viewport');
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
    } else if (JSON.stringify(ordered.map(x => x.id)) !== JSON.stringify(this.items.map(x => x.id))) {
      // Do not move or replace a live iframe when a refresh adds more videos.
      const wanted = new Set(ordered.map(x => x.id));
      for (const slide of this.viewport.querySelectorAll('.watch-slide')) if (!wanted.has(slide.dataset.watchId)) slide.remove();
      const existing = new Set(this.items.map(x => x.id));
      for (const item of ordered) if (!existing.has(item.id)) this.viewport.insertAdjacentHTML('beforeend', this.slide(item));
      this.items = ordered; this.index = ordered.findIndex(x => x.id === activeId);
      this.viewport.scrollTop = this.index * this.viewport.clientHeight;
    }
    this.items = ordered;
    this.syncActions(likes, saved); this.updateControls();
    this.suppressHidden();
    if (this.viewport && this.resizeObserver) this.resizeObserver.observe(this.viewport);
    if (this.items.length && !this.frame && !this.root.hidden) this.activate(this.index, true);
  }
  slide(item) {
    return `<article class="watch-slide" data-watch-id="${esc(item.id)}" aria-label="${esc(item.title)}"><div class="watch-video-card"><div class="watch-author"><span class="watch-avatar">♫</span><div><b>${esc(item.artist)}</b><small>מוזיקה, ברצף שלך</small></div><span class="watch-provider">YouTube</span></div><div class="watch-frame-host"></div><div class="watch-caption"><h3>${esc(item.title)}</h3><span class="watch-slide-note">גוללים בצד הנגן לסרטון הבא ↓</span></div></div><div class="watch-rail"><button data-watch-action="like" ${item.channelId ? 'disabled' : ''} data-id="${esc(item.id)}" aria-label="אהבתי את ${esc(item.title)}" aria-pressed="false"><span>♡</span><small>אהבתי</small></button><button data-watch-action="save" ${item.channelId ? 'disabled' : ''} data-id="${esc(item.id)}" aria-label="שמירת ${esc(item.title)}" aria-pressed="false"><span>＋</span><small>שמירה</small></button><button data-watch-action="menu" ${item.channelId ? 'disabled' : ''} data-id="${esc(item.id)}" aria-label="אפשרויות לסרטון"><span>⋯</span><small>עוד</small></button><i aria-hidden="true">↕</i></div></article>`;
  }
  markup() {
    if (!this.items.length) return '<div class="empty"><div class="empty-icon">♫</div><h3>מקום לעוד מוזיקה</h3><p>הסרטונים הוסתרו בהעדפות התוכן.</p><button class="secondary" data-watch-action="settings">הגדרות תוכן</button></div>';
    return `<div class="watch-shell"><div class="watch-viewport" tabindex="0" role="region" aria-label="פיד YouTube בגלילה">${this.items.map(item => this.slide(item)).join('')}</div><div class="watch-navigation" aria-label="מעבר בין סרטונים"><button data-watch-action="previous" aria-label="הסרטון הקודם בפיד">↑</button><span class="watch-counter" aria-live="polite"></span><button data-watch-action="next" aria-label="הסרטון הבא בפיד">↓</button></div></div><div class="watch-controls"><button class="secondary watch-play" data-watch-action="toggle">▶ ניגון</button><button class="secondary watch-mute" data-watch-action="mute" aria-pressed="true">♫ הפעלת צליל</button><button class="secondary watch-expand" data-watch-action="expand">⛶ הגדלה</button><span class="watch-status" role="status">הסרטון הראשון נטען אוטומטית</span></div>`;
  }
  syncActions(likes, saved) {
    this.likes = likes; this.saved = saved;
    for (const button of this.root.querySelectorAll('[data-watch-action="like"], [data-watch-action="save"]')) {
      const liked = button.dataset.watchAction === 'like';
      const active = (liked ? likes : saved).includes(button.dataset.id);
      button.classList.toggle('on', active); button.setAttribute('aria-pressed', String(active));
      button.querySelector('span').textContent = liked ? active ? '♥' : '♡' : active ? '✓' : '＋';
      button.querySelector('small').textContent = liked ? 'אהבתי' : active ? 'נשמר' : 'שמירה';
    }
  }
  activate(index, force = false) {
    const item = this.items[index];
    if (!item || this.root.hidden || document.hidden || (!force && this.index === index && this.frame)) return;
    this.destroyFrame(); this.index = index; this.activeItem = null; this.suppressedId = null; this.heldAtEnd = false; this.callbacks.onActivate?.(item);
    this.intent = true; this.suspended = !this.canPlay();
    const frame = document.createElement('iframe');
    frame.id = 'feed-youtube-player-' + ++playerId;
    frame.src = item.channelId ? channelEmbedURL(item.channelId, location.origin, !this.suspended) : youtubeEmbedURL(item.videoId, location.origin, !this.suspended);
    frame.title = `YouTube — ${item.title}`;
    frame.allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture'; frame.allowFullscreen = true;
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    this.root.querySelectorAll('.watch-slide')[index].querySelector('.watch-frame-host').replaceChildren(frame);
    this.frame = frame; this.status('טוענים את הסרטון…'); this.updateControls();
    this.startTimer = setTimeout(() => { if (this.frame === frame && !this.playing && this.intent && this.canPlay()) this.status('הווידאו טרם התחיל. נסו ▶ בתוך הנגן או עברו לסרטון הבא.'); }, 15000);
    loadYouTubeAPI().then(() => {
      if (this.frame !== frame) return;
      this.player = new window.YT.Player(frame.id, { host: 'https://www.youtube-nocookie.com', events: {
        onReady: event => {
          if (this.frame !== frame) return;
          this.player = event.target;
          this.syncChannel();
          if (this.muted) this.player.mute(); else this.player.unMute();
          this.suspended = !this.canPlay();
          if (!this.suspended && this.intent) this.player.playVideo(); else this.player.pauseVideo();
        },
        onStateChange: event => { if (this.frame === frame) this.stateChange(event.data); },
        onError: event => { if (this.frame === frame) { clearTimeout(this.startTimer); this.playing = false; this.status((errors[event.data] || 'הסרטון אינו זמין כרגע.') + ' אפשר לעבור לסרטון הבא.', true); this.updateControls(); } },
        onAutoplayBlocked: () => { if (this.frame === frame) { clearTimeout(this.startTimer); this.playing = false; this.status('הדפדפן מבקש לחיצה על ▶ בנגן כדי להתחיל.'); this.updateControls(); } }
      } });
    }).catch(() => { if (this.frame === frame) this.status('פקדי הנגן זמינים בתוך הסרטון. אפשר גם לעבור לסרטון הבא.'); });
  }
  stateChange(value) {
    this.syncChannel();
    if (value === 1) {
      const playingItem = this.items[this.index]?.channelId ? this.activeItem : this.items[this.index];
      if (!this.canPlay() || this.hidden?.has(playingItem?.id)) { this.suspend(); return; }
      clearTimeout(this.startTimer);
      this.playing = true; this.intent = true; this.status('מתנגן עכשיו · גלילה ממשיכה לסרטון הבא');
      const item = this.items[this.index]?.channelId ? this.activeItem : this.items[this.index];
      if (item && !this.recorded.has(item.id)) { this.recorded.add(item.id); this.callbacks.onPlay?.(item); }
    } else if (value === 2) { this.playing = false; if (!this.suspended) this.intent = false; }
    else if (value === 3) this.status('טוענים את הווידאו…');
    else if (value === 0) {
      this.playing = false;
      if (this.items[this.index]?.channelId && !this.autoNext && !this.heldAtEnd) { this.heldAtEnd = true; this.intent = false; this.player?.stopVideo?.(); }
      if (this.autoNext && this.canPlay() && this.index < this.items.length - 1) this.navigate(1);
      else this.status(this.index === this.items.length - 1 ? 'הגעת לסוף העדכונים. אפשר לעדכן את הפיד או לצפות שוב.' : 'הסרטון הסתיים. גוללים וממשיכים.');
    }
    this.updateControls();
  }
  syncChannel() {
    const channel = this.items[this.index];
    if (!channel?.channelId || !this.player) return;
    const id = videoId(this.player.getVideoUrl?.() || '');
    if (id) {
      const frameTitle = this.frame?.title || '';
      const title = frameTitle && !/YouTube —|YouTube video player/i.test(frameTitle) ? frameTitle : 'סרטון מערוץ ' + channel.artist;
      this.activeItem = normalizeTrack({ source: 'youtube', videoId: id, artist: channel.artist, title, artwork: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, tags: ['עדכוני ערוץ'] });
      const known = this.callbacks.onItem?.(this.activeItem);
      if (known?.id === this.activeItem.id) this.activeItem = known;
      const slide = this.root.querySelectorAll('.watch-slide')[this.index];
      for (const button of slide.querySelectorAll('[data-watch-action]')) {
        button.dataset.id = this.activeItem.id; button.disabled = false;
        button.setAttribute('aria-label', ({ like: 'אהבתי את ', save: 'שמירת ', menu: 'אפשרויות עבור ' }[button.dataset.watchAction] || '') + this.activeItem.title);
      }
      slide.querySelector('.watch-caption h3').textContent = this.activeItem.title;
      this.syncActions(this.likes || [], this.saved || []);
      this.suppressHidden();
    } else { this.activeItem = null; for (const button of this.root.querySelectorAll('.watch-slide')[this.index].querySelectorAll('[data-watch-action]')) button.disabled = true; }
    const playlist = this.player.getPlaylist?.();
    if (!Array.isArray(playlist) || !playlist.length) return;
    const clips = [...new Set(playlist.filter(id => typeof id === 'string' && /^[\w-]{11}$/.test(id)))].slice(0, 100).map(id => normalizeTrack({ source: 'youtube', videoId: id, artist: channel.artist, title: 'סרטון מערוץ ' + channel.artist, artwork: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, tags: ['עדכוני ערוץ'] }));
    const signature = clips.map(x => x.id).join(',');
    if (clips.length && this.discoveredChannels.get(channel.channelId) !== signature) { this.discoveredChannels.set(channel.channelId, signature); this.callbacks.onDiscover?.(clips); }
  }
  suppressHidden() {
    if (!this.activeItem || !this.hidden?.has(this.activeItem.id)) return;
    this.intent = false; this.playing = false;
    if (this.suppressedId !== this.activeItem.id) { this.suppressedId = this.activeItem.id; this.player?.pauseVideo?.(); this.navigate(1); }
    this.status('הסרטון הוסתר. ממשיכים לסרטון הבא.');
  }
  status(message, error = false) { const node = this.root.querySelector('.watch-status'); if (node) { node.textContent = message; node.classList.toggle('watch-error', error); } }
  updateControls() {
    const counter = this.root.querySelector('.watch-counter'); if (counter) counter.textContent = `${this.index + 1} / ${this.items.length}`;
    const prev = this.root.querySelector('[data-watch-action="previous"]'), next = this.root.querySelector('[data-watch-action="next"]');
    if (prev) prev.disabled = this.index <= 0; if (next) next.disabled = this.index >= this.items.length - 1;
    const mute = this.root.querySelector('.watch-mute'); if (mute) { mute.textContent = this.muted ? '♫ הפעלת צליל' : '⊘ השתקה'; mute.setAttribute('aria-pressed', String(this.muted)); }
    const play = this.root.querySelector('.watch-play'); if (play) { play.textContent = this.playing ? 'Ⅱ השהיה' : '▶ ניגון'; play.setAttribute('aria-label', this.playing ? 'השהיית הפיד' : 'ניגון הפיד'); }
  }
  focusIndex(index) {
    if (!this.viewport || !this.items.length) return;
    const target = Math.min(this.items.length - 1, Math.max(0, index));
    this.viewport.scrollTo({ top: target * this.viewport.clientHeight, behavior: this.reducedMotion ? 'auto' : 'smooth' });
  }
  navigate(delta) { this.focusIndex(this.index + delta); }
  togglePlay() {
    this.heldAtEnd = false;
    this.intent = !this.playing;
    if (this.playing) this.player?.pauseVideo?.(); else if (!this.player) this.activate(this.index, true); else this.player.playVideo();
  }
  toggleMute() { this.muted = !this.muted; if (this.muted) this.player?.mute?.(); else { this.player?.unMute?.(); this.intent = true; this.player?.playVideo?.(); } this.updateControls(); }
  suspend() { this.suspended = true; this.player?.pauseVideo?.(); this.playing = false; this.updateControls(); }
  syncVisibility() {
    if (!this.canPlay()) this.suspend();
    else if (this.suspended) { this.suspended = false; if (this.intent) this.player?.playVideo?.(); }
  }
  pause() { this.intent = false; this.player?.pauseVideo?.(); this.playing = false; this.updateControls(); }
  destroyFrame() { clearTimeout(this.startTimer); const player = this.player, frame = this.frame; this.player = null; this.frame = null; this.playing = false; try { player?.destroy?.(); } catch { /* The iframe may already have been removed. */ } finally { frame?.remove(); } }
  hide() { closePlayerSize(this.root); this.root.hidden = true; this.destroyFrame(); this.resizeObserver?.disconnect(); }
  click(event) {
    const button = event.target.closest('[data-watch-action]'); if (!button || button.disabled) return;
    const action = button.dataset.watchAction;
    if (action === 'next' || action === 'previous') this.navigate(action === 'next' ? 1 : -1);
    else if (action === 'toggle') this.togglePlay();
    else if (action === 'mute') this.toggleMute();
    else if (action === 'expand') togglePlayerSize(this.root);
    else this.callbacks[action]?.(button.dataset.id);
  }
}
