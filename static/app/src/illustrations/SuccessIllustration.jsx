import { Backdrop, Badge, IllustrationFrame, Sheet } from './parts.jsx';

/** Decorative illustration of a finished document with a success check. */
export function SuccessIllustration({ size = 120 }) {
  return (
    <IllustrationFrame size={size}>
      <Backdrop accent="green" />
      <Sheet x={33} y={24} accent="green" />
      <Badge cx={80} cy={82} background="color.background.success.bold" glyph="M73 82.5l5 5 9.5-10" />
    </IllustrationFrame>
  );
}
