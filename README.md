# D2 Save Editor · 暗黑破坏神 II 1.13c 存档修改器

单文件、纯离线的浏览器工具，用于直接编辑《暗黑破坏神 II》1.13c 的 `.d2s` 人物存档：人物属性与装备属性。

打开 `index.html` 即可使用：无需安装、无需联网、无需后端，存档全程只在浏览器本地处理，不会上传到任何服务器。

- **适用版本**：Diablo II 1.13c（Lord of Destruction，存档版本 `0x60`）
- **处理对象**：仅 `.d2s` 人物存档。共享仓库 / 地图缓存（`.d2x`、`.key`、`.ma0~3`、`.map`、`.UDI` 等）不在范围内
- **界面语言**：简体中文；物品与词缀名取自官方中文版游戏字符串表，英文原名保留在详情标题与列表悬停提示中

## 功能

**人物属性**：力量、敏捷、体力、精力、剩余属性点、剩余技能点、生命、法力、耐力、等级、经验、身上金币、仓库金币。带合法范围限制与快捷预设（等级 99、金币全满等）；等级会同步写入文件头。

**装备属性**：角色身上、镶嵌物、雇佣兵、尸体、石魔上的全部物品逐件展开；每条魔法属性显示中文名 + 英文名 + 原值 + 合法范围，可直接改数值。物品等级、防御、耐久、数量、孔数等基础字段同样可编辑。支持中英文混合搜索。

**安全写入**：采用原位位覆写（in-place bit patching），只改动目标数值所在的位区间，不重新序列化整个存档 —— 文件大小不变、未编辑字段零改动、不增删属性条目、不破坏未知字节。自动重算 D2S 校验和与文件长度；8.8 定点生命 / 法力 / 耐力的原始小数位也会保留。

加载时会校验魔数、版本、解析是否精确到达 EOF、校验和是否有效，四项结果直接显示在界面上。

## 使用方法

1. **先备份原始存档**（重要）。
2. 下载本仓库的 `index.html`，双击用 Edge 或 Chrome 打开；也可使用下方 GitHub Pages 在线地址。
3. 点击「选择文件」载入 `.d2s`。
4. 在「人物属性」或「装备属性」页修改数值，点击「保存修改」。
5. 浏览器下载 `原文件名_mod.d2s`。**完全退出游戏后**，把它改名回原文件名，覆盖游戏 `Save` 目录下的原文件。
6. 进入游戏检查；若出现异常，用第 1 步的备份还原。

### 在线使用（GitHub Pages）

仓库已开启 GitHub Pages，直接访问：

```
https://leifung.github.io/d2-save-editor/
```

如果是在自己的 fork 上重新启用：`Settings → Pages` → `Deploy from a branch` → 分支 `main`、目录 `/ (root)`。

Pages 只是静态托管根目录的 `index.html`；`FileReader` 读取的存档依然只在你的浏览器里处理，不会上传。

## 实现原理

D2S 的物品段是 LSB-first 的位流，不是字节对齐结构：

- 用 `BitReader` 逐位读取；魔法属性为 9-bit ID 循环，遇 `0x1FF` 结束；每条属性按 1.13c `ItemStatCost` 的 Save Bits / Save Add / Save Param Bits / Encode 解码。
- 解析时为每个可编辑数值记录一个**位锚点**：绝对位偏移、位宽、解码元数据。写入时只覆写这些位区间。
- 生命 / 法力 / 耐力是 8.8 定点数，编辑时保留低 8 位小数。
- 保存时按标准算法重算校验和（对除校验和字段外的全部字节累加，含进位），并同步文件长度字段。

解析器以 dschu012/d2s 的 TypeScript 实现为权威参考逐行移植。开发中遇到的位流错位，根因是物品结构分支处理有误（Rare/Crafted 名称循环、防御与耐久字段、尸体段结构），而非属性位宽常量不对。

## 目录结构

| 文件 | 说明 |
| --- | --- |
| `index.html` | **成品**：单文件离线工具，也是 GitHub Pages 入口（约 200 KB） |
| `d2s_engine.js` | 解析 / 编辑引擎（位读写、锚点、校验和），可独立用 Node 加载测试 |
| `tool_template.html` | 界面模板，含 `__D2S_DATA_JSON__` / `__D2S_ENGINE_JS__` 两个占位符 |
| `d2s_data.json` | 内嵌常量：魔法属性位宽、物品表、职业、技能、英文名表 |
| `item_cn.json` | 简体中文物品 / 词缀 / 暗金 / 套装 / 符文之语名映射 |
| `build_html.py` | 一键把数据 + 引擎内联进模板，重建 `index.html` |
| `core.py` | Python 参考实现（解析 + 位锚点 + 编辑），含详细注释 |
| `export_data.py` | 从完整常量表导出精简的 `d2s_data.json` |
| `roundtrip.py` | load → edit → save → reload 回环测试 |
| `parse_tbl.py` | `.tbl` 字符串表解析（中文名数据再生成用） |
| `gen_item_cn.py` | 繁体转简体 + 清洗，生成 `item_cn.json` |

## 从源码重建

只需要 Python 3，无第三方依赖：

```bash
python3 build_html.py                 # 生成 index.html
python3 build_html.py my-tool.html    # 或指定输出文件名
```

`build_html.py` 读取同目录下的 `tool_template.html`、`d2s_engine.js`、`d2s_data.json`。数据已随仓库提供，这条链路可完全离线复现。

回环测试（需要一个 1.13c 的 `.d2s`）：

```bash
python3 roundtrip.py /path/to/your/save.d2s
```

`core.py` / `export_data.py` / `gen_item_cn.py` 属于**数据再生成工具**，需要额外外部输入，不是运行本工具的依赖：

- `core.py`、`export_data.py` 需要 dschu012/d2s 的 `ref/d2s/src_data_versions_96_constant_data.ts`（v96 常量表）。
- `gen_item_cn.py` 需要中文版游戏 MPQ 解出的三张 `zh_*.tbl`，以及 `pip install zhconv`。TBL 的 MPQ 提取用到 PKWARE implode 解压实现，出于许可原因未包含在本仓库。

## 数据来源与致谢

- 文件格式与常量表：[dschu012/d2s](https://github.com/dschu012/d2s)，v96 常量（源自完整版 `ItemStatCost.txt`，含 Save Param Bits / CSvBits / Signed 列）。
- 中文物品名：中文版游戏 `Patch_D2.mpq` 内 `data\local\LNG\chi\` 下的 `string.tbl` / `expansionstring.tbl` / `patchstring.tbl`，为 UTF-8 繁体，已统一转简体并去除汉化时拼接在后面的英文原名。
- MPQ 解压参考：PKWARE implode 的 Python 实现 `pwexplode.py`（Sven Kochmann，GPL-3.0），仅用于离线提取字符串表；其代码未包含在本仓库，也不是运行时依赖。

## 验证情况

- 3 个不同的真实存档（88 级亚马逊 2543 B、3 级女法师 1007 B、9 级亚马逊 2056 B）均精确解析到 EOF、校验和有效，共 111 件装备 100% 显示中文名。
- Python 回环 7/7、Node 引擎 26/26、内联 HTML 18/18、真实浏览器端到端 24/24 全部通过。
- 全量位锚点按显示值重写后，除校验和字段外逐字节完全一致。

## 免责声明

仅供个人学习与单机存档研究使用。修改存档可能导致存档损坏或角色数据异常，**务必先备份**。请勿用于在线 / 对战环境或违反游戏服务条款的用途。仓库未附带游戏文件、人物存档或受版权保护的游戏资源；中文名映射仅为字符串对照表。
