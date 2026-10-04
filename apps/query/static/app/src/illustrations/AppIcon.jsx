import { token } from '@atlaskit/tokens';
import { fill } from './parts.jsx';

/** ArtUp Query mark (sheet with query lines and a search badge) drawn with purple and magenta accent tokens; decorative. */
export function AppIcon({ size = 32 }) {
  const mark = { fill: 'none', stroke: token('color.icon.inverse'), strokeLinecap: 'round', strokeLinejoin: 'round' };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" role="presentation">
      <path d="M7 1.5h8.6l5.4 5.4V19.5a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-15a3 3 0 0 1 3-3z" style={fill('color.background.accent.purple.bolder')} />
      <path d="M15.6 1.5v3.4a2 2 0 0 0 2 2H21" style={{ ...fill('color.icon.inverse'), fillOpacity: 0.35 }} />
      <path d="M7.5 9h7.5M7.5 11.8h5M7.5 14.6h3" style={{ ...mark, strokeWidth: 1.4 }} />
      <circle cx="16.5" cy="18.2" r="3.9" style={fill('color.background.accent.magenta.bolder')} />
      <circle cx="16" cy="17.7" r="1.4" style={{ ...mark, strokeWidth: 1.2 }} />
      <path d="M17.05 18.75l1.15 1.15" style={{ ...mark, strokeWidth: 1.2 }} />
    </svg>
  );
}
