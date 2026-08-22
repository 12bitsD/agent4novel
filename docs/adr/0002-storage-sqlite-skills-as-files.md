# 存储：SQLite 存作品产物，prompt/skill 存 SKILL.md 文件

创作产物（脑洞/卖点/梗概/大纲/章纲/正文/设定）存单文件 SQLite（better-sqlite3），带 version 与 human_status 列支撑关卡。prompt/skill 是 config-as-code，存为遵循 Agent Skills 规范的 SKILL.md 文件而非数据库行，使"坏例 → 改 skill → 重跑步骤"的迭代闭环成为纯文件操作。
