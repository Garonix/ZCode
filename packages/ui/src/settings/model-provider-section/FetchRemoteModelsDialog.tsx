import { useMemo, useState, useEffect } from "react";
import { Loader2Icon, SearchIcon, CheckSquareIcon, SquareIcon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Input } from "@/components/ui/input.js";
import { Checkbox } from "@/components/ui/checkbox.js";
import { ScrollArea } from "@/components/ui/scroll-area.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { cn } from "@/components/lib/utils.js";

export interface FetchRemoteModelsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  discoveredModels: string[];
  existingModelIds: ReadonlySet<string>;
  onImport: (selectedModelIds: string[]) => Promise<void>;
  isImporting?: boolean;
}

export function FetchRemoteModelsDialog({
  open,
  onOpenChange,
  discoveredModels,
  existingModelIds,
  onImport,
  isImporting = false,
}: FetchRemoteModelsDialogProps) {
  const { intl } = useZCodeIntl();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // 每次打开或获取到新模型时，默认勾选所有尚未添加的模型
  useEffect(() => {
    if (open) {
      setSearchQuery("");
      const initialSelected = new Set<string>();
      for (const modelId of discoveredModels) {
        if (!existingModelIds.has(modelId)) {
          initialSelected.add(modelId);
        }
      }
      setSelectedIds(initialSelected);
    }
  }, [open, discoveredModels, existingModelIds]);

  const filteredModels = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return discoveredModels;
    return discoveredModels.filter((id) => id.toLowerCase().includes(query));
  }, [discoveredModels, searchQuery]);

  const toggleSelect = (modelId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) {
        next.delete(modelId);
      } else {
        next.add(modelId);
      }
      return next;
    });
  };

  const handleSelectAllNew = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of filteredModels) {
        if (!existingModelIds.has(id)) {
          next.add(id);
        }
      }
      return next;
    });
  };

  const handleDeselectAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of filteredModels) {
        next.delete(id);
      }
      return next;
    });
  };

  const selectedCount = selectedIds.size;

  const handleConfirmImport = async () => {
    if (selectedCount === 0 || isImporting) return;
    await onImport(Array.from(selectedIds));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg overflow-hidden sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {intl.formatMessage({ id: "settings.modelProvider.fetchRemoteModels.dialogTitle" })}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {intl.formatMessage({ id: "settings.modelProvider.fetchRemoteModels.dialogDesc" })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-2">
          {/* 搜索与快捷批量选择 */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <SearchIcon className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={intl.formatMessage({
                  id: "settings.modelProvider.fetchRemoteModels.searchPlaceholder",
                })}
                className="pl-8"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleSelectAllNew}
              className="shrink-0 text-xs"
            >
              <CheckSquareIcon className="mr-1 size-3.5" />
              {intl.formatMessage({ id: "settings.modelProvider.fetchRemoteModels.selectAll" })}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleDeselectAll}
              className="shrink-0 text-xs"
            >
              <SquareIcon className="mr-1 size-3.5" />
              {intl.formatMessage({ id: "settings.modelProvider.fetchRemoteModels.deselectAll" })}
            </Button>
          </div>

          {/* 模型列表 */}
          <div className="rounded-md border border-input-border bg-input/50">
            <ScrollArea className="h-64 px-2 py-1">
              {filteredModels.length === 0 ? (
                <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
                  {intl.formatMessage({ id: "settings.modelProvider.fetchRemoteModels.noModels" })}
                </div>
              ) : (
                <div className="space-y-1 p-1">
                  {filteredModels.map((modelId) => {
                    const isExisting = existingModelIds.has(modelId);
                    const isChecked = selectedIds.has(modelId);

                    return (
                      <div
                        key={modelId}
                        onClick={() => toggleSelect(modelId)}
                        className={cn(
                          "flex cursor-pointer items-center justify-between rounded px-2.5 py-1.5 text-sm transition-colors select-none",
                          isChecked
                            ? "bg-primary/10 text-foreground"
                            : "hover:bg-muted text-foreground/80",
                        )}
                      >
                        <div className="flex items-center gap-2.5 overflow-hidden">
                          <Checkbox
                            checked={isChecked}
                            onCheckedChange={() => toggleSelect(modelId)}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <span
                            className={cn(
                              "truncate font-mono text-xs",
                              isExisting && "text-muted-foreground",
                            )}
                            title={modelId}
                          >
                            {modelId}
                          </span>
                        </div>
                        {isExisting && (
                          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {intl.formatMessage({
                              id: "settings.modelProvider.fetchRemoteModels.alreadyExists",
                            })}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isImporting}
          >
            {intl.formatMessage({ id: "common.cancel" })}
          </Button>
          <Button
            type="button"
            variant="default"
            onClick={handleConfirmImport}
            disabled={selectedCount === 0 || isImporting}
          >
            {isImporting && <Loader2Icon className="mr-1.5 size-4 animate-spin" />}
            {intl.formatMessage(
              { id: "settings.modelProvider.fetchRemoteModels.import" },
              { count: selectedCount },
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
