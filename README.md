# 陪读蛙 · 个人词库版

基于 Read Frog 二次开发的 Chrome 和 Edge 扩展，V1.1 可脱离官方账号使用。在阅读网页时划词查询，一键收录到本地词库。

## 安装

[V1.1.7 发布说明](https://github.com/waysdroid/read-frog/releases/tag/v1.1.7) · [Chrome 安装包](https://github.com/waysdroid/read-frog/releases/download/v1.1.7/read-frog-personal-vocabulary-v1.1.7-chrome.zip) · [Edge 安装包](https://github.com/waysdroid/read-frog/releases/download/v1.1.7/read-frog-personal-vocabulary-v1.1.7-edge.zip)

1. 下载并解压对应的 ZIP。
2. 打开 `chrome://extensions` 或 `edge://extensions`，开启开发者模式。
3. 选择「加载已解压的扩展程序」，打开包含 `manifest.json` 的目录。

升级时保留现有扩展，将新版文件解压到原安装目录，再在扩展管理页点击「重新加载」。使用同一个浏览器配置和扩展 ID，即可继续使用原有词库和设置。

## 二开说明

- 划词时可预览编辑并收录，保存记忆技巧、原句和来源，重复收录会累计遇见次数。
- 在扩展设置的「功能 → 个人词库」管理词库、标签、收藏和笔记，支持搜索筛选、批量移动和删除。
- 词条释义按语言归并。英文释义、补充例句、常用搭配、近义词、反义词和派生词支持 AI 预览追加、撤销和自定义提示词。
- 支持 TXT、CSV、JSON 和粘贴文本导入，以及 TXT、CSV、JSON 导出和完整备份恢复。
- 可在「偏好设置 → WebDAV 同步」手动覆盖或定时增量同步扩展配置和完整词库。
- 个人词库无需登录，默认保存在当前浏览器。已移除扩展使用遥测与远程调查。翻译可使用免登录服务，AI 查询使用自己配置的 API 和模型。

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

二开维护者 [@waysdroid](https://github.com/waysdroid)。[本仓库贡献记录](https://github.com/waysdroid/read-frog/graphs/contributors)

原项目由 [@mengxi-ream](https://github.com/mengxi-ream) 和上游社区开发。[Read Frog 上游仓库](https://github.com/mengxi-ream/read-frog) · [上游贡献者](https://github.com/mengxi-ream/read-frog/graphs/contributors)

## 许可证

本仓库源码沿用 [GPL-3.0](./LICENSE)。安装包中的上游布局引擎沿用其独立许可证，声明随 ZIP 附带。
