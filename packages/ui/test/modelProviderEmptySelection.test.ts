// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ModelProviderSectionDetail } from "@/settings/model-provider-section/Detail.js";

vi.mock("@/i18n/IntlProvider.js", () => ({
  useZCodeIntl: () => ({
    intl: {
      formatMessage: ({ id }: { id: string }) => id,
    },
  }),
}));

vi.mock("@/settings/CodingPlanUpgradeDialogProvider.js", () => ({
  useCodingPlanUpgradeDialog: () => ({
    openCodingPlanUpgrade: vi.fn(),
  }),
}));

vi.mock("@/hooks/useProviderSettingsView.js", () => ({
  useProviderSettingsView: () => ({
    state: { status: "ready", view: null },
  }),
}));

vi.mock("@/hooks/useUsageEntitlement.js", () => ({
  useUsageEntitlement: () => ({
    loading: false,
    snapshot: null,
    error: null,
  }),
}));

describe("ModelProviderSectionDetail empty selection", () => {
  it("未选择任何导航项时返回 null，不渲染持续旋转的 loading 卡片", () => {
    const html = renderToStaticMarkup(
      createElement(ModelProviderSectionDetail, {
        selectedNavItem: null,
        presetLoading: false,
        codingPlanPurchaseTokenAuthenticatedByProviderId: {},
        presetSubscriptionProviderId: null,
        codingPlanStatusSyncProviderId: null,
        codingPlanDisconnectProviderId: null,
        onSave: vi.fn(),
        onDelete: vi.fn(async () => {}),
        onTestModel: vi.fn(async () => ({ success: true })),
        onCodingPlanLogin: vi.fn(),
        onCodingPlanDisconnect: vi.fn(),
        onOpenApiKeyUrl: vi.fn(),
        onOpenBigModelRegistration: vi.fn(),
        onCodingPlanPurchaseComplete: vi.fn(async () => {}),
      }),
    );

    expect(html).toBe("");
  });
});
