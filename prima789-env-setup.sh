#!/bin/bash
# Prima789 Environment Variables Setup Script
# Version: 2.0.0
# รันด้วย: chmod +x prima789-env-setup.sh && ./prima789-env-setup.sh

echo "🚀 Prima789 × LINE Member Card - Environment Setup"
echo "=================================================="

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if netlify cli is installed
if ! command -v netlify &> /dev/null; then
    echo -e "${RED}❌ Netlify CLI ไม่ได้ติดตั้ง${NC}"
    echo "Install ด้วย: npm install -g netlify-cli"
    echo "หรือ: yarn global add netlify-cli"
    exit 1
fi

echo -e "${GREEN}✅ Netlify CLI พร้อมใช้งาน${NC}"

# Check if logged in to Netlify
if ! netlify status &> /dev/null; then
    echo -e "${YELLOW}⚠️  กรุณา login Netlify ก่อน${NC}"
    echo "รันคำสั่ง: netlify login"
    exit 1
fi

echo -e "${GREEN}✅ Netlify login สำเร็จ${NC}"

# Generate secure API key for webhook
WEBHOOK_API_KEY="PRIMA789_$(openssl rand -hex 16)"

echo ""
echo "🔐 กำลังตั้งค่า Environment Variables..."

# Core Database Configuration (Neon PostgreSQL)
echo "📊 Database Configuration..."
netlify env:set NETLIFY_DATABASE_URL "$NETLIFY_DATABASE_URL" --context production
netlify env:set NETLIFY_DATABASE_URL_UNPOOLED "$NETLIFY_DATABASE_URL_UNPOOLED" --context production

# LINE Platform Configuration
echo "📱 LINE Platform Configuration..."
read -p "LINE Channel Access Token: " LINE_ACCESS_TOKEN
read -p "LINE Channel Secret: " LINE_SECRET

netlify env:set LINE_CHANNEL_ACCESS_TOKEN "$LINE_ACCESS_TOKEN" --context production
netlify env:set LINE_CHANNEL_SECRET "$LINE_SECRET" --context production

# LIFF Apps Configuration
echo "🔗 LIFF Apps Configuration..."
read -p "LIFF ID สำหรับ Member Card: " LIFF_MEMBER
read -p "LIFF ID สำหรับ Account Linking: " LIFF_LINKING

netlify env:set LINE_LIFF_ID_MEMBER_CARD "$LIFF_MEMBER" --context production
netlify env:set LINE_LIFF_ID_ACCOUNT_LINKING "$LIFF_LINKING" --context production

# Webhook Security
echo "🔒 Webhook Security..."
netlify env:set PRIMA789_WEBHOOK_API_KEY "$WEBHOOK_API_KEY" --context production

# Prima789 Integration
echo "🎮 Prima789 Integration..."
read -p "Prima789 API URL (หรือกด Enter สำหรับ default): " PRIMA_API
PRIMA_API=${PRIMA_API:-"https://api.prima789.com"}

netlify env:set PRIMA789_API_URL "$PRIMA_API" --context production

# System Configuration
echo "⚙️  System Configuration..."
netlify env:set NETLIFY_URL "https://sliffs.netlify.app" --context production
netlify env:set NODE_ENV "production" --context production

# Optional: Admin Configuration
echo ""
read -p "ต้องการตั้งค่า Admin Panel? (y/N): " SETUP_ADMIN
if [[ $SETUP_ADMIN =~ ^[Yy]$ ]]; then
    read -p "Admin Username: " ADMIN_USER
    read -s -p "Admin Password: " ADMIN_PASS
    echo ""
    
    netlify env:set ADMIN_USERNAME "$ADMIN_USER" --context production
    netlify env:set ADMIN_PASSWORD "$ADMIN_PASS" --context production
    echo -e "${GREEN}✅ Admin Panel configured${NC}"
fi

# Optional: Monitoring
echo ""
read -p "ต้องการตั้งค่า Notification Webhook? (y/N): " SETUP_NOTIFY
if [[ $SETUP_NOTIFY =~ ^[Yy]$ ]]; then
    read -p "Discord/Slack Webhook URL: " NOTIFY_URL
    netlify env:set NOTIFICATION_WEBHOOK_URL "$NOTIFY_URL" --context production
    echo -e "${GREEN}✅ Notifications configured${NC}"
fi

echo ""
echo "🎉 Environment Variables ตั้งค่าเสร็จสิ้น!"
echo "=================================================="
echo ""
echo -e "${GREEN}📋 Summary:${NC}"
echo "• Database: Neon PostgreSQL ✅"
echo "• LINE Platform: ✅"
echo "• LIFF Apps: ✅"
echo "• Webhook Security: ✅"
echo "• System Config: ✅"

echo ""
echo -e "${YELLOW}🔑 Important - Save This API Key:${NC}"
echo -e "${GREEN}PRIMA789_WEBHOOK_API_KEY=${NC} $WEBHOOK_API_KEY"
echo ""
echo -e "${RED}⚠️  Keep this API key secure! ⚠️${NC}"
echo "นำไปใส่ในไฟล์ prima789-console-integration.js"

echo ""
echo -e "${GREEN}🔄 Next Steps:${NC}"
echo "1. อัพเดท API key ในไฟล์ integration script"
echo "2. Deploy functions ใหม่: netlify deploy --prod"
echo "3. ทดสอบระบบ"

echo ""
echo "✅ Setup Complete!"

# Create integration script with correct API key
echo ""
read -p "ต้องการสร้างไฟล์ integration script ด้วย API key ที่ถูกต้อง? (y/N): " CREATE_SCRIPT
if [[ $CREATE_SCRIPT =~ ^[Yy]$ ]]; then
    cat > prima789-console-integration-configured.js << EOF
/**
 * Prima789 Console Log Integration Script - CONFIGURED
 * Generated on: $(date)
 * API Key: $WEBHOOK_API_KEY
 */

(function() {
    'use strict';

    // Configuration - CONFIGURED WITH REAL API KEY
    const CONFIG = {
        WEBHOOK_URL: 'https://sliffs.netlify.app/.netlify/functions/transaction-webhook',
        API_KEY: '$WEBHOOK_API_KEY', // ✅ REAL API KEY CONFIGURED
        DEBUG: true,
        VERSION: '3.0.0-console-log-configured',
        // ... rest of the configuration remains the same
    };

    // Note: Use the full script from the artifact, this is just the header
    console.log('Prima789 Console Integration - API Key Configured ✅');
    
})();
EOF

    echo -e "${GREEN}✅ ไฟล์ prima789-console-integration-configured.js ถูกสร้างแล้ว${NC}"
    echo "คัดลอกเนื้อหาจาก artifact และแทนที่ CONFIG section ด้วยไฟล์นี้"
fi

echo ""
echo "🔍 ตรวจสอบ Environment Variables:"
echo "netlify env:list"

echo ""
echo "📖 Documentation:"
echo "https://docs.netlify.com/environment-variables/"