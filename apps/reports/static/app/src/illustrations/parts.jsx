import { token } from '@atlaskit/tokens';

/** Inline style that fills an SVG shape with a design token. */
export const fill = (name) => ({ fill: token(name) });

/** Inline style that strokes an SVG shape with a design token and no fill. */
export const stroke = (name, width = 3) => ({ fill: 'none', stroke: token(name), strokeWidth: width, strokeLinecap: 'round', strokeLinejoin: 'round' });

/** Decorative 120×120 SVG canvas scaled to `size` pixels. */
export function IllustrationFrame({ size = 120, children }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden="true" focusable="false" role="presentation">
      {children}
    </svg>
  );
}

/** Soft circular backdrop tinted with an accent colour. */
export function Backdrop({ accent }) {
  return <circle cx="60" cy="60" r="54" style={fill(`color.background.accent.${accent}.subtlest`)} />;
}

/** A document sheet with a folded corner and text bars tinted with an accent colour. */
export function Sheet({ x, y, accent, width = 50, height = 64 }) {
  const fold = 12;
  const right = x + width;
  const bottom = y + height;
  const outline = `M${x + 6} ${y}H${right - fold}L${right} ${y + fold}V${bottom - 6}A6 6 0 0 1 ${right - 6} ${bottom}H${x + 6}A6 6 0 0 1 ${x} ${bottom - 6}V${y + 6}A6 6 0 0 1 ${x + 6} ${y}Z`;
  const bars = [[0, 0.62, 'subtle'], [12, 0.8, 'subtler'], [20, 0.66, 'subtler'], [28, 0.74, 'subtler'], [36, 0.5, 'subtler']];
  return (
    <g>
      <path d={outline} style={{ ...fill('elevation.surface.raised'), stroke: token('color.border.bold'), strokeWidth: 1.5 }} />
      <path d={`M${right - fold} ${y}V${y + fold - 3}A3 3 0 0 0 ${right - fold + 3} ${y + fold}H${right}`} style={{ ...fill(`color.background.accent.${accent}.subtler`), stroke: token('color.border.bold'), strokeWidth: 1.5, strokeLinejoin: 'round' }} />
      {bars.map(([dy, share, tone]) => (
        <rect key={dy} x={x + 8} y={y + 14 + dy} width={(width - 16) * share} height={dy === 0 ? 6 : 4} rx="2" style={fill(`color.background.accent.${accent}.${tone}`)} />
      ))}
    </g>
  );
}

/** A filled round badge with a stroked glyph path drawn on top. */
export function Badge({ cx, cy, r = 15, background, glyph }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r + 3} style={fill('elevation.surface')} />
      <circle cx={cx} cy={cy} r={r} style={fill(background)} />
      <path d={glyph} style={stroke('color.icon.inverse', 3)} />
    </g>
  );
}
