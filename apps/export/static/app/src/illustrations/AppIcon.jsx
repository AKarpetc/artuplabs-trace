import { token } from '@atlaskit/tokens';
import { fill } from './parts.jsx';

/** ArtUp Export mark (document, Markdown arrow, branch) drawn with brand tokens; decorative. */
export function AppIcon({ size = 32 }) {
  const mark = { fill: 'none', stroke: token('color.icon.inverse'), strokeLinecap: 'round', strokeLinejoin: 'round' };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" role="presentation">
      <path d="M7 1.5h8.6l5.4 5.4V19.5a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-15a3 3 0 0 1 3-3z" style={fill('color.background.brand.bold')} />
      <path d="M15.6 1.5v3.4a2 2 0 0 0 2 2H21" style={{ ...fill('color.icon.inverse'), fillOpacity: 0.35 }} />
      <path d="M7.4 13.4V8.2l2.2 2.6 2.2-2.6v5.2M15.1 8.2v5M13.2 11.3l1.9 1.9 1.9-1.9" style={{ ...mark, strokeWidth: 1.5 }} />
      <path d="M14 18.2v-0.4a2.4 2.4 0 0 1 2.4-2.4h0.6" style={{ ...mark, strokeWidth: 1.3 }} />
      <circle cx="14" cy="19.2" r="1.4" style={fill('color.icon.inverse')} />
      <circle cx="17.8" cy="15.4" r="1.4" style={fill('color.icon.inverse')} />
    </svg>
  );
}
