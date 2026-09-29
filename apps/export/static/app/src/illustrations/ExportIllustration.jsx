import { Backdrop, Badge, IllustrationFrame, Sheet } from './parts.jsx';

/** Decorative illustration of stacked pages flowing into a download: the export itself. */
export function ExportIllustration({ size = 120 }) {
  return (
    <IllustrationFrame size={size}>
      <Backdrop accent="blue" />
      <Sheet x={44} y={18} width={44} height={58} accent="purple" />
      <Sheet x={28} y={30} accent="blue" />
      <Badge cx={82} cy={84} background="color.background.brand.bold" glyph="M82 76V91M76 85l6 6 6-6" />
    </IllustrationFrame>
  );
}
