#!/bin/bash

# Setup Environment Variables for Prima789 LINE Member Card System
# Usage: chmod +x setup-env.sh && ./setup-env.sh

echo "🔧 Setting up environment variables for Prima789 LINE Member Card..."

# ตรวจสอบว่าติดตั้ง Netlify CLI แล้วหรือยัง
if ! command -v netlify &> /dev/nullิ; then
    echo "❌ Netlify CLI not found. Installing..."
    npm install -g netlify-cli
fi

# Login ถ้ายังไม่ได้ login
echo "🔐 Checking Netlify authentication..."
netlify status || netlify login

# ตั้งค่า Environment Variables
echo "⚙️ Setting environment variables..."

# Environment Variables for Prima789 LINE Member Card System v2.0
# Central Server Configuration

# Database (Neon PostgreSQL)
netlify env:set NETLIFY_DATABASE_URL "postgresql://neondb_owner:npg_OPZ5E4xKMyXY@ep-bold-tooth-aen7cfdv-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
netlify env:set NETLIFY_DATABASE_URL_UNPOOLED "postgresql://neondb_owner:npg_OPZ5E4xKMyXY@ep-bold-tooth-aen7cfdv-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require"

# LINE Platform
netlify env:set LINE_CHANNEL_ACCESS_TOKEN "QvDn0J5R9vwGDhLg33EB8b6TuULZP7oUF+29oRsjio3ZZHXDuEuzgHqbqp33z0xsrVQDtkMrHCWcFRLvrd9cVjMTUvVSCrLESKqe/vg59DJDpGoVq6NEzY9+mygvaQOjPBTwc12vErmLL49NKE4wUQdB04t89/1O/w1cDnyilFU="
netlify env:set LINE_CHANNEL_SECRET "e1ab5d6e54fa30aa94e83089197a5de4"

# LIFF Apps
netlify env:set LINE_LIFF_ID_MEMBER_CARD "2008090006-ZV6r9v5J"
netlify env:set LINE_LIFF_ID_ACCOUNT_LINKING "2008090006-ZMGmoOla"

# Webhook Security
netlify env:set PRIMA789_WEBHOOK_API_KEY "PRIMA789_f1922de52a8e5c6bf5b4777dabeff027"

# Netlify
netlify env:set NETLIFY_URL "https://sliffs.netlify.app"
netlify env:set NODE_ENV "production"

# Optional: Prima789 API (ถ้ามี direct API access)
netlify env:set PRIMA789_API_KEY "your_prima789_sssa"
netlify env:set PRIMA789_API_URL "https://api.prima789.net/socket.io"

# Admin Dashboard (ถ้าต้องการ)
netlify env:set ADMIN_USERNAME "admin"
netlify env:set ADMIN_PASSWORD "y2admin_password"

# Monitoring
# netlify env:set NOTIFICATION_WEBHOOK_URL "https://discord.com/api/webhooks/your_webhook_url"

# สำหรับ Development
# netlify env:set NODE_ENV "development"
# netlify env:set DEBUG_MODE "true"

echo "✅ Environment Variables configured"
echo "📝 Remember to:"
echo "   1. Replace all placeholder values with real credentials"
echo "   2. Keep PRIMA789_WEBHOOK_API_KEY secure"
echo "   3. Generate strong ADMIN_PASSWORD"
echo "   4. Test all functions after deployment"