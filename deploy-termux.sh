#!/data/data/com.termux/files/usr/bin/bash
# ============================================================
#  Questflow2API - Termux 一键部署脚本
#  自动检测环境，增量安装，绿色更新
#  GitHub: https://github.com/yangeshenshi/Questflow2api
# ============================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

PROJECT_DIR="$HOME/Questflow2api"
REPO_URL="https://github.com/yangeshenshi/Questflow2api.git"

echo ""
echo -e "${BLUE}╔══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Questflow2API - Termux 一键部署     ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════╝${NC}"
echo ""

# ============================================================
# 辅助函数
# ============================================================
check_cmd() { command -v "$1" &>/dev/null; }

step_done() { echo -e "  ${GREEN}✅${NC} $1"; }
step_skip() { echo -e "  ${YELLOW}⏭️${NC}  $1 (已有)"; }
step_install() { echo -e "  ${CYAN}📦${NC} 正在安装 $1..."; }

# ============================================================
# 1. 检测并安装 pkg 依赖
# ============================================================
echo -e "${YELLOW}[1/5] 检测基础环境...${NC}"

# 更新 pkg（仅首次或超过 24 小时）
PKG_CACHE="$HOME/.questflow2api_pkg_updated"
if [ ! -f "$PKG_CACHE" ] || [ $(($(date +%s) - $(stat -c %Y "$PKG_CACHE" 2>/dev/null || echo 0))) -gt 86400 ]; then
    step_install "更新包列表"
    pkg update -y -qq
    pkg upgrade -y -qq
    touch "$PKG_CACHE"
else
    step_skip "包列表 (24h 内已更新)"
fi

# ============================================================
# 2. 检测并安装 Node.js
# ============================================================
echo -e "${YELLOW}[2/5] 检测 Node.js...${NC}"

if check_cmd node; then
    NODE_VER=$(node -v)
    step_done "Node.js $NODE_VER"
else
    step_install "Node.js"
    pkg install -y nodejs
    step_done "Node.js $(node -v)"
fi

# ============================================================
# 3. 检测并安装 Git / 同步项目
# ============================================================
echo -e "${YELLOW}[3/5] 检测项目...${NC}"

if check_cmd git; then
    step_done "Git $(git --version | grep -oP '[\d.]+')"
else
    step_install "Git"
    pkg install -y git
    step_done "Git 安装完成"
fi

if [ -d "$PROJECT_DIR/.git" ]; then
    echo -e "  ${CYAN}🔄${NC} 项目已存在，增量更新..."
    cd "$PROJECT_DIR"
    
    # 检查是否有未提交的修改
    if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
        echo -e "  ${YELLOW}⚠️${NC}  检测到本地修改，stash 后更新"
        git stash
    fi
    
    git pull origin main
    step_done "代码已更新到最新"
else
    if [ -d "$PROJECT_DIR" ]; then
        echo -e "  ${YELLOW}⚠️${NC}  目录存在但非 git 仓库，备份后重新克隆"
        mv "$PROJECT_DIR" "$PROJECT_DIR.bak.$(date +%s)"
    fi
    step_install "克隆项目"
    git clone "$REPO_URL" "$PROJECT_DIR"
    cd "$PROJECT_DIR"
    step_done "项目克隆完成"
fi

# ============================================================
# 4. 检测并安装 npm 依赖
# ============================================================
echo -e "${YELLOW}[4/5] 检测 npm 依赖...${NC}"

cd "$PROJECT_DIR"

if [ -d "node_modules" ] && [ -f "package-lock.json" ]; then
    # 检查 package.json 是否比 node_modules 新
    if [ package.json -nt node_modules ]; then
        echo -e "  ${YELLOW}📦${NC} package.json 已更新，重新安装依赖"
        npm install
    else
        step_skip "npm 依赖"
    fi
else
    step_install "npm 依赖"
    npm install
    step_done "依赖安装完成"
fi

# ============================================================
# 5. 构建并配置
# ============================================================
echo -e "${YELLOW}[5/5] 构建项目...${NC}"

npm run build 2>/dev/null && step_done "TypeScript 编译完成" || {
    echo -e "  ${RED}❌${NC} 编译失败，尝试用 ts-node 运行"
}

# 配置 .env
if [ ! -f ".env" ]; then
    cp .env.example .env
    echo ""
    echo -e "${YELLOW}╔══════════════════════════════════════════╗${NC}"
    echo -e "${YELLOW}║  ⚠️  请编辑 .env 填入认证信息          ║${NC}"
    echo -e "${YELLOW}╚══════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "  ${RED}必须填写：${NC}"
    echo -e "    ${CYAN}QUESTFLOW_AUTH_TOKEN${NC}=你的完整Cookie"
    echo -e "    ${CYAN}QUESTFLOW_COMPANY_ID${NC}=你的公司ID"
    echo ""
    echo -e "  ${YELLOW}📱 手机端更方便：启动后访问配置面板${NC}"
    echo -e "     http://<手机IP>:3000/config.html"
    echo ""
    echo -e "  ${GREEN}获取方法：${NC}"
    echo -e "    1. 浏览器登录 https://next.questflow.ai/"
    echo -e "    2. F12 → Network → 发一条消息"
    echo -e "    3. 找到 /api/v6/copilot/stream 请求"
    echo -e "    4. 复制完整 Cookie 和 companyId"
    echo ""
    echo -e "  ${YELLOW}编辑命令：${NC}"
    echo -e "    nano .env"
    echo ""
else
    step_done ".env 已配置"
fi

# ============================================================
# 完成
# ============================================================
# 获取本机 IP
LOCAL_IP=$(ip -4 addr show wlan0 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | head -1)

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║          ✅  部署完成！                ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${CYAN}启动服务：${NC}"
echo -e "    cd \$HOME/Questflow2api && npm start"
echo ""
echo -e "  ${CYAN}后台运行 (Termux:Boot 推荐)：${NC}"
echo -e "    nohup npm start > questflow.log 2>&1 &"
echo ""
if [ -n "$LOCAL_IP" ]; then
    echo -e "  ${CYAN}访问地址：${NC}"
    echo -e "    http://${LOCAL_IP}:3000/config.html  (配置面板)"
    echo -e "    http://${LOCAL_IP}:3000/v1            (API 端点)"
else
    echo -e "  ${CYAN}本机访问：${NC}"
    echo -e "    http://localhost:3000/config.html"
fi
echo ""
echo -e "  ${YELLOW}💡 提示：手机浏览器打开配置面板即可修改 ${NC}"
echo -e "  ${YELLOW}    .env，无需手动编辑文件。${NC}"
echo ""
