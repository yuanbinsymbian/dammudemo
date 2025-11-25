## 前置检查
- 确认当前工作目录就是需要推送的项目根目录（例如 `pwd`、`ls`）。
- 检查是否已是 Git 仓库：`git rev-parse --is-inside-work-tree` 与 `git status`。
- 如未设置 Git 用户信息，配置一次：`git config --global user.name "你的名字"`、`git config --global user.email "你的邮箱"`。

## 初始化与首个提交
- 若当前目录不是 Git 仓库：执行 `git init` 并将默认分支统一为 `main`：`git branch -M main`。
- 可选：若不存在 `.gitignore`，添加至少忽略 `.DS_Store` 的基础规则以避免无用文件进入仓库。
- 将现有文件纳入首个提交：`git add -A`、`git commit -m "Initial commit"`。

## 关联远程仓库
- 设置远程 `origin` 指向你的仓库（默认使用 HTTPS）：`git remote add origin https://github.com/yuanbinsymbian/dammudemo.git`。
- 若已存在 `origin`：使用 `git remote set-url origin https://github.com/yuanbinsymbian/dammudemo.git` 更新地址。
- 如你偏好 SSH 并已配置公钥，也可使用：`git remote add origin git@github.com:yuanbinsymbian/dammudemo.git`。

## 推送与验证
- 推送到远程 `main`：`git push -u origin main`。
- 验证远程地址：`git remote -v` 显示为 `https://github.com/yuanbinsymbian/dammudemo.git`（或 `git@github.com:...`）。
- 在浏览器打开仓库页面，确认文件已到位。

## 认证与常见问题
- HTTPS 方式：可能会提示登录或需要使用 GitHub Personal Access Token（PAT，需包含 `repo` 权限）。
- SSH 方式：确保本机公钥已添加到 GitHub 账户；如认证失败，检查密钥与 `ssh -T git@github.com`。
- 若远程仓库并非完全空且存在历史：先执行 `git pull --rebase origin main`，解决冲突后再 `git push`。

## 完成与后续
- 后续开发只需常规工作流：`git add` → `git commit` → `git push`。
- 可选增强：启用受保护分支、添加 `.gitattributes` 统一换行符策略、根据项目类型完善 `.gitignore`。

请确认是否按以上步骤进行（默认使用 HTTPS 远程，如需改为 SSH 请说明），我即可开始执行并把本地项目与该 GitHub 仓库成功连接。