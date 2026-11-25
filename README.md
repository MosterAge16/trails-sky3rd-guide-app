# 轨迹攻略 · 离线阅读器

把 [trails-game.com](https://trails-game.com/)（轨迹系列 – Cafe）的攻略搬运成手机离线 APP，个人使用。
站点攻略采用 [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/deed-zh) 许可：允许转载和改编，需署名、仅限非商业用途。
署名和原文地址写在 APP 的「设置 → 关于与来源」里。

## 成品（`dist/`）

| 文件 | 用途 |
| --- | --- |
| `轨迹攻略.apk` | Android 安装包（Android 8.0 及以上），不申请任何权限 |
| `轨迹攻略.html` | 单文件网页版，图片全部内嵌，拷到哪都能直接打开 |
| `www/` | 网页版的分文件形式，APK 打包用的就是它 |

安装 APK：把文件传到手机（数据线 / 微信文件传输助手等），点开安装，允许「安装未知来源应用」。

## 功能

- **阅读**：按话分章，自动记住每话读到的位置；小节（门 / Boss 战）可点击折叠
- **目录**：章节导航，可展开到每个小节，能标记「已读」
- **之门**：全部 28 个门相关小节，列出开启条件和奖励，可勾选完成、只看未完成
- **笔记**：来自原站「各类笔记」页的三个部分
  - **战斗**：261 条敌人数据（掉落物、属性有效率、状态抗性、耀晶片等，点条目展开），按出现章节筛选，
    筛选选项按剧情顺序排列（第零话 → 第七话 → 最终话 → 月亮之门 → 星星之门 → 太阳之门）
  - **书籍**：13 本收集书籍的获取时间和地点
  - **料理**：40 道料理，按类型（大盘 / 携带 / 攻击）筛选
- **搜索**：全文搜索（含攻略正文和笔记），支持多个关键词
- **设置**：正文字号、浅色 / 深色 / 跟随系统

原文的四种标记颜色保留不变。按原文的用法，绿色标道具和回路，紫色标人物名和谜题答案，粉色标重点提示。

## 同步原文更新

```bash
python -I tools/fetch_guide.py 3rd-walkthrough --refresh   # 重新抓取攻略正文并逐字校验
python -I tools/fetch_notes.py                             # 从 notes-tables.json 生成笔记数据
python -I tools/build.py                                   # 生成 dist/
python -I tools/build_apk.py                               # 重新打包签名 APK
```

笔记页（战斗 / 书籍 / 料理）的数据表由原站的 wpDataTables 插件服务端分页提供，
脚本直接请求会被拦下，所以数据先要用浏览器取一次：打开
<https://trails-game.com/walkthrough/3rd-notes/>，等表格加载完后在浏览器控制台执行
`fetch_notes.py` 文件头注释里的那段代码，把结果存为 `cache/raw/notes-tables.json`
（仓库里已有一份 2026-11-25 抓取的数据）。之后 `fetch_notes.py` 负责解析、
按剧情顺序规范章节排序，并修复原表中的一处错位行。

## 添加别的攻略

1. 在 `guides.json` 里加一条：`id`、`game`（游戏名）、`name`（攻略名）、`url`
2. `python -I tools/fetch_guide.py <id>`，然后执行上面的 `build.py`（和 `build_apk.py`）

`fetch_guide.py` 目前只认得「每一话一个折叠面板」的页面结构（空之轨迹3rd 剧情攻略就是这样）。
结构不同的页面需要先调整解析逻辑；脚本会自带逐字校验，文字有出入会报出来。

## 签名

`signing/release.jks` 和 `signing/signing.properties`（内含密码）是 APK 的签名密钥，第一次打包时自动生成。
**两个文件都要留好**：同一把钥匙打的新版本才能直接覆盖安装，换了钥匙 Android 会拒绝更新。

## 目录

```
guides.json        收录哪些攻略
src/app.html|css|js  应用界面
src/android/       APK 外壳（WebView）和图标
tools/             抓取、解析、构建、打包脚本
cache/             抓下来的原网页、图片、攻略和笔记解析结果（可离线重新构建）
signing/           签名密钥
dist/              成品
build/             打包的中间文件，可随时删除
```

## 许可

- 代码部分：无特别声明，可用于任何用途。
- 攻略内容（`cache/` 下解析出的文字与图片，以及打包进 APP 的内容）来自
  [轨迹系列 – Cafe](https://trails-game.com/)，遵循
  [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/deed-zh)：
  署名、非商业性使用。原站作者见 APP 内「设置 → 关于与来源」。
- `signing/` 与 `dist/`、`build/` 不进版本库：前者是密钥，后者可随时重新构建。
