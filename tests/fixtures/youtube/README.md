# Synthetic YouTube player contract

Original MIT-licensed fixture code and captions; no copied transcripts, signed URLs,
account state, or player code. The `#movie_player`, `.ytp-subtitles-button`,
`.ytp-caption-window-container` and `getOption('captions', 'track')` structure was
observed on public watch pages. `.ytp-caption-segment` is an unstable caption-renderer
selector; real caption delivery was unavailable in the investigation environment.

The browser test serves this fixture through Playwright routing at a synthetic
YouTube watch URL and blocks all other network requests. Media is the repository's
original generated pattern. This tests adapter behavior, not YouTube availability.
