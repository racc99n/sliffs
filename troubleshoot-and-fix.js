#!/usr/bin/env node

// ===== SLIFFS Troubleshoot & Fix Script =====
// ตรวจสอบและแก้ไขปัญหา HTTP 500 errors

const { Client } = require('pg');
const fetch = require('node-fetch');

console.log('🔧 SLIFFS Troubleshoot & Fix - Starting...\n');

class SLIFFSTroubleshooter {
    constructor() {
        this.issues = [];
        this.fixes = [];
    }

    // Check if DATABASE_URL is set
    checkEnvironmentVariables() {
        console.log('🔍 Checking environment variables...');
        
        if (!process.env.DATABASE_URL) {
            this.issues.push({
                type: 'env',
                message: 'DATABASE_URL not found',
                severity: 'critical'
            });
            console.log('❌ DATABASE_URL not set');
            return false;
        }
        
        console.log('✅ DATABASE_URL is set');
        return true;
    }

    // Test database connection
    async testDatabaseConnection() {
        console.log('🔍 Testing database connection...');
        
        if (!process.env.DATABASE_URL) {
            console.log('⚠️ Skipping database test - no DATABASE_URL');
            return false;
        }

        try {
            const client = new Client({
                connectionString: process.env.DATABASE_URL,
                ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
            });

            await client.connect();
            const result = await client.query('SELECT version(), NOW()');
            await client.end();

            console.log('✅ Database connection successful');
            console.log('   Version:', result.rows[0].version.substring(0, 50) + '...');
            return true;

        } catch (error) {
            this.issues.push({
                type: 'database',
                message: 'Database connection failed',
                error: error.message,
                severity: 'critical'
            });
            console.log('❌ Database connection failed:', error.message);
            return false;
        }
    }

    // Check if tables exist
    async checkDatabaseTables() {
        console.log('🔍 Checking database tables...');

        try {
            const client = new Client({
                connectionString: process.env.DATABASE_URL,
                ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
            });

            await client.connect();

            const query = `
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name IN ('line_users', 'prima789_accounts', 'account_linking', 'transactions', 'system_logs')
                ORDER BY table_name`;

            const result = await client.query(query);
            await client.end();

            const existingTables = result.rows.map(row => row.table_name);
            const requiredTables = ['line_users', 'prima789_accounts', 'account_linking', 'transactions', 'system_logs'];
            const missingTables = requiredTables.filter(table => !existingTables.includes(table));

            if (missingTables.length > 0) {
                this.issues.push({
                    type: 'schema',
                    message: 'Missing database tables',
                    missingTables,
                    severity: 'critical'
                });
                console.log('❌ Missing tables:', missingTables.join(', '));
                return false;
            }

            console.log('✅ All required tables exist:', existingTables.join(', '));
            return true;

        } catch (error) {
            this.issues.push({
                type: 'schema',
                message: 'Cannot check database schema',
                error: error.message,
                severity: 'high'
            });
            console.log('❌ Schema check failed:', error.message);
            return false;
        }
    }

    // Test API functions
    async testAPIFunctions() {
        console.log('🔍 Testing API functions...');

        const baseUrl = 'https://sliffs.netlify.app/.netlify/functions';
        const tests = [
            { name: 'health-check', method: 'GET', data: null },
            { name: 'check-account-linking', method: 'POST', data: { lineUserId: 'test-user-123' } }
        ];

        for (const test of tests) {
            try {
                console.log(`   Testing: ${test.name}`);

                const response = await fetch(`${baseUrl}/${test.name}`, {
                    method: test.method,
                    headers: test.data ? { 'Content-Type': 'application/json' } : {},
                    body: test.data ? JSON.stringify(test.data) : undefined
                });

                const result = await response.json();

                if (response.ok) {
                    console.log(`   ✅ ${test.name}: OK`);
                } else {
                    this.issues.push({
                        type: 'api',
                        function: test.name,
                        status: response.status,
                        message: result.message || result.error,
                        severity: 'high'
                    });
                    console.log(`   ❌ ${test.name}: ${response.status} - ${result.message || result.error}`);
                }

            } catch (error) {
                this.issues.push({
                    type: 'api',
                    function: test.name,
                    error: error.message,
                    severity: 'high'
                });
                console.log(`   ❌ ${test.name}: ${error.message}`);
            }
        }
    }

    // Create database schema
    async createDatabaseSchema() {
        console.log('🔧 Creating database schema...');

        try {
            const client = new Client({
                connectionString: process.env.DATABASE_URL,
                ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
            });

            await client.connect();

            // Enable UUID extension
            await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
            console.log('✅ UUID extension enabled');

            // Create line_users table
            const lineUsersTable = `
                CREATE TABLE IF NOT EXISTS line_users (
                    line_user_id VARCHAR(255) PRIMARY KEY,
                    display_name VARCHAR(255),
                    status_message TEXT,
                    picture_url TEXT,
                    language VARCHAR(10) DEFAULT 'th',
                    is_active BOOLEAN DEFAULT true,
                    last_sync TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                )`;

            await client.query(lineUsersTable);
            console.log('✅ line_users table created');

            // Create prima789_accounts table
            const prima789Table = `
                CREATE TABLE IF NOT EXISTS prima789_accounts (
                    account_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                    username VARCHAR(255) UNIQUE NOT NULL,
                    email VARCHAR(255),
                    phone VARCHAR(20),
                    balance DECIMAL(15,2) DEFAULT 0.00,
                    status VARCHAR(20) DEFAULT 'active',
                    last_login TIMESTAMP WITH TIME ZONE,
                    registration_date TIMESTAMP WITH TIME ZONE,
                    account_type VARCHAR(20) DEFAULT 'regular',
                    referral_code VARCHAR(50),
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                )`;

            await client.query(prima789Table);
            console.log('✅ prima789_accounts table created');

            // Create account_linking table
            const linkingTable = `
                CREATE TABLE IF NOT EXISTS account_linking (
                    linking_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                    line_user_id VARCHAR(255) NOT NULL REFERENCES line_users(line_user_id) ON DELETE CASCADE,
                    prima789_account_id UUID NOT NULL REFERENCES prima789_accounts(account_id) ON DELETE CASCADE,
                    verification_code VARCHAR(100),
                    verification_method VARCHAR(50) DEFAULT 'manual',
                    is_active BOOLEAN DEFAULT true,
                    linked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    verified_at TIMESTAMP WITH TIME ZONE,
                    last_verified TIMESTAMP WITH TIME ZONE,
                    metadata JSONB DEFAULT '{}',
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                )`;

            await client.query(linkingTable);
            console.log('✅ account_linking table created');

            // Create transactions table
            const transactionsTable = `
                CREATE TABLE IF NOT EXISTS transactions (
                    transaction_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                    prima789_account_id UUID NOT NULL REFERENCES prima789_accounts(account_id) ON DELETE CASCADE,
                    line_user_id VARCHAR(255) REFERENCES line_users(line_user_id) ON DELETE SET NULL,
                    transaction_type VARCHAR(50) NOT NULL,
                    amount DECIMAL(15,2) NOT NULL,
                    balance_before DECIMAL(15,2) DEFAULT 0.00,
                    balance_after DECIMAL(15,2) DEFAULT 0.00,
                    currency VARCHAR(10) DEFAULT 'THB',
                    reference_id VARCHAR(255),
                    game_type VARCHAR(50),
                    game_id VARCHAR(100),
                    status VARCHAR(20) DEFAULT 'completed',
                    description TEXT,
                    metadata JSONB DEFAULT '{}',
                    processed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                )`;

            await client.query(transactionsTable);
            console.log('✅ transactions table created');

            // Create system_logs table
            const systemLogsTable = `
                CREATE TABLE IF NOT EXISTS system_logs (
                    log_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                    event_type VARCHAR(100) NOT NULL,
                    line_user_id VARCHAR(255) REFERENCES line_users(line_user_id) ON DELETE SET NULL,
                    prima789_account_id UUID REFERENCES prima789_accounts(account_id) ON DELETE SET NULL,
                    level VARCHAR(20) DEFAULT 'info',
                    message TEXT,
                    data JSONB DEFAULT '{}',
                    source VARCHAR(100),
                    ip_address INET,
                    user_agent TEXT,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                )`;

            await client.query(systemLogsTable);
            console.log('✅ system_logs table created');

            // Insert sample user for testing
            const insertSampleUser = `
                INSERT INTO line_users (line_user_id, display_name, status_message, picture_url) 
                VALUES (
                    'U82f011b7b3355e52775a80b6dbf1cf7d', 
                    'Slacz', 
                    'work until expensive becomes cheap',
                    'https://profile.line-scdn.net/0hDu5PnH_IG1oYKQ5Ani'
                ) ON CONFLICT (line_user_id) DO NOTHING`;

            await client.query(insertSampleUser);
            console.log('✅ Sample user inserted');

            await client.end();

            this.fixes.push({
                type: 'schema',
                message: 'Database schema created successfully'
            });

            return true;

        } catch (error) {
            console.log('❌ Schema creation failed:', error.message);
            return false;
        }
    }

    // Run comprehensive troubleshooting
    async runDiagnosis() {
        console.log('🔍 Running comprehensive diagnosis...\n');

        // Check environment
        const hasEnv = this.checkEnvironmentVariables();
        
        if (!hasEnv) {
            console.log('\n❌ Cannot proceed without DATABASE_URL');
            console.log('Please create .env file with your database connection string');
            return false;
        }

        // Test database connection
        const dbConnected = await this.testDatabaseConnection();
        
        if (!dbConnected) {
            console.log('\n❌ Cannot proceed without database connection');
            return false;
        }

        // Check schema
        const tablesExist = await this.checkDatabaseTables();
        
        if (!tablesExist) {
            console.log('\n🔧 Creating missing database schema...');
            const schemaCreated = await this.createDatabaseSchema();
            
            if (!schemaCreated) {
                console.log('❌ Failed to create schema');
                return false;
            }
        }

        // Test API functions
        console.log('');
        await this.testAPIFunctions();

        return true;
    }

    // Generate report
    generateReport() {
        console.log('\n📊 Diagnosis Report:');
        console.log('==================');

        if (this.issues.length === 0) {
            console.log('✅ No issues found! System should be working correctly.');
        } else {
            console.log(`❌ Found ${this.issues.length} issues:`);
            this.issues.forEach((issue, i) => {
                console.log(`${i + 1}. [${issue.severity.toUpperCase()}] ${issue.type}: ${issue.message}`);
                if (issue.error) console.log(`   Error: ${issue.error}`);
            });
        }

        if (this.fixes.length > 0) {
            console.log('\n🔧 Applied fixes:');
            this.fixes.forEach((fix, i) => {
                console.log(`${i + 1}. ${fix.type}: ${fix.message}`);
            });
        }

        console.log('\n📋 Next Steps:');
        if (this.issues.length === 0) {
            console.log('✅ System is ready! Try your LIFF app again.');
        } else {
            console.log('1. Fix the critical issues listed above');
            console.log('2. Redeploy your functions: npm run deploy');
            console.log('3. Test again: node troubleshoot-and-fix.js');
        }
    }
}

// Load environment from .env if exists
function loadEnv() {
    try {
        const fs = require('fs');
        const path = require('path');
        const envPath = path.join(process.cwd(), '.env');
        
        if (fs.existsSync(envPath)) {
            const envContent = fs.readFileSync(envPath, 'utf8');
            const envLines = envContent.split('\n').filter(line => line.trim() && !line.startsWith('#'));
            
            envLines.forEach(line => {
                const [key, ...valueParts] = line.split('=');
                const value = valueParts.join('=').trim();
                if (key && value) {
                    process.env[key.trim()] = value;
                }
            });
            console.log('✅ Loaded environment from .env file');
        } else {
            console.log('⚠️ No .env file found, using system environment');
        }
    } catch (error) {
        console.log('⚠️ Failed to load .env file:', error.message);
    }
}

// Main execution
async function main() {
    loadEnv();
    
    const troubleshooter = new SLIFFSTroubleshooter();
    
    try {
        const success = await troubleshooter.runDiagnosis();
        troubleshooter.generateReport();
        
        if (success && troubleshooter.issues.length === 0) {
            console.log('\n🎉 All systems operational!');
            process.exit(0);
        } else {
            console.log('\n⚠️ Issues found that need attention');
            process.exit(1);
        }
    } catch (error) {
        console.error('\n❌ Troubleshooting failed:', error);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main();
}

module.exports = { SLIFFSTroubleshooter };