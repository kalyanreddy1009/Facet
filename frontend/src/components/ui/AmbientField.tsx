/**
 * The light a cut stone sits in.
 *
 * Facet's whole subject is a gemstone: one rough, many facets. So the app's
 * background is the thing that makes a cut stone visible in the first place —
 * light moving slowly across it, and the faint geometry of the cut underneath.
 * It is the one decorative element in the interface, and it earns its place by
 * being what every translucent surface above it is translucent *to*. Without
 * it the glass has nothing to show and reads as muddy grey.
 *
 * A server component with no JavaScript at all: three drifting lights on
 * composited layers, a lattice made of repeating gradients, a grain tile the
 * browser generates from inline SVG, and a vignette. No canvas, no
 * requestAnimationFrame, no image request. It costs one paint and then
 * nothing. `prefers-reduced-motion` stops the drift and
 * `prefers-reduced-transparency` removes the layer entirely — both handled in
 * `globals.css` so the rules live next to the ones they override.
 */
export default function AmbientField() {
  return (
    <div className="ambient" aria-hidden>
      <div className="ambient-glow ambient-glow-a" />
      <div className="ambient-glow ambient-glow-b" />
      <div className="ambient-glow ambient-glow-c" />
      <div className="ambient-lattice" />
      <div className="ambient-grain" />
      <div className="ambient-vignette" />
    </div>
  );
}
