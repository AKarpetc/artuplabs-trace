import ArchiveBoxModule from '@atlaskit/icon/core/archive-box';
import AttachmentModule from '@atlaskit/icon/core/attachment';
import BookModule from '@atlaskit/icon/core/book-with-bookmark';
import CheckCircleModule from '@atlaskit/icon/core/check-circle';
import ChevronDownModule from '@atlaskit/icon/core/chevron-down';
import ChevronRightModule from '@atlaskit/icon/core/chevron-right';
import CopyModule from '@atlaskit/icon/core/copy';
import DeleteModule from '@atlaskit/icon/core/delete';
import DownloadModule from '@atlaskit/icon/core/download';
import FolderClosedModule from '@atlaskit/icon/core/folder-closed';
import GlobeModule from '@atlaskit/icon/core/globe';
import ImageModule from '@atlaskit/icon/core/image';
import LibraryModule from '@atlaskit/icon/core/library';
import MarkdownModule from '@atlaskit/icon/core/markdown';
import PageModule from '@atlaskit/icon/core/page';
import PagesModule from '@atlaskit/icon/core/pages';
import QuestionCircleModule from '@atlaskit/icon/core/question-circle';
import RefreshModule from '@atlaskit/icon/core/refresh';
import StopwatchModule from '@atlaskit/icon/core/stopwatch';
import TreeModule from '@atlaskit/icon/core/tree';
import UploadModule from '@atlaskit/icon/core/upload';
import WarningModule from '@atlaskit/icon/core/warning';

/**
 * Returns the icon component from an `@atlaskit/icon/core/*` import: those files are CommonJS,
 * and under `"type": "module"` the bundler hands over `module.exports` instead of its default.
 */
export function glyph(mod) {
  return typeof mod === 'function' || mod == null ? mod : mod.default;
}

export const ArchiveBoxIcon = glyph(ArchiveBoxModule);
export const AttachmentIcon = glyph(AttachmentModule);
export const BookIcon = glyph(BookModule);
export const CheckCircleIcon = glyph(CheckCircleModule);
export const ChevronDownIcon = glyph(ChevronDownModule);
export const ChevronRightIcon = glyph(ChevronRightModule);
export const CopyIcon = glyph(CopyModule);
export const DeleteIcon = glyph(DeleteModule);
export const DownloadIcon = glyph(DownloadModule);
export const FolderClosedIcon = glyph(FolderClosedModule);
export const GlobeIcon = glyph(GlobeModule);
export const ImageIcon = glyph(ImageModule);
export const LibraryIcon = glyph(LibraryModule);
export const MarkdownIcon = glyph(MarkdownModule);
export const PageIcon = glyph(PageModule);
export const PagesIcon = glyph(PagesModule);
export const QuestionCircleIcon = glyph(QuestionCircleModule);
export const RefreshIcon = glyph(RefreshModule);
export const StopwatchIcon = glyph(StopwatchModule);
export const TreeIcon = glyph(TreeModule);
export const UploadIcon = glyph(UploadModule);
export const WarningIcon = glyph(WarningModule);
