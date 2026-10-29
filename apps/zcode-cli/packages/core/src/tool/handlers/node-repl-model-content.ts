import type { JsOutput, ModelMessageContent, ModelMessageContentBlock } from "@zcode/contracts";
import { extractOfficialCuaImageRefTexts } from "@zcode/zcode-cua/frame-contract";

export function formatJsModelContent(output: unknown): ModelMessageContent {
  // 若 output 自身已带有 content 数组（如来自 MCP CallToolResult），直接保留各块及 image/image_ref 邻接顺序
  if (
    output &&
    typeof output === "object" &&
    Array.isArray((output as { content?: unknown }).content)
  ) {
    const rawContent = (output as { content: Array<Record<string, unknown>> }).content;
    const blocks: ModelMessageContentBlock[] = [];
    for (const item of rawContent) {
      if (item && item.type === "image") {
        const mimeType = typeof item.mimeType === "string" ? item.mimeType : "image/png";
        const base64 =
          typeof item.data === "string"
            ? item.data
            : typeof (item as { base64?: unknown }).base64 === "string"
              ? ((item as { base64: string }).base64)
              : "";
        const dataUrl =
          typeof item.dataUrl === "string"
            ? item.dataUrl
            : `data:${mimeType};base64,${base64}`;
        blocks.push({
          type: "image",
          mediaType: mimeType,
          dataUrl,
          ...(base64 ? { data: base64 } : {}),
        } as ModelMessageContentBlock);
      } else if (
        item &&
        item.type === "text" &&
        typeof item.text === "string" &&
        item.text.length > 0
      ) {
        blocks.push({
          type: "text",
          text: item.text,
        });
      }
    }
    if (blocks.length > 0) return blocks;
  }

  const o = output as JsOutput;
  const parts: string[] = [];
  if (o.error) {
    const errorHeader = `${o.error.name}: ${o.error.message}`;
    parts.push(errorHeader);
    // Error.stack 首行已经重复 name/message；再拼完整 stack 会让模型看到两遍
    // 同一错误正文。message 可能包含多行 locator context，必须剥离完整 header，不能只删第一行。
    const stackFrames = o.error.stack
      ? o.error.stack.startsWith(`${errorHeader}\n`)
        ? o.error.stack.slice(errorHeader.length + 1).trimEnd()
        : o.error.stack.split("\n").slice(1).join("\n").trimEnd()
      : undefined;
    if (stackFrames?.trim()) parts.push(stackFrames);
  }
  if (o.logs) parts.push(o.logs);
  if (o.result !== undefined) parts.push(`=> ${o.result}`);
  if (o.browserScreenshotPaths && o.browserScreenshotPaths.length > 0) {
    parts.push(
      o.browserScreenshotPaths.map((path) => `Browser screenshot saved to: ${path}`).join("\n"),
    );
  }
  const fullText = parts.length > 0 ? parts.join("\n") : "(no output)";

  // nodeRepl.emitImage 收集的图片 → image 内容块（dataUrl），让模型直接"看"到截图。
  // Canonical result order puts emitted rasters before their textual summary.
  if (o.images && o.images.length > 0) {
    // 扫描文本中的 official CUA image_ref 凭据，与对应图片建立相邻配对 (image -> image_ref)
    const { refs, remainingText } = extractOfficialCuaImageRefTexts(fullText);
    const blocks: ModelMessageContentBlock[] = [];
    let refIndex = 0;

    for (const img of o.images) {
      blocks.push({
        type: "image",
        mediaType: img.mimeType,
        dataUrl: `data:${img.mimeType};base64,${img.base64}`,
        data: img.base64,
      } as ModelMessageContentBlock);

      // 若有待配对的 image_ref，紧跟在当前 image 之后作为独立 text 块注入，满足 canonical frame contract
      if (refIndex < refs.length) {
        blocks.push({ type: "text", text: refs[refIndex]! });
        refIndex += 1;
      }
    }

    // 若有多余的 refs（例如多图只截取部分显示），继续作为独立 text 块注入
    while (refIndex < refs.length) {
      blocks.push({ type: "text", text: refs[refIndex]! });
      refIndex += 1;
    }

    const cleanedRemaining = remainingText
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line, index, arr) => line.length > 0 || (index > 0 && arr[index - 1]!.length > 0))
      .join("\n")
      .trim();

    if (cleanedRemaining.length > 0) {
      blocks.push({ type: "text", text: cleanedRemaining });
    }
    return blocks;
  }

  return fullText;
}
