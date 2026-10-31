import { MAX_CUES, normalizeCue } from './cues.ts';

const MAX_EXPORT = 512_000;
const stamp = (seconds: number) => {
  const ms = Math.round(seconds * 1000);
  return `${String(Math.floor(ms / 3_600_000)).padStart(2, '0')}:${String(Math.floor(ms / 60_000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
};
// Export only already-loaded source cues. No track loading, signed URL replay,
// provider request, invented timing or partially translated subtitle file.
export function sourceWebVtt(raw: ArrayLike<unknown>): string | null {
  if (!Number.isInteger(raw.length) || raw.length <= 0 || raw.length > MAX_CUES)
    return null;
  let output = 'WEBVTT\n\n';
  for (let i = 0; i < raw.length; i++) {
    const cue = normalizeCue(raw[i]);
    if (
      !cue ||
      cue.end > 604_800 ||
      Math.round(cue.end * 1000) <= Math.round(cue.start * 1000)
    )
      return null;
    const text = cue.text
      .replaceAll('\0', '')
      .trim()
      .replace(/\n\s*\n/g, '\n')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    if (!text) return null;
    output += `${i + 1}\n${stamp(cue.start)} --> ${stamp(cue.end)}\n${text}\n\n`;
    if (output.length > MAX_EXPORT) return null;
  }
  return output;
}
export function nativeSourceWebVtt(video: HTMLVideoElement): string | null {
  const tracks = Array.from(video.textTracks)
    .slice(0, 32)
    .filter(
      (track) =>
        ['captions', 'subtitles'].includes(track.kind) &&
        track.mode !== 'disabled' &&
        !!track.cues?.length,
    );
  const showing = tracks.filter((track) => track.mode === 'showing');
  const track =
    showing.length === 1 ? showing[0] : tracks.length === 1 ? tracks[0] : null;
  return track?.cues ? sourceWebVtt(track.cues) : null;
}
