// 修复原因：此模块被 packages/services/src/index.ts 重新导出并在浏览器渲染进程（packages/ui）中使用。
// 原先在模块顶层直接调用 createServiceLogger("remote-model-discovery")，会把依赖 Node.js process.pid
// 的服务日志模块打进渲染包并在初始化时立即执行，导致缺少 process 全局变量的渲染主页报 ReferenceError 白屏。
// 本模块保持为纯浏览器安全工具函数，日志改为通过 input.logger 动态注入或保持静默。

export interface FetchRemoteModelsInput {
  baseUrl: string;
  apiKey?: string;
  apiType?: string;
  timeoutMs?: number;
  /** 可选注入的日志器，兼容浏览器 packages/ui/src/logger 或 Node 服务层 logger */
  logger?: {
    info?: (...args: unknown[]) => void;
    warn?: (...args: unknown[]) => void;
    error?: (...args: unknown[]) => void;
    debug?: (...args: unknown[]) => void;
  };
}

export interface FetchRemoteModelsResult {
  success: boolean;
  models: string[];
  error?: string;
}

function normalizeBaseUrl(rawUrl: string): string {
  let url = rawUrl.trim();
  while (url.endsWith("/")) {
    url = url.slice(0, -1);
  }
  return url;
}

export function resolveCandidateEndpoints(normalizedBaseUrl: string): string[] {
  const candidates: string[] = [];

  if (normalizedBaseUrl.endsWith("/v1")) {
    const rootUrl = normalizedBaseUrl.slice(0, -3);
    candidates.push(`${normalizedBaseUrl}/models`);
    candidates.push(`${rootUrl}/models`);
    candidates.push(`${rootUrl}/api/tags`);
  } else {
    candidates.push(`${normalizedBaseUrl}/models`);
    candidates.push(`${normalizedBaseUrl}/v1/models`);
    candidates.push(`${normalizedBaseUrl}/api/tags`);
  }

  return Array.from(new Set(candidates));
}

export function extractModelIds(data: unknown): string[] {
  if (!data || typeof data !== "object") return [];

  const rawList: unknown[] = [];

  if (Array.isArray(data)) {
    rawList.push(...data);
  } else {
    const record = data as Record<string, unknown>;
    if (Array.isArray(record.data)) {
      rawList.push(...record.data);
    } else if (Array.isArray(record.models)) {
      rawList.push(...record.models);
    }
  }

  const modelIds: string[] = [];
  for (const item of rawList) {
    if (typeof item === "string") {
      const trimmed = item.trim();
      if (trimmed) modelIds.push(trimmed);
    } else if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      const idCandidate = obj.id ?? obj.name ?? obj.model;
      if (typeof idCandidate === "string") {
        const trimmed = idCandidate.trim();
        if (trimmed) modelIds.push(trimmed);
      }
    }
  }

  return Array.from(new Set(modelIds)).sort((a, b) => a.localeCompare(b));
}

/**
 * 探测指定供应商端点所支持的可用模型列表。
 * 支持 OpenAI-compatible (/models, /v1/models) 与 Ollama (/api/tags) 等常见自建/第三方网关。
 */
export async function fetchRemoteProviderModels(
  input: FetchRemoteModelsInput,
): Promise<FetchRemoteModelsResult> {
  const rawBaseUrl = input.baseUrl?.trim();
  if (!rawBaseUrl) {
    return {
      success: false,
      models: [],
      error: "供应商 Base URL 为空，请先填写接口地址",
    };
  }

  let normalizedBaseUrl: string;
  try {
    const parsed = new URL(rawBaseUrl);
    if (!parsed.protocol.startsWith("http")) {
      return {
        success: false,
        models: [],
        error: "无效的 URL 协议，仅支持 HTTP/HTTPS",
      };
    }
    normalizedBaseUrl = normalizeBaseUrl(rawBaseUrl);
  } catch {
    return {
      success: false,
      models: [],
      error: "无效的 URL 格式，请输入正确的 Base URL",
    };
  }

  const candidateEndpoints = resolveCandidateEndpoints(normalizedBaseUrl);
  const apiKey = input.apiKey?.trim();
  const isAnthropic = input.apiType === "anthropic-messages";
  const timeoutMs = input.timeoutMs ?? 10000;

  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  if (apiKey) {
    if (isAnthropic) {
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";
    } else {
      headers.Authorization = `Bearer ${apiKey}`;
    }
  }

  let lastStatus: number | undefined;
  let lastErrorMessage: string | undefined;

  for (const endpoint of candidateEndpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });

      lastStatus = response.status;

      if (response.ok) {
        const json = await response.json();
        const models = extractModelIds(json);
        if (models.length > 0) {
          input.logger?.info?.(
            `[remoteModelDiscovery] 成功从 ${endpoint} 发现 ${models.length} 个模型`,
          );
          return {
            success: true,
            models,
          };
        }
      } else if (response.status === 401 || response.status === 403) {
        const statusText = response.status === 401 ? "401 Unauthorized" : "403 Forbidden";
        return {
          success: false,
          models: [],
          error: `供应商鉴权失败 (${statusText})，请检查 API Key 是否正确`,
        };
      } else {
        lastErrorMessage = `HTTP ${response.status} ${response.statusText}`;
      }
    } catch (err: unknown) {
      const error = err as Error;
      input.logger?.info?.(
        `[remoteModelDiscovery] 请求端点失败: ${endpoint}, 原因: ${error?.message}`,
      );
      if (error.name === "TimeoutError") {
        lastErrorMessage = `请求超时 (${Math.round(timeoutMs / 1000)}s)，请检查网络连接或端点是否响应`;
      } else {
        lastErrorMessage = error.message || "网络请求失败";
      }
    }
  }

  return {
    success: false,
    models: [],
    error:
      lastErrorMessage ??
      (lastStatus
        ? `请求失败 (HTTP ${lastStatus})`
        : "未能从该地址探测到可用模型列表，请确认 Base URL 是否正确"),
  };
}
