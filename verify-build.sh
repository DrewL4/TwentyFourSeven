#!/bin/bash

# TwentyFourSeven Docker Build Verification Script
echo "🔍 Verifying TwentyFourSeven build setup..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

check_file() {
    if [ -f "$1" ]; then
        echo -e "${GREEN}✅${NC} $1 exists"
        return 0
    else
        echo -e "${RED}❌${NC} $1 missing"
        return 1
    fi
}

check_dependencies() {
    echo -e "\n${YELLOW}📦 Checking package.json files...${NC}"
    
    # Root package.json
    check_file "package.json"
    
    # App package.json files
    check_file "apps/web/package.json"
    check_file "apps/server/package.json"
    
    # Essential build files
    check_file "turbo.json"
    check_file "apps/server/prisma/schema/schema.prisma"
    check_file "apps/server/prisma.config.ts"
}

check_node_modules() {
    echo -e "\n${YELLOW}📂 Checking node_modules...${NC}"
    
    if [ -d "node_modules" ]; then
        echo -e "${GREEN}✅${NC} Root node_modules exists"
        
        # Check for key dependencies
        local key_deps=("next" "react" "typescript" "tailwindcss" "prisma" "@prisma/client")
        
        for dep in "${key_deps[@]}"; do
            if [ -d "node_modules/$dep" ]; then
                echo -e "${GREEN}✅${NC} $dep installed"
            else
                echo -e "${RED}❌${NC} $dep missing"
            fi
        done
    else
        echo -e "${RED}❌${NC} node_modules missing - run 'npm install'"
        return 1
    fi
}

test_build() {
    echo -e "\n${YELLOW}🔨 Testing build process...${NC}"
    
    # Test TypeScript compilation
    echo "Testing TypeScript..."
    if npm run check-types > /dev/null 2>&1; then
        echo -e "${GREEN}✅${NC} TypeScript compilation successful"
    else
        echo -e "${RED}❌${NC} TypeScript compilation failed"
        echo "Run 'npm run check-types' for details"
    fi
    
    # Test Next.js builds
    echo "Testing Next.js builds..."
    if npm run build > /dev/null 2>&1; then
        echo -e "${GREEN}✅${NC} Next.js builds successful"
    else
        echo -e "${RED}❌${NC} Next.js builds failed"
        echo "Run 'npm run build' for details"
    fi
}

check_docker_files() {
    echo -e "\n${YELLOW}🐳 Checking Docker files...${NC}"
    
    check_file "Dockerfile"
    check_file "docker-compose.yml"
    check_file ".dockerignore"
    check_file "start.sh"
    check_file "nginx.conf"
}

show_build_summary() {
    echo -e "\n${YELLOW}📋 Build Summary${NC}"
    echo "====================="
    echo "Runtime: Node.js (not Python - no requirements.txt needed)"
    echo "Package Manager: npm"
    echo "Monorepo: Turborepo"
    echo "Frontend: Next.js with React + Tailwind CSS"
    echo "Backend: Next.js API with Prisma + SQLite"
    echo "Proxy: Nginx"
    echo ""
    echo "Key Dependencies:"
    echo "- Frontend: React 19, Next.js 15, Tailwind CSS 4, Radix UI"
    echo "- Backend: Prisma, Better Auth, Fast XML Parser"
    echo "- Build: TypeScript, Turbo"
    echo ""
    echo "Container Ports:"
    echo "- 80: Nginx (main entry point)"
    echo "- 3000: API Server"
    echo "- 3001: Web UI"
}

show_quick_commands() {
    echo -e "\n${YELLOW}🚀 Quick Commands${NC}"
    echo "====================="
    echo "Install dependencies:     npm install"
    echo "Development server:       npm run dev"
    echo "Build for production:     npm run build"
    echo "Build Docker image:       docker build -t twentyfourseven:latest ."
    echo "Run with docker-compose:  docker-compose up"
    echo "Check environment:        npm run check-env"
}

# Run all checks
main() {
    echo -e "${GREEN}TwentyFourSeven Build Verification${NC}"
    echo "=================================="
    
    check_dependencies
    check_node_modules
    check_docker_files
    
    # Only run build test if node_modules exists
    if [ -d "node_modules" ]; then
        test_build
    else
        echo -e "\n${YELLOW}⚠️${NC} Skipping build test - install dependencies first"
    fi
    
    show_build_summary
    show_quick_commands
    
    echo -e "\n${GREEN}✨ Verification complete!${NC}"
}

main "$@" 