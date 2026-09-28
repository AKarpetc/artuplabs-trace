import AttachmentModule from '@atlaskit/icon/core/attachment';
import FolderClosedModule from '@atlaskit/icon/core/folder-closed';
import ImageModule from '@atlaskit/icon/core/image';
import PageModule from '@atlaskit/icon/core/page';

/**
 * Returns the icon component from an `@atlaskit/icon/core/*` import: those files are CommonJS,
 * and under `"type": "module"` the bundler hands over `module.exports` instead of its default.
 */
export function glyph(mod) {
  return typeof mod === 'function' || mod == null ? mod : mod.default;
}

export const AttachmentIcon = glyph(AttachmentModule);
export const FolderClosedIcon = glyph(FolderClosedModule);
export const ImageIcon = glyph(ImageModule);
export const PageIcon = glyph(PageModule);
