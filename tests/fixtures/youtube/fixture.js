// Original synthetic data. Only the narrow observed player contract is reproduced.
const player = document.querySelector('#movie_player');
let track = { languageCode: 'en', kind: '', vss_id: '.en' };
player.getOption = (module, option) =>
  module === 'captions' && option === 'track' ? track : undefined;
window.fixture = {
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
