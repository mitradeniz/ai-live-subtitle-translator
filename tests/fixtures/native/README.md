# Native caption fixture

All caption text and fixture code are original synthetic test material, distributed
under the repository MIT license. The silent 24-second WebM is a generated FFmpeg
test pattern, with no third-party footage, audio, account data, or transcripts.
The binary is committed so testing needs no media tool or download.

To reproduce the media using FFmpeg with libvpx:

```sh
ffmpeg -f lavfi -i 'testsrc2=size=640x360:rate=15:duration=24' -an -c:v libvpx-vp9 -crf 45 -b:v 0 -threads 2 tests/fixtures/native/pattern.webm
```

From the repository root, `pnpm fixture` serves only these fixed fixture files at
http://127.0.0.1:4173. It binds to loopback, supports media range requests, and has no
external resources. This is a local test tool, not a project backend. Stop with Ctrl+C.
