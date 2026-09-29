import { Backdrop, IllustrationFrame, Sheet, fill, stroke } from './parts.jsx';

/** Decorative illustration of a locked document, for missing licence or access. */
export function LockIllustration({ size = 120 }) {
  return (
    <IllustrationFrame size={size}>
      <Backdrop accent="orange" />
      <Sheet x={33} y={24} accent="orange" />
      <rect x="64" y="64" width="32" height="36" rx="8" style={fill('elevation.surface')} />
      <path d="M73 79v-6a7 7 0 0 1 14 0v6" style={stroke('color.icon.subtle', 3.5)} />
      <rect x="67" y="78" width="26" height="20" rx="5" style={fill('color.background.accent.orange.bolder')} />
      <circle cx="80" cy="86" r="2.8" style={fill('color.icon.inverse')} />
      <rect x="78.8" y="87" width="2.4" height="5.5" rx="1.2" style={fill('color.icon.inverse')} />
    </IllustrationFrame>
  );
}
