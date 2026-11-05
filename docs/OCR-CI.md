# OCR PR 代码评审

仓库通过 GitHub Actions 接入 Alibaba OpenCodeReview。工作流位于
`.github/workflows/ocr-review.yml`，只监听两种 PR 事件：

- `opened`：PR 创建后执行一次评审。
- `synchronize`：PR 分支新增 commit 后重新评审。

普通分支 push、PR 评论、issue 和定时任务都不会触发评审。同一个 PR 的新评审会取消仍在运行的旧评审，避免同一 PR 同时消耗多份 LLM 配额。

## 仓库配置

在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 中配置：

| 类型 | 名称 | 内容 |
| --- | --- | --- |
| Secret | `OCR_LLM_URL` | OpenAI 兼容的 Chat Completions 端点 |
| Secret | `OCR_LLM_AUTH_TOKEN` | LLM API token |
| Variable | `OCR_LLM_MODEL` | 模型名，必须显式设置 |
| Variable | `OCR_LLM_USE_ANTHROPIC` | 使用 Claude 时填 `true`，否则填 `false` |

GitHub Actions 自动提供 `GITHUB_TOKEN`。工作流只申请 `contents: read` 和
`pull-requests: write`，分别用于读取差异和回贴评审评论。

## 安全边界

工作流使用 `pull_request_target`，只评审源仓库与当前仓库相同的 PR；fork PR 会跳过评审任务。
它运行的是目标分支中的工作流配置，并把 PR 当作差异输入交给评审 Action；不要在这个工作流中增加 checkout 或执行 PR 分支脚本的步骤。

当前 Action 使用 `alibaba/open-code-review@main` 以跟随 OCR 官方工作流。若组织需要供应链可审计性，应把它替换为经过审核的固定 release 或 commit SHA。

## 首次验收

1. 在 GitHub Actions 的 Variables/Secrets 中完成上表配置。
2. 创建一个测试 PR，确认 `OpenCodeReview PR Review` workflow 运行并在 PR 中出现评论。
3. 向同一个 PR 推送一个新 commit，确认产生新的 workflow run 和新的评审结果。
4. 在 Actions 页面检查失败日志；不要把 token 写入 PR、日志或仓库文件。
