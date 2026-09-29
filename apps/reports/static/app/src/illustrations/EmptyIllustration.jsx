import { token } from '@atlaskit/tokens';
import { Backdrop, IllustrationFrame, fill } from './parts.jsx';

/** Decorative illustration of an empty folder, for states with nothing to show. */
export function EmptyIllustration({ size = 120 }) {
  return (
    <IllustrationFrame size={size}>
      <Backdrop accent="gray" />
      <path d="M24 40a6 6 0 0 1 6-6h17l6 7h37a6 6 0 0 1 6 6v36a6 6 0 0 1-6 6H30a6 6 0 0 1-6-6z" style={fill('color.background.accent.gray.subtle')} />
      <rect x="38" y="30" width="44" height="34" rx="4" style={{ ...fill('elevation.surface.raised'), stroke: token('color.border.bold'), strokeWidth: 1.5, strokeDasharray: '4 3' }} />
      <path d="M21 56a5 5 0 0 1 5-5h68a5 5 0 0 1 5 5l-3.2 28a6 6 0 0 1-6 5.4H30.2a6 6 0 0 1-6-5.4z" style={fill('color.background.accent.gray.subtler')} />
      <rect x="48" y="66" width="24" height="4" rx="2" style={fill('color.background.accent.gray.subtle')} />
      <circle cx="96" cy="30" r="3" style={fill('color.background.accent.gray.subtle')} />
      <circle cx="22" cy="28" r="2" style={fill('color.background.accent.gray.subtle')} />
    </IllustrationFrame>
  );
}
