import test from 'node:test';
import assert from 'node:assert/strict';
import { CREATOR_PROMO_KEY, CREATOR_PROMO_COOLDOWN, creatorPromoDue, creatorPromoSeconds, claimCreatorPromo, initCreatorPromo } from '../public/creator-promo.js';

const now = 1792700000000;
function storage(initial) {
  const values = new Map(initial === undefined ? [] : [[CREATOR_PROMO_KEY, initial]]);
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test('first entry is eligible and malformed timestamps recover without breaking the app', () => {
  for (const value of [null, '', 'broken', 'NaN', 'Infinity', '-1', '12.5']) assert.equal(creatorPromoDue(value, now), true);
});

test('refreshes and returns stay suppressed until the full five minute boundary', () => {
  assert.equal(creatorPromoDue(String(now), now), false);
  assert.equal(creatorPromoDue(String(now), now + CREATOR_PROMO_COOLDOWN - 1), false);
  assert.equal(creatorPromoDue(String(now), now + CREATOR_PROMO_COOLDOWN), true);
  assert.equal(creatorPromoDue(String(now), now - 1000), false);
});

test('the five second close lock uses elapsed time, including delayed timer callbacks', () => {
  assert.equal(creatorPromoSeconds(100, 100), 5);
  assert.equal(creatorPromoSeconds(100, 1099), 5);
  assert.equal(creatorPromoSeconds(100, 1100), 4);
  assert.equal(creatorPromoSeconds(100, 5099), 1);
  assert.equal(creatorPromoSeconds(100, 5100), 0);
  assert.equal(creatorPromoSeconds(100, 20100), 0);
});

test('recording on display survives a refresh even before the visitor dismisses the promo', () => {
  const local = storage(), session = storage();
  assert.equal(claimCreatorPromo([local, session], now), true);
  assert.equal(local.getItem(CREATOR_PROMO_KEY), String(now));
  assert.equal(session.getItem(CREATOR_PROMO_KEY), String(now));
  assert.equal(claimCreatorPromo([local, session], now + 100), false);
  assert.equal(claimCreatorPromo([local, storage()], now + 100), false);
  assert.equal(claimCreatorPromo([local, session], now + CREATOR_PROMO_COOLDOWN), true);
});

test('a recent timestamp in either storage prevents a duplicate after partial storage failure', () => {
  assert.equal(claimCreatorPromo([storage(), storage(String(now))], now + 5000), false);
  assert.equal(claimCreatorPromo([storage(String(now)), storage()], now + 5000), false);
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const session = storage();
  assert.equal(claimCreatorPromo([blocked, session], now), true);
  assert.equal(claimCreatorPromo([blocked, session], now + 100), false);
});

test('when no storage can persist a timestamp, skip the promo to avoid repeating it on refresh', () => {
  const full = { getItem: () => null, setItem() { throw new Error('quota'); } };
  const silent = { getItem: () => null, setItem() {} };
  assert.equal(claimCreatorPromo([], now), false);
  assert.equal(claimCreatorPromo([full, silent], now), false);
});

test('all dismissal paths remain locked for five seconds, then unlock and restore the page', t => {
  let elapsed = 0, tick, focused = false;
  const buttons = [new EventTarget(), new EventTarget()];
  const elements = Object.fromEntries(['[data-creator-countdown]', '[data-creator-status]', '[data-creator-label]'].map(key => [key, {}]));
  elements['.creator-promo-close'] = buttons[0];
  const classes = new Set();
  const body = { classList: { add: name => classes.add(name), remove: name => classes.delete(name) } };
  const dialog = Object.assign(new EventTarget(), {
    open: false, dataset: {},
    querySelector: key => elements[key], querySelectorAll: () => buttons,
    showModal() { this.open = true; },
    // Native dialog.close() queues its close event; the page must unlock immediately.
    close() { this.open = false; },
    getBoundingClientRect: () => ({ left: 100, top: 100, right: 600, bottom: 600 })
  });
  const doc = Object.assign(new EventTarget(), {
    body, activeElement: body,
    querySelector: () => dialog.open ? dialog : null,
    getElementById: () => ({ focus: () => { focused = true; } })
  });
  const win = Object.assign(new EventTarget(), { localStorage: storage(), sessionStorage: storage() });
  const originals = Object.fromEntries(['window', 'document', 'navigator'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries({ window: win, document: doc, navigator: {} })) Object.defineProperty(globalThis, key, { configurable: true, value });
  t.after(() => {
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  t.mock.method(Date, 'now', () => now + elapsed);
  t.mock.method(performance, 'now', () => elapsed);
  t.mock.method(globalThis, 'setInterval', callback => { tick = callback; return 1; });
  t.mock.method(globalThis, 'clearInterval', () => {});
  initCreatorPromo(dialog);
  assert.equal(dialog.open, true);
  assert.ok(buttons.every(button => button.disabled));
  assert.equal(classes.has('creator-promo-visible'), true);
  for (const type of ['click', 'cancel', 'keydown']) {
    elapsed = 4999;
    const event = new Event(type, { cancelable: true });
    Object.assign(event, type === 'keydown' ? { key: 'Escape' } : { clientX: 0, clientY: 0 });
    dialog.dispatchEvent(event);
    assert.equal(dialog.open, true, type);
    if (type !== 'click') assert.equal(event.defaultPrevented, true, type);
  }
  buttons[0].dispatchEvent(new Event('click'));
  assert.equal(dialog.open, true);
  elapsed = 5000; tick();
  assert.ok(buttons.every(button => !button.disabled));
  assert.equal(dialog.dataset.unlocked, 'true');
  const escape = new Event('keydown', { cancelable: true }); Object.assign(escape, { key: 'Escape' });
  dialog.dispatchEvent(escape);
  assert.equal(dialog.open, false);
  assert.equal(classes.has('creator-promo-visible'), false);
  assert.equal(focused, true);
  dialog.dispatchEvent(new Event('close'));
  assert.equal(classes.has('creator-promo-visible'), false);
  initCreatorPromo(dialog);
  assert.equal(dialog.open, false, 'a second entry during the cooldown must stay closed');
});
