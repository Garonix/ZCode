import { createServiceLogger } from "../logger/serviceLogger.js";

const logger = createServiceLogger("remote-model-discovery");

export interface FetchRemoteModelsInput {
  baseUrl: string;
  apiKey?: string;
  apiType?: string;
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

function resolveCandidateEndpoints(normalizedBaseUrl: string): string[] {
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

  // 保持顺序的同时去重
  return Array.from(new Set(candidates));
}

function extractModelIds(data: unknown): string[] {
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
    // 基础合法性验证
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

  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "ZCode/3.14.0",
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
    logger.info(`[remoteModelDiscovery] 尝试请求模型端点: ${endpoint}`);
    try {
      const response = await fetch(endpoint, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(10000),
      });

      lastStatus = response.status;

      if (response.ok) {
        const json = await response.json();
        const models = extractModelIds(json);
        if (models.length > 0) {
          logger.info(`[remoteModelDiscovery] 成功获取到 ${models.length} 个模型: ${endpoint}`);
          return {
            success: true,
            models,
          };
        }
        // 如果虽然 200 但是返回空列表，记录并尝试下一个候选
        logger.info(`[remoteModelDiscovery] 端点返回 200 但未解析出模型，尝试下一个候选: ${endpoint}`);
      } else if (response.status === 401 || response.status === 403) {
        // 鉴权失败，直接阻断返回，无需尝试后续路径
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
      logger.info(`[remoteModelDiscovery] 请求端点失败: ${endpoint}, 原因: ${error?.message}`);
      if (error.name === "TimeoutError") {
        lastErrorMessage = "请求超时 (10s)，请检查网络连接或端点是否响应";
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
      (lastStatus ? `请求失败 (HTTP ${lastStatus})` : "未能从该地址探测到可用模型列表，请确认 Base URL 是否正确"),
  };
}
