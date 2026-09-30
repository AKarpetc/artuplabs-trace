import { token } from '@atlaskit/tokens';
import { fill } from './parts.jsx';

/** ArtUp Reports mark (sheet with a table and a download badge) drawn with brand tokens; decorative. */
export function AppIcon({ size = 32 }) {
  const mark = { fill: 'none', stroke: token('color.icon.inverse'), strokeLinecap: 'round', strokeLinejoin: 'round' };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" role="presentation">
      <path d="M7 1.5h8.6l5.4 5.4V19.5a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-15a3 3 0 0 1 3-3z" style={fill('color.background.brand.bold')} />
      <path d="M15.6 1.5v3.4a2 2 0 0 0 2 2H21" style={{ ...fill('color.icon.inverse'), fillOpacity: 0.35 }} />
      <path d="M7.5 9h7a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1zM6.5 11.5h9M10.8 9v6" style={{ ...mark, strokeWidth: 1.3 }} />
      <circle cx="16.5" cy="18.2" r="3.9" style={fill('color.background.accent.teal.bolder')} />
      <path d="M16.5 16.4v3.4M15.2 18.6l1.3 1.3 1.3-1.3" style={{ ...mark, strokeWidth: 1.2 }} />
    </svg>
  );
}
