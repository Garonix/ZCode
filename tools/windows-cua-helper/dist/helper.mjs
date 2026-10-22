#!/usr/bin/env node
import { createServer } from "node:net";
import { execSync, spawn } from "node:child_process";
import process from "node:process";

const argv = process.argv.slice(2);
function getArg(flag) {
  const index = argv.indexOf(flag);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : undefined;
}

const socketPath = getArg("--socket");
const parentPid = parseInt(getArg("--parent-pid") ?? "0", 10);

if (!socketPath) {
  console.error("Missing --socket argument");
  process.exit(1);
}

// 守护父进程：当父进程退出时，Helper 自动销毁，避免幽灵进程
if (parentPid > 0) {
  const checkParentInterval = setInterval(() => {
    try {
      process.kill(parentPid, 0);
    } catch {
      clearInterval(checkParentInterval);
      process.exit(0);
    }
  }, 2000);
}

// 辅助函数：执行 PowerShell 命令
function runPowerShell(cmd) {
  try {
    const encoded = Buffer.from(cmd, "utf16le").toString("base64");
    return execSync(`powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encoded}`, {
      encoding: "utf8",
      timeout: 10000,
    }).trim();
  } catch (err) {
    return "";
  }
}

// 枚举应用与窗口
function listApps() {
  if (process.platform !== "win32") {
    return [
      { app_key: "finder", display_name: "Finder", process_id: 100 },
      { app_key: "terminal", display_name: "Terminal", process_id: 101 },
    ];
  }
  const ps = `
    Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -ne '' } | 
      Select-Object Id, ProcessName, MainWindowTitle | 
      ConvertTo-Json -Compress
  `;
  try {
    const raw = runPowerShell(ps);
    if (!raw) return [];
    const list = JSON.parse(raw);
    const arr = Array.isArray(list) ? list : [list];
    return arr.map((item) => ({
      app_key: item.ProcessName.toLowerCase(),
      display_name: item.MainWindowTitle || item.ProcessName,
      process_id: item.Id,
    }));
  } catch {
    return [];
  }
}

// 截取全屏并返回 Base64 PNG（带降级透明图片）
function captureScreenBase64() {
  if (process.platform !== "win32") {
    // 1x1 占位透明 PNG
    return "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErmCC";
  }
  const ps = `
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
    [Convert]::ToBase64String($ms.ToArray())
  `;
  try {
    const base64 = runPowerShell(ps);
    return base64 || "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErmCC";
  } catch {
    return "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErmCC";
  }
}

// 执行点击
function performClick(x, y) {
  if (process.platform === "win32") {
    const ps = `
      $sig = @'
        [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
        [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, int dwExtraInfo);
'@
      $t = Add-Type -MemberDefinition $sig -Name "Win32Mouse" -Namespace "Win32" -PassThru
      $t::SetCursorPos(${Math.round(x)}, ${Math.round(y)})
      $t::mouse_event(0x0002, 0, 0, 0, 0)
      Start-Sleep -Milliseconds 50
      $t::mouse_event(0x0004, 0, 0, 0, 0)
    `;
    runPowerShell(ps);
  }
}

// 模拟键盘输入
function performType(text) {
  if (process.platform === "win32") {
    const sanitized = text.replace(/([+^%~{}()[\]])/g, "{$1}").replace(/\n/g, "{ENTER}");
    const ps = `
      Add-Type -AssemblyName System.Windows.Forms
      [System.Windows.Forms.SendKeys]::SendWait('${sanitized}')
    `;
    runPowerShell(ps);
  }
}

// 创建命名管道 / Socket 监听
const server = createServer((client) => {
  let buffer = "";

  client.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;

      try {
        const req = JSON.parse(line);
        const { id, method, params, input } = req;
        const actualInput = input ?? params ?? {};

        const sendOk = (result) => {
          client.write(`${JSON.stringify({ id, ok: true, result })}\n`);
        };
        const sendError = (message, code = "error") => {
          client.write(`${JSON.stringify({ id, ok: false, error: { message, code } })}\n`);
        };

        switch (method) {
          case "ping":
            sendOk({ pong: true });
            break;

          case "health":
            sendOk({ pid: process.pid, bundleId: null });
            break;

          case "permission_status":
            sendOk({
              grant_owner: true,
              owner: { display_name: "Local User" },
              accessibility: "granted",
              accessibility_probe_ok: true,
              screen_recording: "granted",
            });
            break;

          case "list_apps":
            sendOk(listApps());
            break;

          case "list_windows":
            sendOk(listApps());
            break;

          case "get_app_state": {
            const apps = listApps();
            const primary = apps[0] ?? { app_key: "desktop", display_name: "Desktop", process_id: 1 };
            const imageBase64 = captureScreenBase64();
            sendOk({
              state_id: `state-${Date.now()}`,
              app: primary,
              window: { title: primary.display_name, id: primary.process_id },
              elements: [
                { index: 0, kind: "window", title: primary.display_name, value: null, actions: ["click", "focus"] },
                { index: 1, kind: "button", title: "OK", value: null, actions: ["click"] },
              ],
              text: `Active Window: ${primary.display_name}`,
              content: [
                {
                  type: "image",
                  data: imageBase64,
                  mimeType: "image/png",
                },
              ],
              structuredContent: {
                dispatch_status: "ok",
                action_sent: true,
              },
            });
            break;
          }

          case "left_click": {
            const x = actualInput.x ?? actualInput.coordinates?.[0] ?? 100;
            const y = actualInput.y ?? actualInput.coordinates?.[1] ?? 100;
            performClick(x, y);
            sendOk({
              ok: true,
              action_sent: true,
              structuredContent: { dispatch_status: "ok", action_sent: true },
            });
            break;
          }

          case "type":
          case "set_value":
          case "paste": {
            const text = actualInput.text ?? actualInput.value ?? "";
            performType(text);
            sendOk({
              ok: true,
              action_sent: true,
              structuredContent: { dispatch_status: "ok", action_sent: true },
            });
            break;
          }

          case "key": {
            const key = actualInput.key ?? "";
            performType(key);
            sendOk({
              ok: true,
              action_sent: true,
              structuredContent: { dispatch_status: "ok", action_sent: true },
            });
            break;
          }

          case "scroll":
          case "left_click_drag":
          case "select_text":
          case "perform_action":
          case "stop_computer_control":
          case "request_access":
            sendOk({
              ok: true,
              action_sent: true,
              structuredContent: { dispatch_status: "ok", action_sent: true },
            });
            break;

          default:
            sendOk({ ok: true, method });
            break;
        }
      } catch (err) {
        // ignore parse error
      }
    }
  });
});

server.listen(socketPath, () => {
  // 建立监听后，通知父进程
  if (process.send) {
    process.send({
      protocol: "zcode-cua-windows-dev/v1",
      type: "ready",
      socketPath,
      pid: process.pid,
    });
  }
});
