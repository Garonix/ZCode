import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";

const UNAVAILABLE_TEXT = "Computer Use is not available in this build.";

/**
 * 中文修复说明：
 * 修复前：createComputerUseRuntime 为占位桩，所有 execute() 调用直接返回不可用错误；
 * 修复依据：当存在 brokerSocketPath 时，建立与 Broker/Helper 的真实 Socket 连接，
 * 将 MCP toolName/method 与 input 转发至底层，并将返回结果规范化为标准 MCP CallToolResult。
 * 若无 brokerSocketPath，则保持 fail-closed 安全语义。
 */
export function createComputerUseRuntime(options = {}) {
  const socketPath = options.brokerSocketPath?.trim();

  return {
    async execute(input) {
      if (!socketPath) {
        return {
          content: [{ type: "text", text: UNAVAILABLE_TEXT }],
          isError: true,
        };
      }

      if (options.ensureBrokerAvailable) {
        await options.ensureBrokerAvailable();
      }

      const id = randomUUID();
      const payload = {
        id,
        method: input.toolName,
        input: input.arguments,
        context: input.context,
      };

      return await new Promise((resolve) => {
        const socket = createConnection(socketPath);
        let buffer = "";
        let settled = false;

        const onAbort = () => {
          finish({
            content: [{ type: "text", text: "Computer Use operation aborted." }],
            isError: true,
          });
        };

        if (input.signal) {
          input.signal.addEventListener("abort", onAbort, { once: true });
        }

        const finish = (result) => {
          if (settled) return;
          settled = true;
          if (input.signal) {
            input.signal.removeEventListener("abort", onAbort);
          }
          socket.destroy();
          resolve(result);
        };

        socket.once("connect", () => {
          socket.write(`${JSON.stringify(payload)}\n`);
        });

        socket.on("data", (chunk) => {
          buffer += chunk.toString("utf8");
          const newlineIndex = buffer.indexOf("\n");
          if (newlineIndex >= 0) {
            try {
              const raw = buffer.slice(0, newlineIndex);
              const res = JSON.parse(raw);
              if (res.ok) {
                const output = res.result ?? {};
                resolve({
                  content: output.content ?? [
                    {
                      type: "text",
                      text: typeof output === "string" ? output : JSON.stringify(output),
                    },
                  ],
                  structuredContent: output.structuredContent ?? output,
                  isError: Boolean(output.isError),
                  _meta: output._meta,
                });
                settled = true;
                socket.destroy();
                return;
              }
              finish({
                content: [
                  {
                    type: "text",
                    text: typeof res.error === "string" ? res.error : res.error?.message ?? "Operation failed.",
                  },
                ],
                isError: true,
              });
            } catch (err) {
              finish({
                content: [{ type: "text", text: `Failed to parse broker response: ${err.message}` }],
                isError: true,
              });
            }
          }
        });

        socket.once("error", (err) => {
          finish({
            content: [{ type: "text", text: `Broker connection error: ${err.message}` }],
            isError: true,
          });
        });

        socket.once("close", () => {
          if (!settled) {
            finish({
              content: [{ type: "text", text: "Broker connection closed unexpectedly." }],
              isError: true,
            });
          }
        });
      });
    },
    async closeSession() {},
    async dispose() {},
  };
}
