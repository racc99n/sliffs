#!/bin/bash

# Prima789 LINE Member Card System - Deploy Script
# Version: 1.0.0

set -e

echo "🚀 Prima789 LINE Member Card System - Deploy Script"
echo "=================================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

# Check prerequisites
check_prerequisites() {
    print_info "Checking prerequisites..."
    
    # Check if netlify CLI is installed
    if ! command -v netlify &> /dev/null; then
        print_error "Netlify CLI not found. Installing..."
        npm install -g netlify-cli
        print_status "Netlify CLI installed"
    else
        print_status "Netlify CLI found"
    fi
    
    # Check if logged in to Netlify
    if ! netlify status &> /dev/null; then
        print_warning "Not logged in to Netlify. Please run 'netlify login' first"
        netlify login
    fi
    
    print_status "Prerequisites checked"
}

# Create directory structure
create_structure() {
    print_info "Creating directory structure..."
    
    mkdir -p netlify/functions
    mkdir -p public
    
    print_status "Directory structure created"
}

# Create package.json if not exists
create_package_json() {
    if [ ! -f "package.json" ]; then
        print_info "Creating package.json..."
        
        cat > package.json << 'EOF'
{
  "name": "prima789-line-member-card",
  "version": "1.0.0",
  "description": "LINE Member Card System for Prima789.com",
  "main": "index.js",
  "scripts": {
    "dev": "netlify dev",
    "build": "echo 'Static build complete'",
    "deploy": "netlify deploy --prod",
    "test": "echo 'No tests specified'"
  },
  "dependencies": {
    "pg": "^8.11.3",
    "node-fetch": "^3.3.2"
  },
  "devDependencies": {
    "netlify-cli": "^17.0.0"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/yourusername/sliffs.git"
  },
  "keywords": [
    "line",
    "liff",
    "member-card",
    "prima789",
    "netlify"
  ],
  "author": "Prima789 Team",
  "license": "MIT",
  "engines": {
    "node": ">=18.0.0"
  }
}
EOF
        
        print_status "package.json created"
    else
        print_status "package.json already exists"
    fi
}

# Create netlify.toml if not exists
create_netlify_config() {
    if [ ! -f "netlify.toml" ]; then
        print_info "Creating netlify.toml..."
        
        cat > netlify.toml << 'EOF'
[build]
  publish = "public"
  functions = "netlify/functions"

[functions]
  node_bundler = "esbuild"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200

[dev]
  functions = "netlify/functions"
  publish = "public"
  port = 8888

[context.production.environment]
  NODE_ENV = "production"

[context.deploy-preview.environment]
  NODE_ENV = "development"

[context.branch-deploy.environment]
  NODE_ENV = "development"
EOF
        
        print_status "netlify.toml created"
    else
        print_status "netlify.toml already exists"
    fi
}

# Install dependencies
install_dependencies() {
    print_info "Installing dependencies..."
    npm install
    print_status "Dependencies installed"
}

# Check if API functions exist
check_api_functions() {
    print_info "Checking API functions..."
    
    required_functions=(
        "health-check.js"
        "check-account-linking.js"
        "check-username-linking.js"
        "sync-user-data.js"
        "webhook.js"
        "link-prima789-account.js"
    )
    
    missing_functions=()
    
    for func in "${required_functions[@]}"; do
        if [ ! -f "netlify/functions/$func" ]; then
            missing_functions+=("$func")
        fi
    done
    
    if [ ${#missing_functions[@]} -gt 0 ]; then
        print_warning "Missing API functions:"
        for func in "${missing_functions[@]}"; do
            echo "  - $func"
        done
        print_info "Please create these functions in netlify/functions/ directory"
        read -p "Continue anyway? (y/n): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    else
        print_status "All API functions found"
    fi
}

# Check if public files exist
check_public_files() {
    print_info "Checking public files..."
    
    if [ ! -f "public/index.html" ]; then
        print_warning "index.html not found in public/"
        print_info "Please create index.html or copy from artifacts"
    else
        print_status "index.html found"
    fi
    
    if [ ! -f "public/liff-member-card.html" ]; then
        print_warning "liff-member-card.html not found in public/"
        print_info "Please create LIFF Member Card HTML file"
    else
        print_status "liff-member-card.html found"
    fi
    
    if [ ! -f "public/prima789-auto-sync.js" ]; then
        print_warning "prima789-auto-sync.js not found in public/"
        print_info "Please create auto-sync script file"
    else
        print_status "prima789-auto-sync.js found"
    fi
}

# Check environment variables
check_env_vars() {
    print_info "Checking environment variables..."
    
    required_vars=(
        "NETLIFY_DATABASE_URL"
        "LINE_CHANNEL_ACCESS_TOKEN"
        "LINE_CHANNEL_SECRET"
    )
    
    missing_vars=()
    
    for var in "${required_vars[@]}"; do
        if ! netlify env:get "$var" &> /dev/null; then
            missing_vars+=("$var")
        fi
    done
    
    if [ ${#missing_vars[@]} -gt 0 ]; then
        print_warning "Missing environment variables:"
        for var in "${missing_vars[@]}"; do
            echo "  - $var"
        done
        print_info "Please set these in Netlify Dashboard → Site Settings → Environment Variables"
        print_info "Or use: netlify env:set VARIABLE_NAME \"value\""
    else
        print_status "All required environment variables found"
    fi
}

# Deploy to Netlify
deploy_to_netlify() {
    print_info "Deploying to Netlify..."
    
    # Deploy with production flag
    netlify deploy --prod
    
    print_status "Deployment completed!"
}

# Test deployed APIs
test_apis() {
    print_info "Testing deployed APIs..."
    
    # Get site URL
    site_url=$(netlify status --json | grep -o '"url":"[^"]*' | cut -d'"' -f4)
    
    if [ -z "$site_url" ]; then
        print_warning "Could not get site URL, skipping API tests"
        return
    fi
    
    print_info "Site URL: $site_url"
    
    # Test health check
    print_info "Testing health check..."
    if curl -s "$site_url/.netlify/functions/health-check" | grep -q "healthy"; then
        print_status "Health check API working"
    else
        print_warning "Health check API may have issues"
    fi
    
    # Test username linking
    print_info "Testing username linking..."
    if curl -s "$site_url/.netlify/functions/check-username-linking?username=test" | grep -q "success"; then
        print_status "Username linking API working"
    else
        print_warning "Username linking API may have issues"
    fi
}

# Show deployment summary
show_summary() {
    site_url=$(netlify status --json | grep -o '"url":"[^"]*' | cut -d'"' -f4)
    
    echo ""
    echo "🎉 Deployment Summary"
    echo "===================="
    echo ""
    echo "✅ Site URL: $site_url"
    echo "✅ API Endpoints:"
    echo "   - Health Check: $site_url/.netlify/functions/health-check"
    echo "   - Account Linking: $site_url/.netlify/functions/check-account-linking"
    echo "   - Username Linking: $site_url/.netlify/functions/check-username-linking"
    echo "   - Sync Data: $site_url/.netlify/functions/sync-user-data"
    echo "   - Webhook: $site_url/.netlify/functions/webhook"
    echo "   - Prima789 Link: $site_url/.netlify/functions/link-prima789-account"
    echo ""
    echo "📱 LIFF Apps:"
    echo "   - Member Card: $site_url/liff-member-card.html"
    echo "   - Auto-Sync Script: $site_url/prima789-auto-sync.js"
    echo ""
    echo "📋 Next Steps:"
    echo "   1. Set up LIFF Apps in LINE Developers Console"
    echo "   2. Update LIFF ID in liff-member-card.html"
    echo "   3. Configure webhook URL in LINE Bot settings"
    echo "   4. Add auto-sync script to Prima789.com website"
    echo "   5. Test end-to-end functionality"
    echo ""
    echo "🔧 Configuration:"
    echo "   - Netlify Dashboard: https://app.netlify.com"
    echo "   - Function Logs: https://app.netlify.com/sites/$(basename $site_url)/logs/functions"
    echo "   - LINE Developers: https://developers.line.biz"
    echo ""
}

# Main execution
main() {
    echo ""
    print_info "Starting deployment process..."
    echo ""
    
    # Global variable for Netlify CLI command
    NETLIFY_CMD=""
    
    check_prerequisites
    create_structure
    create_package_json
    create_netlify_config
    install_dependencies
    check_api_functions
    check_public_files
    check_env_vars
    
    echo ""
    read -p "🚀 Ready to deploy? (y/n): " -n 1 -r
    echo ""
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        deploy_to_netlify
        test_apis
        show_summary
    else
        print_info "Deployment cancelled"
        exit 0
    fi
}

# Run main function
main "$@"