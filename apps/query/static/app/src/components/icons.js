import CheckCircleModule from '@atlaskit/icon/core/check-circle';
import CopyModule from '@atlaskit/icon/core/copy';
import RefreshModule from '@atlaskit/icon/core/refresh';
import SettingsModule from '@atlaskit/icon/core/settings';
import WarningModule from '@atlaskit/icon/core/warning';

/**
 * Returns the icon component from an `@atlaskit/icon/core/*` import: those files are CommonJS,
 * and under `"type": "module"` the bundler hands over `module.exports` instead of its default.
 */
export function glyph(mod) {
  return typeof mod === 'function' || mod == null ? mod : mod.default;
}

export const CheckCircleIcon = glyph(CheckCircleModule);
export const CopyIcon = glyph(CopyModule);
export const RefreshIcon = glyph(RefreshModule);
export const SettingsIcon = glyph(SettingsModule);
export const WarningIcon = glyph(WarningModule);
