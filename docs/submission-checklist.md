# 提交前检查单（店智 Copilot）

> 用法：提交前从上到下走一遍，每项打勾。预计 10 分钟（不含录视频）。
> 最近一次核验：2026-10-28 21:10

## 0. 只有人能做的三件事

- [ ] `README.md`「团队信息」填真实姓名 / 学校 / 专业（当前「待填」）
- [ ] 录制演示视频：按 `docs/video-script.md`，5–8 min、1080p、普通话、带字幕，导出 MP4
- [ ] （加分，可选）公网演示地址 + 评审体验账号

## 1. 密钥与隐私（2 min）

```powershell
# 1) 真实 env 不得入库（应无输出）
git ls-files | Select-String -Pattern '(^|/)\.env$|backend/\.env$'

# 2) 代码与文档不得出现密钥（应无输出）
git grep -n -E "sk-[A-Za-z0-9]{16,}|DEEPSEEK_API_KEY=.+[A-Za-z0-9]{16,}"

# 3) 本地库/索引/日志不得入库（应无输出）
git ls-files | Select-String -Pattern 'data/(app|store)\.db|data/index/|\.log$'
```
- [ ] 以上三条均无输出
- [ ] 截图与录屏画面里没有 `.env`、API Key、真实客户信息

## 2. 构建与冒烟（3 min）

```powershell
npx tsc --noEmit
npm run lint
npm run build
node scripts/smoke.mjs
```
- [ ] 前三条退出码 0
- [ ] smoke **11/11 PASS**，退出码 0（需 3000 + 8000 已启动）

## 3. 文档事实一致性（2 min）

```powershell
# 43 篇语料 / 12 段场景 / 20 单种子 / 4 个入口
(Get-ChildItem data\raw -Filter *.md).Count          # 43
(Select-String docs\scenarios.md -Pattern '^## 场景 ').Count
python -c "import sqlite3;print(sqlite3.connect('data/store.db').execute('select count(*) from orders').fetchone()[0])"

# PDF：页数与口径
python -c "from pypdf import PdfReader;r=PdfReader('docs/tech-doc.pdf');t=''.join((p.extract_text() or '') for p in r.pages);print(len(r.pages), '43 篇' in t, '40 篇' in t, 'v1.1' in t)"
```
- [ ] 43 / 12 / 20 / 4 四个数字与 README、`docs/positioning.md` 一致
- [ ] PDF ≤30 页，且输出 `10 True False True`（10 页 / 含 43 篇 / 不含 40 篇 / v1.1）
- [ ] 禁用词只出现在竞品对比或「禁止表述」语境：
  `git grep -n -E "智能客服 Agent|智能客服系统|客服工作台|一键转人工|转人工协同"`

## 4. Git 与仓库（2 min）

```powershell
git status --short          # 应为空
git log --oneline -10       # 至少有脚手架 / RAG / Agent / UI / 文档 等语义提交
git remote -v               # origin 指向公开仓库
git push -u origin master
```
- [ ] 工作区干净（无未提交改动）
- [ ] 远端仓库为 **Public**，默认分支可访问
- [ ] 仓库首页 README 能直接看到：定位、四个入口、运行步骤、团队信息

## 5. 提交物清单

- [ ] 代码仓库链接（Public）
- [ ] `docs/tech-doc.pdf`（v1.1，10 页）
- [ ] 演示视频 MP4（5–8 min，1080p）
- [ ] README（含团队信息、架构、快速开始）
- [ ] `.env.example` + `backend/.env.example`
- [ ] （可选）公网演示地址

## 6. 最后 60 秒

- [ ] 用无痕窗口打开仓库，确认不用登录也能看
- [ ] 下载 PDF 与视频各打开一次，确认没坏
- [ ] 把提交链接 / 附件按大赛要求命名后上传
