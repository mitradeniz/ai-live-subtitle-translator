// Decorative pointer highlight for glass surfaces in extension pages. It only
// sets two CSS custom properties on the hovered surface; styles.css draws the
// glow. Skipped when the user prefers reduced motion.
const GLASS = '.glass-panel, .page-card, .caption-section, .provider-card';

export function trackSpecular(root: Document = document) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let frame = 0;
  let last: PointerEvent | undefined;
  root.addEventListener(
    'pointermove',
    (event) => {
      last = event;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const target =
          last?.target instanceof Element
            ? last.target.closest<HTMLElement>(GLASS)
            : null;
        if (!last || !target) return;
        const rect = target.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        target.style.setProperty(
          '--mx',
          `${((last.clientX - rect.left) / rect.width) * 100}%`,
        );
        target.style.setProperty(
          '--my',
          `${((last.clientY - rect.top) / rect.height) * 100}%`,
        );
      });
    },
    { passive: true },
  );
}
