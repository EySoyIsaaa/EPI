import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { TranslateFn } from "@/components/home/types";

interface HomeAutoModeModalProps {
  isOpen: boolean;
  t: TranslateFn;
  title: string;
  description: string;
  enableLabel: string;
  applyLabel: string;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onClose: () => void;
  onApplyNow: () => void;
}

export function HomeAutoModeModal({
  isOpen,
  t: _t,
  title,
  description,
  enableLabel,
  applyLabel,
  enabled,
  onEnabledChange,
  onClose,
  onApplyNow,
}: HomeAutoModeModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="bg-zinc-900 rounded-2xl p-6 w-full max-w-md border border-zinc-800 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold">{title}</h3>
            <p className="text-sm text-zinc-400 mt-1">{description}</p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex items-center justify-between p-3 bg-zinc-800/50 rounded-xl">
          <p className="text-sm text-zinc-300">{enableLabel}</p>
          <Switch checked={enabled} onCheckedChange={onEnabledChange} />
        </div>
        <Button
          onClick={onApplyNow}
          className="w-full bg-white text-black hover:bg-zinc-200"
        >
          {applyLabel}
        </Button>
      </div>
    </div>
  );
}

export default HomeAutoModeModal;
