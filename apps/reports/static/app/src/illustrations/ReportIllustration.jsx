import { token } from '@atlaskit/tokens';
import { Backdrop, Badge, IllustrationFrame, Sheet, fill } from './parts.jsx';

/** Decorative illustration of a spreadsheet and a document side by side with a download badge: a report. */
export function ReportIllustration({ size = 120 }) {
  return (
    <IllustrationFrame size={size}>
      <Backdrop accent="blue" />
      <Sheet x={50} y={16} width={46} height={58} accent="purple" />
      <rect x="22" y="30" width="46" height="46" rx="6" style={{ ...fill('elevation.surface.raised'), stroke: token('color.border.bold'), strokeWidth: 1.5 }} />
      <rect x="22" y="30" width="46" height="10" rx="5" style={fill('color.background.accent.teal.subtle')} />
      <rect x="22" y="36" width="46" height="4" style={fill('color.background.accent.teal.subtle')} />
      {[47, 58, 69].map((y) => (
        <g key={y}>
          <rect x="27" y={y - 4} width="14" height="5" rx="2" style={fill('color.background.accent.teal.subtler')} />
          <rect x="46" y={y - 4} width="17" height="5" rx="2" style={fill('color.background.accent.teal.subtler')} />
        </g>
      ))}
      <Badge cx={84} cy={84} background="color.background.brand.bold" glyph="M84 76V91M78 85l6 6 6-6" />
    </IllustrationFrame>
  );
}
