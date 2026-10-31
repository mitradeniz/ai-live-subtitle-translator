// Original synthetic data. Only the narrow observed player contract is reproduced.
const player = document.querySelector('#movie_player');
const nativeOpen = XMLHttpRequest.prototype.open;
const nativeFetch = window.fetch;
let track = { languageCode: 'en', kind: '', vss_id: '.en' };
player.getOption = (module, option) =>
  module === 'captions' && option === 'track' ? track : undefined;
let response;
player.getPlayerResponse = () => response;
player.getOptions = () => (response ? ['reload'] : []);
player.setOption = (module, option) => {
  if (module === 'captions' && option === 'reload')
    void window.fixture.loadCaptions();
};
window.fixture = {
  restored() {
    return (
      XMLHttpRequest.prototype.open === nativeOpen &&
      window.fetch === nativeFetch
    );
  },
  loadCaptions(transport = 'xhr', override) {
    const selected =
      response?.captions.playerCaptionsTracklistRenderer.captionTracks.find(
        (item) => item.vssId === track.vss_id,
      );
    if (!selected) return Promise.resolve(null);
    const url = new URL(override ?? selected.baseUrl);
    url.searchParams.set('fmt', 'json3');
    url.searchParams.set('player', '1');
    if (transport === 'fetch') return fetch(url).then((r) => r.text());
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url);
      xhr.onload = () => resolve(xhr.responseText);
      xhr.onerror = () => resolve(null);
      xhr.send();
    });
  },
  timed(value) {
    response = value;
  },
  source(value) {
    track = value;
  },
  text(value) {
    document.querySelector('.ytp-caption-segment').textContent = value;
  },
  cc(value) {
    document
      .querySelector('.ytp-subtitles-button')
      .setAttribute('aria-pressed', String(value));
  },
  next() {
    document.dispatchEvent(new Event('yt-navigate-start'));
    history.pushState({}, '', '/watch?v=synthetic-next');
  },
  replace() {
    const old = document.querySelector('video');
    old.replaceWith(old.cloneNode(true));
  },
};
