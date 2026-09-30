import AttachmentModule from '@atlaskit/icon/core/attachment';
import CheckCircleModule from '@atlaskit/icon/core/check-circle';
import ChevronDownModule from '@atlaskit/icon/core/chevron-down';
import ChevronRightModule from '@atlaskit/icon/core/chevron-right';
import CopyModule from '@atlaskit/icon/core/copy';
import DeleteModule from '@atlaskit/icon/core/delete';
import DownloadModule from '@atlaskit/icon/core/download';
import DragHandleModule from '@atlaskit/icon/core/drag-handle-vertical';
import EditModule from '@atlaskit/icon/core/edit';
import FileModule from '@atlaskit/icon/core/file';
import FilesModule from '@atlaskit/icon/core/files';
import FilterModule from '@atlaskit/icon/core/filter';
import FolderClosedModule from '@atlaskit/icon/core/folder-closed';
import ImageModule from '@atlaskit/icon/core/image';
import PageModule from '@atlaskit/icon/core/page';
import PagesModule from '@atlaskit/icon/core/pages';
import RefreshModule from '@atlaskit/icon/core/refresh';
import SettingsModule from '@atlaskit/icon/core/settings';
import StopwatchModule from '@atlaskit/icon/core/stopwatch';
import TableModule from '@atlaskit/icon/core/table';
import UploadModule from '@atlaskit/icon/core/upload';
import WarningModule from '@atlaskit/icon/core/warning';

/**
 * Returns the icon component from an `@atlaskit/icon/core/*` import: those files are CommonJS,
 * and under `"type": "module"` the bundler hands over `module.exports` instead of its default.
 */
export function glyph(mod) {
  return typeof mod === 'function' || mod == null ? mod : mod.default;
}

export const AttachmentIcon = glyph(AttachmentModule);
export const CheckCircleIcon = glyph(CheckCircleModule);
export const ChevronDownIcon = glyph(ChevronDownModule);
export const ChevronRightIcon = glyph(ChevronRightModule);
export const CopyIcon = glyph(CopyModule);
export const DeleteIcon = glyph(DeleteModule);
export const DownloadIcon = glyph(DownloadModule);
export const DragHandleIcon = glyph(DragHandleModule);
export const EditIcon = glyph(EditModule);
export const FileIcon = glyph(FileModule);
export const FilesIcon = glyph(FilesModule);
export const FilterIcon = glyph(FilterModule);
export const FolderClosedIcon = glyph(FolderClosedModule);
export const ImageIcon = glyph(ImageModule);
export const PageIcon = glyph(PageModule);
export const PagesIcon = glyph(PagesModule);
export const RefreshIcon = glyph(RefreshModule);
export const SettingsIcon = glyph(SettingsModule);
export const StopwatchIcon = glyph(StopwatchModule);
export const TableIcon = glyph(TableModule);
export const UploadIcon = glyph(UploadModule);
export const WarningIcon = glyph(WarningModule);
