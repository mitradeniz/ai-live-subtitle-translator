const video = () => document.querySelector('video');
const on = (id, handler) =>
  document.getElementById(id).addEventListener('click', handler);
on('play', () => {
  if (video().paused) void video().play();
  else video().pause();
});
on('back', () => {
  video().currentTime = Math.max(0, video().currentTime - 5);
});
on('forward', () => {
  video().currentTime = Math.min(23.9, video().currentTime + 5);
});
document.getElementById('speed').addEventListener('change', (event) => {
  video().playbackRate = Number(event.target.value);
});
on(
  'fullscreen',
  () => void document.getElementById('player').requestFullscreen(),
);
on('native-fullscreen', () => void video().requestFullscreen());
on('replace-track', () => {
  const track = document.createElement('track');
  track.kind = 'subtitles';
  track.label = 'Replacement';
  track.srclang = 'en';
  track.src = '/replacement.vtt';
  track.default = true;
  video().querySelector('track')?.replaceWith(track);
  track.track.mode = 'showing';
});
on('revise', () => {
  const cue = video().textTracks[0]?.cues?.[0];
  if (cue) cue.text = 'Revised first cue.';
});
on('replace-video', () => {
  const old = video();
  old.pause();
  old.replaceWith(old.cloneNode(true));
  document.getElementById('result').textContent =
    'Video replaced. Enable captions again.';
});
on('navigate', () => {
  history.pushState({}, '', `/?scene=${Date.now()}`);
  document.getElementById('result').textContent =
    'Navigated. The overlay should stop; enable again to resume.';
});
setInterval(() => {
  document.getElementById('time').textContent =
    `${video().currentTime.toFixed(1)} / 24.0 seconds`;
}, 100);
