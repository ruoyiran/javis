# Javis 使用示例

本文从只读观察开始，逐步介绍 CLI 操作、脚本化工作流、MCP、独立 SSH 主机和手机浏览器。第 1–9 节以已安装的 macOS Javis 为例；Linux/Windows 和手机入口见后文。构建、安装和平台依赖见 [README](../README.md)。示例中的 `jq` 用于读取 JSON。

在执行修改界面的示例前，先打开一个可以随时丢弃的目标窗口，例如 TextEdit 的临时文稿。`--element-index` 的编号仅作语法示意，必须从当前窗口的 `snapshot.treeText` 中选择。Javis 不负责启动目标应用；`--app` 可以使用应用名、bundle ID 或 `pid:N`。

## 先确认 Javis 可用

```bash
javis --version
javis permissions status --json
javis capabilities --json
```

Accessibility 权限用于读取控件树和操作界面，Screen Recording 权限用于截图。需要授予权限时，运行 `javis permissions open`，然后在 macOS 界面中完成授权。只需要控件树时，可在观察和动作中加 `--no-screenshot`。

## 1. 列出应用并观察窗口

列出正在运行的应用，查看名称、bundle ID 和 PID：

```bash
javis list-apps --json \
  | jq -r '.result.apps[] | "\(.name)\t\(.bundleId // "")\tpid:\(.pid)"'
```

先打开一个 Finder 窗口，列出窗口，再用返回的 `index` 或 `id` 选定目标。只有一个目标窗口时，可以省略窗口选择参数。

```bash
javis list-windows --app com.apple.finder --json \
  | jq '.result.windows[] | {index, id, title}'

javis get-app-state --app com.apple.finder --window-index 0 \
  --no-screenshot --json \
  | jq -r '.result.snapshot.treeText'
```

也可用 `--window-id 12345` 选择列表中的窗口 ID，或用 `--app pid:1234` 指向特定进程。`--window-id` 与 `--window-index` 不能同时使用。

## 2. 搜索控件和查看截图

`--query` 和 `--max-elements` 用于缩短返回的控件树。查询词应来自实际界面，例如按钮文字或控件角色；过滤后元素编号仍是原编号，且可能不连续。

```bash
javis get-app-state --app com.apple.finder \
  --query "button" --max-elements 10 --no-screenshot --json \
  | jq -r '.result.snapshot.treeText'
```

不加 `--no-screenshot` 时，CLI 将 PNG 保存到私有临时文件。先看截图状态，再使用返回的路径；截图失败不一定妨碍读取控件树。

```bash
state=$(javis get-app-state --app com.apple.finder --json)
jq '.result | {sessionId, screenshotStatus, screenshot}' <<<"$state"
jq -r '.result.snapshot.treeText' <<<"$state"
```

`result.screenshot.path` 通常是当前主机上的私有临时文件路径，`result.screenshot.scale` 用于换算截图像素和窗口坐标。若保存文件失败，CLI 会保留内联截图数据和警告；脚本需检查 `path` 是否存在。通过 SSH 观察时，路径也只属于发起命令的本机，不是远端路径。

## 3. 最小操作闭环：观察、点击、检查

每次 CLI 动作都需要同一主机、同一上下文中的新观察。可传入 `get-app-state` 返回的 `sessionId`，也可在观察和动作中使用同一个 `--worktree`；两者不可同时使用。都不写时，CLI 使用当前目录的规范路径作为上下文，普通文件夹也适用。先从控件树选择真实编号，再执行动作；不要直接照抄示例编号。

```bash
app=com.apple.TextEdit
state=$(javis get-app-state --app "$app" --no-screenshot --json)
session=$(jq -er '.result.sessionId' <<<"$state")
jq -r '.result.snapshot.treeText' <<<"$state"

printf '要点击的元素编号: '
IFS= read -r element_index
result=$(javis click --app "$app" --session "$session" \
  --element-index "$element_index" --no-screenshot --json)
jq '.' <<<"$result"
```

先看 `ok` 和 `error`，再看成功结果。失败时 `error.nextSteps` 给出可执行的恢复建议。动作结果通常包含新快照和简短的控件树差异：`~` 表示控件变化，`-` 表示控件移除。需要完整树时，在动作上加 `--full-tree`。如果同一会话要重新观察，可用 `javis get-app-state --app "$app" --session "$session" --json` 刷新它。会话和元素索引最多保留约两分钟；窗口或界面发生变化时，应重新观察后再选择编号。

后续动作示例中的 `$app` 和 `$session` 沿用本节变量。若从后面的某一节开始练习，应先重新运行 `get-app-state` 并设置这两个变量。

| 返回字段 | 用途 |
| --- | --- |
| `result.sessionId` | 后续 CLI 动作要带的会话 ID。 |
| `result.snapshot.treeText` | 当前控件树；动作结果默认可能是相对上次快照的差异。 |
| `result.action.path` / `delivery` | 实际使用的动作路径，以及后台或前台送达方式。 |
| `result.action.verification` | Javis 能否直接验证动作效果；`unverified` 需要继续检查界面。 |
| `result.observationError` | 输入已送达，但动作后的观察失败；此时 `snapshot` 为 `null`。 |

### 常见点击变体

以下各条是**独立示例**。执行每条前，都要取当前窗口的新快照和 `sessionId`，并替换真实元素编号。

```bash
# 双击
javis click --app "$app" --session "$session" \
  --element-index 12 --click-count 2 --json

# 右键点击
javis click --app "$app" --session "$session" \
  --element-index 12 --mouse-button right --json

# 按住修饰键点击
javis click --app "$app" --session "$session" \
  --element-index 12 --modifiers CmdOrCtrl --json

# 执行控件树中 Secondary Actions 列出的动作
javis perform-secondary-action --app "$app" --session "$session" \
  --element-index 12 --action "show menu" --json
```

最后一条仅在该元素确实列出 `show menu` 时适用；`--action` 也接受它对应的原始 AX 动作名。

## 4. 输入文字和键盘操作

对控件树中标为可设值的字段，优先使用 `set-value`。它会尝试读回值并在 `action.verification` 中报告验证结果。

```bash
javis set-value --app "$app" --session "$session" \
  --element-index 17 --value "你好，Javis" --json
```

当目标只接受键盘输入时，先点击并确认焦点落在正确控件，再使用 `type-text`、`paste-text`、`press-key` 或 `hotkey`。下面各条也是独立示例；操作之间要检查新快照。

```bash
javis type-text --app "$app" --session "$session" \
  --text "一段临时内容" --json

javis paste-text --app "$app" --session "$session" \
  --text "一次性粘贴的内容" --json

javis press-key --app "$app" --session "$session" --key Return --json
javis hotkey --app "$app" --session "$session" --key CmdOrCtrl+A --json
```

`press-key` 只接收单个键，`hotkey` 接收“修饰键 + 一个键”。要避免把敏感文字写入 shell 历史，可从标准输入读取：

```bash
javis type-text --app "$app" --session "$session" \
  --text-stdin --json < /path/to/input.txt

javis set-value --app "$app" --session "$session" \
  --element-index 17 --value-stdin --json < /path/to/input.txt
```

普通可读控件的后续快照可能显示输入内容。处理敏感信息时，不要保存或转发动作结果中的控件树。

## 5. 滚动、拖拽与截图坐标

能从控件树定位元素时，优先使用元素编号。滚动可指定元素或窗口内坐标；拖拽可指定两个元素，或四个坐标。

```bash
javis scroll --app "$app" --session "$session" \
  --element-index 23 --direction down --pages 1 --json

javis scroll --app "$app" --session "$session" \
  --x 400 --y 300 --direction up --pages 0.5 --json

javis drag --app "$app" --session "$session" \
  --from-element-index 20 --to-element-index 21 --json

javis drag --app "$app" --session "$session" \
  --from-x 100 --from-y 120 --to-x 300 --to-y 120 --json
```

坐标相对**目标窗口**，不是整个屏幕。截图可能缩小显示；转换公式为 `窗口 X = 截图像素 X / screenshot.scale`，Y 同理。例如 `scale = 0.5` 时，截图像素 `(300, 160)` 对应窗口坐标 `(600, 320)`：

```bash
javis click --app "$app" --session "$session" \
  --x 600 --y 320 --json
```

坐标动作应依据刚获取的截图与窗口，避免对已移动或已改变的界面使用旧坐标。

## 6. 后台操作与前台回退

Javis 默认尝试在后台操作目标窗口。若目标不支持该路径，可能返回 `background_unavailable`。确认可以打断当前桌面工作后，可在动作中明确加入 `--restore-window`，让目标窗口进入前台；该选项可能改变焦点和真实指针位置。

```bash
javis click --app "$app" --session "$session" \
  --element-index 12 --restore-window --json
```

先重新观察再决定是否前台操作。尤其在超时或动作已送达但观察失败时，不能简单地用 `--restore-window` 重放同一动作。

## 7. 脚本化操作并处理不确定结果

下面的 Bash 脚本从 TextEdit 的一个临时窗口获取新会话，让操作者选编号，然后检查 CLI 错误、动作送达情况和后续快照。它不自动重试点击。

```bash
#!/usr/bin/env bash
set -euo pipefail

app=com.apple.TextEdit
state=$(javis get-app-state --app "$app" --window-index 0 \
  --no-screenshot --json)
session=$(jq -er '.result.sessionId' <<<"$state")
jq -r '.result.snapshot.treeText' <<<"$state"

read -rp '要点击的元素编号: ' index
if ! result=$(javis click --app "$app" --window-index 0 \
    --session "$session" --element-index "$index" \
    --no-screenshot --json); then
  jq '.error' <<<"$result"
  exit 1
fi

if jq -e '.result.observationError != null' <<<"$result" >/dev/null; then
  jq '.result | {action, observationError}' <<<"$result"
  javis list-windows --app "$app" --json \
    | jq '.result.windows[] | {index, id, title}'
  exit 2
fi

jq '.result.action | {path, delivery, verification}' <<<"$result"
jq -r '.result.snapshot.treeText' <<<"$result"
```

若 `action.verification.state` 为 `unverified`，应结合返回的快照或目标结果判断效果。若 `result.observationError` 存在，动作可能已经送达，但 `snapshot` 为 `null`；检查目标现状后再决定下一步，不要直接重试。

## 8. 在 Codex 或 Claude Code 中通过 MCP 使用

安装时只配置 Javis 本身；要注册 Agent 的 Skill 和 MCP stdio 服务，再运行：

```bash
javis agent install all
# 或只注册其中一个：javis agent install codex
```

一个 MCP 客户端在**同一连接**内可以按以下顺序调用工具。参数采用 camelCase；MCP 按主机和上下文管理自己的 session，因此无需传 `sessionId`。

```text
javis_list_windows  {"app":"com.apple.finder"}
javis_get_app_state {"app":"com.apple.finder","windowIndex":0,"query":"button","noScreenshot":true}
javis_click         {"app":"com.apple.finder","windowIndex":0,"elementIndex":12}
```

调用 `javis_click` 前，要从实际的 `javis_get_app_state` 结果中取得元素编号。需要远端主机时，在两次工具调用中都传同一个 `host` SSH 别名；`worktree` 可单独指定会话上下文，不能替代 `host`。MCP 的截图会作为 `image/png` 内容块返回，而不是文本中的 PNG base64。`javis_permissions_status` 只读 macOS 权限状态，可带 `host` SSH 别名查询远端；打开系统权限界面请在目标主机运行 CLI 的 `javis permissions open`。完整工具列表和参数见 [CLI 与 MCP 协议](protocol.md)。

在 Agent 对话中，也可以直接描述目标和约束，例如“用 Javis 读取 Finder 当前窗口，列出工具栏按钮，只观察，不点击”，或“在 TextEdit 临时文稿中输入一段文字；先确认目标控件，操作后检查新快照”。

## 9. 遇到失败时怎么处理

| 结果或错误 | 下一步 |
| --- | --- |
| `app_not_found` | 用 `javis list-apps --json` 检查应用名、bundle ID 或 PID。 |
| `permission_denied` | 查看 `javis permissions status --json`；必要时运行 `javis permissions open` 并完成授权。 |
| `screenshotStatus.state = "failed"` | 检查截图权限；若只需控件树，使用 `--no-screenshot`。 |
| `element_not_found`、`window_stale`、`stale_snapshot` | 重新运行 `get-app-state`，从新控件树选择编号。 |
| `background_unavailable` | 重新观察；确认可切到前台后，考虑 `--restore-window`。 |
| `verification_failed` 或 `verification.state = "unverified"` | 检查新快照和目标结果，判断动作是否生效。 |
| `result.observationError` 或动作超时 | 先检查目标现状；动作可能已送达，不要自动重放。 |
| `app_blocked` | 停止对该应用使用 Javis。 |

结束后如需关闭按需启动的守护进程及 helper，可运行 `javis daemon stop`。

## 10. Linux 与 Windows 的只读入口

Linux 和 Windows 先运行 `npm ci && npm run build && npm run install:local`。安装器会把文件复制到用户目录，写出 `javis` 或 `javis.cmd` 启动器，并固定安装时 Node 可执行文件的绝对路径。保持该 Node 安装可用，把安装器打印出的启动器目录加入 `PATH`。Linux 需要当前图形登录中的 Python 3、PyGObject 和 AT-SPI；X11/Wayland 与 `xdotool`、`wl-copy`/`xclip`/`xsel` 的可用性会改变能力。Windows 需要用户交互桌面中的 Windows PowerShell UI Automation。先读取能力，再按实际平台选择应用：

```bash
javis capabilities --json
javis list-apps --json
javis list-windows --app '<实际应用名>' --json
```

Linux 的窗口 ID 定位当前不受支持，改用列表里的 `--window-index`。截图或后台输入可能因平台和会话不同而不可用；以 `capabilities` 返回值为准。macOS 上运行 TypeScript/模拟测试不能证明 Windows 图形界面操作通过；Windows 原生验证须在 Windows 上进行。

## 11. SSH 主机与文件夹上下文

在配置好的 OpenSSH 别名 `office-desktop` 对应主机上安装 Javis，确保非交互式 SSH 会话能找到 `javis`。以下只读命令不会把本机桌面当作目标：

```bash
javis capabilities --host office-desktop --json
javis get-app-state --host office-desktop --app '<远端应用名>' \
  --worktree project-alpha --no-screenshot --json
```

若随后执行动作，必须沿用 `--host office-desktop --worktree project-alpha` 并使用刚获取的元素编号。`--worktree` 是所选主机上的会话标识，可以是任意非空 ID；它不要求 Git 工作树，也不会改变 SSH 主机。省略 `--worktree` 和 `--session` 时，CLI 以发起命令时的当前目录作为上下文。SSH 断开或超时后，动作是否送达可能无法判断；重新观察目标，不要自动重放。

## 12. 本机设置与手机浏览器

在 macOS 上，可通过 `javis settings open` 打开本机回环地址的设置页，查看两项权限、打开各自的授权界面、重置授权以及查看或安装 Codex/Claude Skill。`javis permissions reset` 会针对核验过的 Javis app 身份重置 Accessibility 和 Screen Recording 授权，应由用户主动选择。普通观察不会弹出系统设置。

在需要被控制的桌面主机上启动手机入口：

```bash
javis mobile serve --bind <局域网 IP> --port 8787 \
  --cert <certificate.pem> --key <private-key.pem>
```

完整的 macOS 自签名证书命令见[运行手册](operations.md#remote-host-and-phone-gateway)。手机浏览器须信任或接受该证书，打开打印出的 HTTPS 地址，并在五分钟内输入一次性配对码。页面列出主机应用和窗口、显示截图及控件树，并提供九种桌面动作。点击截图时会按显示尺寸和 `screenshot.scale` 换算窗口坐标。若动作已送达但观察失败，或网络中断导致结果不确定，先刷新观察；页面不会自动重发动作。该页面控制桌面主机，不控制手机自己的应用。Orca Mobile 没有 CUA 路由，这个手机界面是 Javis 新增的能力。
