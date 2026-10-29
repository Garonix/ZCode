import { useCallback, useState } from "react";
import {
  fetchRemoteProviderModels,
  type FetchRemoteModelsResult,
} from "@zcode/services";

export function useRemoteModelDiscovery() {
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);

  const discover = useCallback(
    async (options: { baseUrl: string; apiKey?: string; apiType?: string }) => {
      setFetching(true);
      setError(null);
      try {
        const res: FetchRemoteModelsResult = await fetchRemoteProviderModels(options);
        if (res.success && res.models.length > 0) {
          setDiscoveredModels(res.models);
          return res.models;
        }
        const errMsg = res.error || "未探测到可用模型列表";
        setError(errMsg);
        return null;
      } catch (err: unknown) {
        const errMsg = (err as Error)?.message || "网络探测失败";
        setError(errMsg);
        return null;
      } finally {
        setFetching(false);
      }
    },
    [],
  );

  return {
    fetching,
    error,
    discoveredModels,
    setDiscoveredModels,
    discover,
  };
}
