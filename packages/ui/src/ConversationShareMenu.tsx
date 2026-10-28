import { ShareIcon } from "lucide-react";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { cn } from "@/components/lib/utils.js";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useConversationShareSelectionStore } from "@/store/conversationShareSelectionStore.js";
import { WINDOWS_CAPTION_CONTROL_CLASS } from "@/windowCaptionControls.js";

export function ConversationShareMenu({
  _taskId,
  _useWindowsCaptionSpacing,
}: {
  taskId: string;
  useWindowsCaptionSpacing?: boolean;
  _taskId?: string;
  _useWindowsCaptionSpacing?: boolean;
}) {
  // 极简纯净版：彻底隐藏会话分享按钮（依赖智谱云端上传）
  return null;
}
