import { Clock, Download, Folder, Package, Smartphone, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useText } from '@/lib/text';
import { type WorkshopItem } from '@/lib/api';
import { itemType } from '@/lib/workshop';

export function DownloadChoiceDialog({
  item,
  stage,
  onOpenChange,
  onNormalDownload,
  onPkgDownload,
  onMpkgDownload,
  onMpkgConvertOnly,
  onBackgroundDownload,
}: {
  item: WorkshopItem | null;
  stage: 'start' | 'format';
  onOpenChange: (open: boolean) => void;
  onNormalDownload: (item: WorkshopItem) => void;
  onPkgDownload: (item: WorkshopItem) => void;
  onMpkgDownload: (item: WorkshopItem) => void;
  onMpkgConvertOnly: (item: WorkshopItem) => void;
  onBackgroundDownload: (item: WorkshopItem) => void;
}) {
  const text = useText();
  const reduceMotion = useReducedMotion();
  const type = item ? itemType(item) : '';
  const supportsMpkg = type === 'Scene' || type === 'Video';
  const formatActionClass = '!size-[88px] min-w-0 flex-col gap-0.5 whitespace-normal px-1 py-1.5 text-center text-[10px] leading-3 sm:!size-[96px] sm:gap-1 sm:px-1.5 sm:py-2 sm:text-xs sm:leading-4 [&_svg]:size-9 sm:[&_svg]:size-10';
  const stageFadeEase = [0.23, 1, 0.32, 1] as const;
  const stageEnterTransition = { duration: reduceMotion ? 0.1 : 0.15, ease: stageFadeEase };
  const stageExitTransition = { duration: reduceMotion ? 0.07 : 0.09, ease: stageFadeEase };

  return (
    <Dialog
      open={!!item}
      onOpenChange={onOpenChange}
      fixedHeight={false}
      fitContent
      title={(
        <AnimatePresence initial={false} mode="wait">
          <motion.span
            key={stage}
            className="block"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: stageEnterTransition }}
            exit={{ opacity: 0, transition: stageExitTransition }}
          >
            {stage === 'start' ? text.downloadStartTitle : text.downloadChoiceTitle}
          </motion.span>
        </AnimatePresence>
      )}
      className={stage === 'format' ? 'w-[min(352px,calc(100vw-1rem))]' : 'w-[min(420px,calc(100vw-1rem))]'}
      bodyClassName="p-3 sm:p-4"
    >
      <AnimatePresence initial={false} mode="wait">
        {item ? (
          <motion.div
            key={`${item.publishedfileid || 'download'}-${stage}`}
            className="grid gap-2"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: stageEnterTransition }}
            exit={{ opacity: 0, pointerEvents: 'none', transition: stageExitTransition }}
          >
          {stage === 'start' ? (
            <>
              <Button className="h-10 w-full justify-start" onClick={() => onNormalDownload(item)}>
                <Download className="h-4 w-4" />
                {text.normalDownload}
              </Button>
              <Button className="h-10 w-full justify-start" variant="outline" onClick={() => onBackgroundDownload(item)}>
                <Clock className="h-4 w-4" />
                {text.backgroundDownload}
              </Button>
              <Button className="h-10 w-full justify-start" variant="secondary" onClick={() => onOpenChange(false)}>
                <X className="h-4 w-4" />
                {text.close}
              </Button>
            </>
          ) : (
            <>
              <div className={supportsMpkg ? 'grid grid-cols-[repeat(3,88px)] justify-center gap-1.5 sm:grid-cols-[repeat(3,96px)] sm:gap-2' : 'grid justify-items-center'}>
                <Button className={formatActionClass} variant="outline" onClick={() => onPkgDownload(item)}>
                  <Package />
                  <span>{text.downloadPkgSource}</span>
                  <span className="text-[9px] leading-3 text-muted-foreground sm:text-[10px]">{text.downloadDesktopFormat}</span>
                </Button>
                {supportsMpkg ? (
                  <>
                    <Button className={formatActionClass} onClick={() => onMpkgDownload(item)}>
                      <Smartphone />
                      <span>{text.downloadMpkgMobile}</span>
                      <span className="text-[9px] leading-3 text-primary-foreground/75 sm:text-[10px]">{text.downloadMobileFormat}</span>
                    </Button>
                    <Button className={formatActionClass} variant="outline" onClick={() => onMpkgConvertOnly(item)}>
                      <Folder />
                      <span>{text.mpkgConvertOnly}</span>
                    </Button>
                  </>
                ) : null}
              </div>
              <Button className="justify-self-center" variant="secondary" onClick={() => onOpenChange(false)}>
                <X className="h-4 w-4" />
                {text.cancel}
              </Button>
            </>
          )}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </Dialog>
  );
}
