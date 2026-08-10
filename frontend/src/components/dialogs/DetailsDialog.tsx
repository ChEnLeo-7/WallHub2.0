import { Dialog } from '@/components/ui/dialog';
import { DetailsActions } from './details-dialog/DetailsActions';
import { DetailsComments } from './details-dialog/DetailsComments';
import { DetailsHeader } from './details-dialog/DetailsHeader';
import { DetailsMetadata } from './details-dialog/DetailsMetadata';
import type { DetailsDialogProps } from './details-dialog/types';
import { useDetailsDialogController } from './details-dialog/useDetailsDialogController';

export function DetailsDialog(props: DetailsDialogProps) {
  const {
    item,
    details,
    loading,
    personalSourceLabel,
    fixedPanelHeight,
    presentation,
    onOpenChange,
    onCopyId,
    onCopyTitle,
    onAuthor,
    onSearchTags,
    onLoadMoreComments,
  } = props;
  const controller = useDetailsDialogController({
    item,
    details,
    loading,
    presentation,
    onLoadMoreComments,
  });
  const { commentsScrollRootRef, isRedesigned, type } = controller;

  return (
    <Dialog
      open={!!item}
      onOpenChange={onOpenChange}
      fixedHeight={fixedPanelHeight}
      closeButtonClassName="right-3 top-3 sm:right-5 sm:top-4"
      title={(
        <DetailsHeader
          controller={controller}
          personalSourceLabel={personalSourceLabel}
          onCopyId={onCopyId}
          onCopyTitle={onCopyTitle}
          onAuthor={onAuthor}
        />
      )}
      className={isRedesigned ? 'max-w-4xl rounded-[1.75rem]' : undefined}
      bodyClassName={isRedesigned ? 'p-5 sm:p-7' : undefined}
      footerClassName={isRedesigned ? 'bg-card/45 px-5 py-4 sm:px-7' : undefined}
      bodyRef={commentsScrollRootRef}
      footer={item ? <DetailsActions {...props} item={item} type={type} /> : null}
    >
      <DetailsMetadata controller={controller} loading={loading} onSearchTags={onSearchTags} />
      <DetailsComments controller={controller} loading={loading} />
    </Dialog>
  );
}
