#!/data/data/com.termux/files/usr/bin/bash
# ============================================================
#  Questflow2API - Termux 一键部署脚本
#  将 Questflow AI 反向代理为 OpenAI 兼容 API
#  GitHub: https://github.com/yangeshenshi/Questflow2api
# ============================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}   Questflow2API - Termux 一键部署${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# 1. 更新 pkg
echo -e "${YELLOW}[1/5] 更新包管理器...${NC}"
pkg update -y && pkg upgrade -y

# 2. 安装依赖
echo -e "${YELLOW}[2/5] 安装 Node.js 和 git...${NC}"
pkg install -y nodejs git

# 3. 克隆项目
echo -e "${YELLOW}[3/5] 克隆项目...${NC}"
if [ -d "Questflow2api" ]; then
    echo "目录已存在，更新代码..."
    cd Questflow2api
    git pull
else
    git clone https://github.com/yangeshenshi/Questflow2api.git
    cd Questflow2api
fi

# 4. 安装 npm 依赖
echo -e "${YELLOW}[4/5] 安装 npm 依赖...${NC}"
npm install

# 5. 配置
echo -e "${YELLOW}[5/5] 配置环境变量...${NC}"
if [ ! -f ".env" ]; then
    cp .env.example .env
    echo ""
    echo -e "${RED}⚠️  请编辑 .env 文件，填入你的 Questflow 认证信息：${NC}"
    echo -e "${RED}   nano .env${NC}"
    echo ""
    echo -e "${YELLOW}必须修改的字段：${NC}"
    echo -e "  QUESTFLOW_AUTH_TOKEN=你的完整Cookie字符串"
    echo -e "  QUESTFLOW_COMPANY_ID=你的公司ID"
    echo ""
    echo -e "${YELLOW}获取方法：${NC}"
    echo -e "  1. 浏览器登录 https://next.questflow.ai/"
    echo -e "  2. F12 → Network → 发一条消息"
    echo -e "  3. 找到 /api/v6/copilot/stream 请求"
    echo -e "  4. 复制完整 Cookie 和请求体中的 companyId"
    echo ""
    echo -e "${GREEN}配置完成后运行:${NC}"
    echo -e "  npm start"
    echo ""
    echo -e "${BLUE}服务地址: http://localhost:3000${NC}"
    echo -e "${BLUE}API 端点: http://localhost:3000/v1/chat/completions${NC}"
else
    echo -e "${GREEN}✅ .env 已存在，跳过配置${NC}"
    echo ""
    echo -e "${GREEN}启动服务:${NC}"
    echo -e "  npm start"
    echo ""
    echo -e "${BLUE}服务地址: http://localhost:3000${NC}"
    echo -e "${BLUE}API 端点: http://localhost:3000/v1/chat/completions${NC}"
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}   部署完成！${NC}"
echo -e "${GREEN}========================================${NC}"
