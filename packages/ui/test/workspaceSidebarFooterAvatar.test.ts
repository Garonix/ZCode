// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceSidebarFooter } from "@/WorkspaceSidebarFooter.js";

vi.mock("@/ControlHintTooltip.js", () => ({
  ControlHintTooltip: ({ children }: { children: unknown }) => children,
  SidebarNativeTooltip: ({ children }: { children: unknown }) => children,
}));

vi.mock("@/hooks/usePlatform.js", () => ({
  usePlatform: () => ({
    executeDesktopCommand: vi.fn(),
    getDesktopZoomLevel: () => Promise.resolve({ zoomLevel: 0 }),
    onDesktopZoomLevelChanged: () => () => {},
  }),
}));

vi.mock("@/i18n/IntlProvider.js", () => ({
  useZCodeIntl: () => ({
    intl: {
      formatMessage: ({ id }: { id: string }) => id,
    },
  }),
}));

vi.mock("@/shortcuts/useShortcutBindings.js", () => ({
  useShortcutCommandLabel: () => "",
}));

vi.mock("@/store/StoreProvider.js", () => ({
  useZCodeStore: (
    selector: (state: {
      interfaceMode: string;
      setInterfaceMode: () => void;
      isRestoringOAuthSession: boolean;
    }) => unknown,
  ) =>
    selector({
      interfaceMode: "coding",
      setInterfaceMode: vi.fn(),
      isRestoringOAuthSession: false,
    }),
}));

vi.mock("@/WorkspaceSidebarFooterUsageSummary.js", () => ({
  useWorkspaceSidebarFooterUsageSummaryState: () => ({}),
  WorkspaceSidebarFooterPlanBadge: () => null,
  WorkspaceSidebarFooterUsageSummaryContent: () => null,
}));

describe("WorkspaceSidebarFooter avatar display in pure edition", () => {
  it("纯净版下侧栏底部不显示头像框元素", () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceSidebarFooter, {
        theme: "zai-dark",
        localeMenuValue: "zh-CN",
        onLocaleChange: vi.fn(),
        onThemeChange: vi.fn(),
      }),
    );

    expect(html).toContain("工作台");
    // 不应包含 avatar 元素和对应 avatar-fallback
    expect(html).not.toContain('data-slot="avatar"');
    expect(html).not.toContain('data-slot="avatar-fallback"');
  });
});
