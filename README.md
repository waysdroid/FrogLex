<h1 align="center">蛙词库 · FrogLex</h1>

<p align="center"><strong>划词查释义，随手保存生词与阅读原句。</strong></p>

<p align="center">
  适用于 Chrome 和 Edge 的开源词库扩展，支持网页翻译和 WebDAV 同步
</p>

<p align="center">
  <a href="https://github.com/waysdroid/FrogLex/releases/download/v2.0.0/read-frog-personal-vocabulary-v2.0.0-chrome.zip"><strong>下载 Chrome 版</strong></a>
  &nbsp;·&nbsp;
  <a href="https://github.com/waysdroid/FrogLex/releases/download/v2.0.0/read-frog-personal-vocabulary-v2.0.0-edge.zip"><strong>下载 Edge 版</strong></a>
  &nbsp;·&nbsp;
  <a href="https://github.com/waysdroid/FrogLex/releases/latest">最新发布</a>
</p>

<p align="center">
  <img src="./assets/frog-vocabulary-hero.webp" alt="一只小青蛙从摊开的笔记本里探出头，旁边放着几张词汇卡片" width="840" />
</p>

<p align="center">
  <a href="#功能说明">功能说明</a>
  &nbsp;·&nbsp;
  <a href="#安装与更新">安装与更新</a>
  &nbsp;·&nbsp;
  <a href="#数据与隐私">数据与隐私</a>
  &nbsp;·&nbsp;
  <a href="./PERSONAL_VOCABULARY.md">使用手册</a>
</p>

## 功能说明

| 功能                 | 你可以用它做什么                                                                                                     |
| :------------------- | :------------------------------------------------------------------------------------------------------------------- |
| **划词查词与收录**   | 查询网页中的英文单词或短语。收录时可预览编辑，并保留释义、记忆技巧、阅读原句和网页来源。再次收录会累计遇见次数。     |
| **个人词库**         | 用多个词库、标签、收藏和笔记整理词条，按条件搜索和筛选，也可以批量移动和删除。                                       |
| **AI 词条补充**      | 使用自己的模型补充英文释义、例句、搭配、近义词、反义词和派生词。支持自定义提示词、预览建议及撤销最近一次追加。       |
| **网页与字幕翻译**   | 翻译网页、选中文本、输入内容和视频字幕。可使用免登录翻译服务，也可选择自己配置的 AI 模型。                           |
| **导入、导出与备份** | 导入 TXT、CSV、JSON 或粘贴的文本，导出常用文件格式。完整词库备份还包含阅读语境、标签和词库归属，扩展配置可单独备份。 |
| **WebDAV 同步**      | 同步扩展配置和个人词库，支持手动覆盖、双向增量与定时增量。可连接坚果云或兼容的 WebDAV 服务。                         |

## 安装与更新

1. 下载对应浏览器的 ZIP 安装包并解压。
2. 打开 `chrome://extensions` 或 `edge://extensions`，开启**开发者模式**。
3. 点击「加载已解压的扩展程序」，选择包含 `manifest.json` 的目录。

> [!TIP]
> 在「功能 → 版本与更新」检查新版。首次点击「立即更新」时，授权扩展的**原安装目录**。手动更新也可将新版解压到同一目录，再在扩展管理页点击「重新加载」。沿用同一浏览器配置和扩展 ID，即可保留词库和设置。

[查看更新日志](./CHANGELOG.personal-vocabulary.md)

## 快速上手

1. **遇见生词**。选中单词或短语，打开词典，点「收录到个人词库」。要改词形或释义时，先点「预览与编辑」。
2. **集中整理**。在「功能 → 个人词库」补充笔记、标签和例句。使用 AI 词典或 AI 补充前，在「设置 → API 提供商」配置自己的模型。
3. **定期备份**。在「设置 → 数据管理」打开「个人词库文件」创建完整备份，也可以在这里配置 WebDAV。

[查看导入、备份和 WebDAV 操作说明](./PERSONAL_VOCABULARY.md)

## 数据与隐私

个人词库默认保存在当前浏览器，无需注册账号。WebDAV 同步可按需启用，WebDAV 密码和模型 API 密钥保留在本机。使用翻译或 AI 时，相关文本会发送给所选服务。项目已移除上游的使用遥测和远程调查。

<details>
<summary><strong>从源码构建</strong></summary>

使用 Node.js 26.13.1 和 pnpm 12.21.0。

```sh
pnpm install --frozen-lockfile
WXT_SKIP_ENV_VALIDATION=true pnpm zip
WXT_SKIP_ENV_VALIDATION=true pnpm zip:edge
```

安装包生成在 `.output/`。[GitHub Actions 构建记录](https://github.com/waysdroid/FrogLex/actions/workflows/vocabulary-ci.yml)

</details>

## Contributors

<a href="https://github.com/waysdroid">
  <img src="https://avatars.githubusercontent.com/u/153904242?s=96&amp;v=4" alt="@waysdroid" width="48" height="48" />
</a>

蛙词库由 [@waysdroid](https://github.com/waysdroid) 维护，基于 [@mengxi-ream](https://github.com/mengxi-ream) 和社区开发的 Read Frog。[本仓库贡献记录](https://github.com/waysdroid/FrogLex/graphs/contributors) · [Read Frog 上游仓库](https://github.com/mengxi-ream/read-frog) · [上游贡献者](https://github.com/mengxi-ream/read-frog/graphs/contributors)

## 许可证

源码沿用 [GPL-3.0](./LICENSE)。随安装包分发的上游布局引擎使用独立许可证，许可声明附在 ZIP 内。
