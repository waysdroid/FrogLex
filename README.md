# 陪读蛙 · 个人词库版

基于 Read Frog 1.61.2 二次开发的 Chrome 和 Edge 扩展。在阅读网页时划词查询，一键收录到本地词库。

## 安装

[V1.0.0 发布说明](https://github.com/waysdroid/read-frog/releases/tag/v1.0.0) · [Chrome 安装包](https://github.com/waysdroid/read-frog/releases/download/v1.0.0/read-frog-personal-vocabulary-v1.0.0-chrome.zip) · [Edge 安装包](https://github.com/waysdroid/read-frog/releases/download/v1.0.0/read-frog-personal-vocabulary-v1.0.0-edge.zip)

1. 下载并解压对应的 ZIP。
2. 打开 `chrome://extensions` 或 `edge://extensions`，开启开发者模式。
3. 选择「加载已解压的扩展程序」，打开包含 `manifest.json` 的目录。

## 中文二开说明

- 划词时可预览编辑并收录，保存原句和来源，重复收录会累计遇见次数。
- 在「扩展设置 → 个人词库」管理词库、标签、收藏和笔记，支持搜索筛选、批量移动和删除。
- 支持 TXT、CSV、JSON 和粘贴文本导入，以及 TXT、CSV、JSON 导出和完整备份恢复。
- 个人词库无需登录，数据保存在当前浏览器。已移除扩展使用遥测与远程调查。翻译和 AI 查询仍使用所选服务商。

[使用与备份说明](./PERSONAL_VOCABULARY.md) · [更新日志](./CHANGELOG.personal-vocabulary.md)

## 构建

使用 Node.js 26.13.1 和 pnpm 12.21.0。

```sh
pnpm install --frozen-lockfile
WXT_SKIP_ENV_VALIDATION=true pnpm zip
WXT_SKIP_ENV_VALIDATION=true pnpm zip:edge
```

两份 ZIP 生成在 `.output/`。[GitHub Actions 构建记录](https://github.com/waysdroid/read-frog/actions/workflows/vocabulary-ci.yml)

## Contributors

<a href="https://github.com/waysdroid">
  <img src="https://avatars.githubusercontent.com/u/153904242?s=96&amp;v=4" alt="@waysdroid" width="48" height="48" />
</a>

二开维护者 [@waysdroid](https://github.com/waysdroid)。原项目由 [@mengxi-ream](https://github.com/mengxi-ream) 和上游社区开发。[Read Frog 上游仓库](https://github.com/mengxi-ream/read-frog) · [上游贡献者](https://github.com/mengxi-ream/read-frog/graphs/contributors)

## 许可证

本仓库源码沿用 [GPL-3.0](./LICENSE)。安装包中的上游布局引擎沿用其独立许可证，声明随 ZIP 附带。
