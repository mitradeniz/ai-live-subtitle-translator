// The A/文 mark used on in-page glass buttons. Built with DOM APIs (no markup
// strings) so it can be inserted into closed page contexts safely.
const SVG = 'http://www.w3.org/2000/svg';
const STROKES: readonly (readonly [string, string, string])[] = [
  ['M44 8.5v3.5', '#c8ecff', '4.6'],
  ['M33 17h22', '#c8ecff', '4.6'],
  ['M37.5 18.5c1.8 8.6 7.4 15.2 16.5 19.4', '#cfc4ff', '4.6'],
  ['M50.8 18.5c-2.4 9-8 15.6-17.2 19.8', '#cfc4ff', '4.6'],
  ['M10 55 20 30l10 25', '#ffffff', '5.4'],
  ['M13.8 47h12.4', '#ffffff', '5.4'],
];

export function createMark(size: number): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const [d, stroke, width] of STROKES) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', stroke);
    path.setAttribute('stroke-width', width);
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);
  }
  return svg;
}
