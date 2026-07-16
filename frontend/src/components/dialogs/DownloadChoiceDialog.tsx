import { Package, Smartphone, X } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useText } from '@/lib/text';
import { type WorkshopItem } from '@/lib/api';

export function DownloadChoiceDialog({
  item,
  onOpenChange,
  onPkgDownload,
  onMpkgDownload,
}: {
  item: WorkshopItem | null;
  onOpenChange: (open: boolean) => void;
  onPkgDownload: (item: WorkshopItem) => void;
  onMpkgDownload: (item: WorkshopItem) => void;
}) {
  const text = useText();
  return (
    <Dialog open={!!item} onOpenChange={onOpenChange} fixedHeight={false} fitContent title={text.downloadChoiceTitle} className="w-[min(420px,calc(100vw-1rem))]" bodyClassName="p-3 sm:p-4">
      {item ? (
        <div className="grid gap-2">
          <Button className="h-10 w-full justify-start" variant="outline" onClick={() => onPkgDownload(item)}>
            <Package className="h-4 w-4" />
            {text.downloadPkgSource}
          </Button>
          <Button className="h-10 w-full justify-start" onClick={() => onMpkgDownload(item)}>
            <Smartphone className="h-4 w-4" />
            {text.downloadMpkgMobile}
          </Button>
          <Button className="h-10 w-full justify-start" variant="secondary" onClick={() => onOpenChange(false)}>
            <X className="h-4 w-4" />
            {text.close}
          </Button>
        </div>
      ) : null}
    </Dialog>
  );
}
