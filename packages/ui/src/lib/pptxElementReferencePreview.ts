import { createUuid } from "@zcode/shared";
import type {
  PptxCodeViewerSource,
  PptxReferencePreviewNavigation,
} from "@/lib/codeViewer.js";
import {
  isPptxElementReferenceInWorkspaceScope,
  type PptxElementReference,
} from "@/lib/pptxElementReference.js";
import { isWorkspaceFilePathInside } from "@/workspace-file-tree/model.js";

export interface PptxElementReferencePreviewScope {
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
}

function createPptxReferencePreviewNavigation(
  reference: PptxElementReference,
): PptxReferencePreviewNavigation {
  // 修复原因：内网非安全上下文（HTTP）下原生 crypto.randomUUID 不可用，使用兼容环境的 createUuid
  const requestId = createUuid();
  return {
    requestId,
    pageIndex: reference.slideIndex,
    expectedSourceFingerprint: reference.sourceFingerprint,
  };
}

export function createPptxElementReferencePreviewSource(
  reference: PptxElementReference,
  scope: PptxElementReferencePreviewScope,
): PptxCodeViewerSource | null {
  if (
    !isPptxElementReferenceInWorkspaceScope(reference, scope) ||
    !isWorkspaceFilePathInside(reference.workspacePath, reference.sourcePath)
  ) {
    return null;
  }

  return {
    type: "pptx",
    title: reference.sourceTitle,
    path: reference.sourcePath,
    workspacePath: reference.workspacePath,
    ...(reference.workspaceIdentity
      ? { workspaceIdentity: reference.workspaceIdentity }
      : {}),
    ...(reference.remoteSessionId
      ? { workspaceRemoteSessionId: reference.remoteSessionId }
      : {}),
    referenceNavigation: createPptxReferencePreviewNavigation(reference),
  };
}
