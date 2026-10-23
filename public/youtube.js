import { YOUTUBE_CHANNELS } from './discovery.js';
let ready;

export function loadYouTubeAPI() {
  if (window.YT?.Player) return Promise.resolve();
  if (ready) return ready;
  ready = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api'; script.id = 'youtube-api-script';
    const fail = message => { clearTimeout(timer); script.remove(); ready = null; reject(new Error(message)); };
    const timer = setTimeout(() => fail('נגן YouTube לא נטען. בדוק חיבור או סינון של YouTube.'), 12000);
    window.onYouTubeIframeAPIReady = () => { clearTimeout(timer); resolve(); };
    script.onerror = () => fail('לא ניתן לטעון את הנגן הרשמי של YouTube.');
    document.head.append(script);
  });
  return ready;
}

export function youtubeEmbedURL(videoId, origin, autoplay = true) {
  if (!/^[\w-]{11}$/.test(videoId)) throw new Error('מזהה סרטון אינו תקין');
  const url = new URL('https://www.youtube-nocookie.com/embed/' + videoId);
  url.search = new URLSearchParams({ enablejsapi: '1', origin, autoplay: autoplay ? '1' : '0', mute: '1', playsinline: '1', controls: '1', rel: '0' });
  return url.href;
}

export function channelEmbedURL(channelId, origin, autoplay = true) {
  if (!YOUTUBE_CHANNELS.some(channel => channel.id === channelId && channel.embeddedUploads)) throw new Error('ערוץ אינו נתמך');
  const url = new URL('https://www.youtube-nocookie.com/embed/videoseries');
  url.search = new URLSearchParams({ listType: 'playlist', list: 'UU' + channelId.slice(2), enablejsapi: '1', origin, autoplay: autoplay ? '1' : '0', mute: '1', playsinline: '1', controls: '1', rel: '0' });
  return url.href;
}
