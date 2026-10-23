export async function togglePlayerSize(root) {
  if (document.fullscreenElement === root) { await document.exitFullscreen(); return; }
  if (root.classList.contains('expanded-player')) { closePlayerSize(root); return; }
  try {
    if (!root.requestFullscreen) throw new Error('Fullscreen unavailable');
    await root.requestFullscreen();
  } catch {
    root.classList.add('expanded-player'); document.body.classList.add('player-expanded');
  }
}
export function closePlayerSize(root) {
  if (!root.classList?.contains('expanded-player') && !(typeof document !== 'undefined' && document.fullscreenElement === root)) return;
  root.classList.remove('expanded-player');
  if (!document.querySelector('.expanded-player')) document.body.classList.remove('player-expanded');
  if (document.fullscreenElement === root) document.exitFullscreen().catch(() => {});
}
