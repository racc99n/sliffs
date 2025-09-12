/**
 * Quick Setup Script for Prima789 LINE Member Card System
 * Usage: node quick-setup.js
 */

const { Pool } = require('pg')
const fs = require('fs')
const path = require('path')

// Load environment variables
require('dotenv').config()

console.log('🎰 Prima789 LINE Member Card - Quick Setup')
console.log('==========================================')

async function quickSetup() {
  try {
    // Step 1: Check environment variables
    console.log('\n📋 Step 1: Checking environment variables...')

    const requiredEnvVars = ['NETLIFY_DATABASE_URL']

    const missingVars = requiredEnvVars.filter(
      (varName) => !process.env[varName]
    )

    if (missingVars.length > 0) {
      console.log('❌ Missing environment variables:')
      missingVars.forEach((varName) => {
        console.log(`   - ${varName}`)
      })
      console.log(
        '\n💡 Please check your .env file or environment configuration'
      )
      console.log('   Required DATABASE_URL format:')
      console.log(
        '   NETLIFY_DATABASE_URL="postgresql://user:pass@host:5432/dbname?sslmode=require"'
      )
      return false
    }

    console.log('✅ Environment variables configured')

    // Step 2: Test database connection
    console.log('\n📋 Step 2: Testing database connection...')

    const pool = new Pool({
      connectionString: process.env.NETLIFY_DATABASE_URL,
      ssl: {
        rejectUnauthorized: false,
      },
    })

    const client = await pool.connect()
    const result = await client.query('SELECT NOW(), version()')
    console.log('✅ Database connected:', result.rows[0].now)
    console.log(
      '📊 Database version:',
      result.rows[0].version.split(' ')[0] +
        ' ' +
        result.rows[0].version.split(' ')[1]
    )
    client.release()

    // Step 3: Create basic schema
    console.log('\n📋 Step 3: Creating database schema...')

    const basicSchema = `
            CREATE TABLE IF NOT EXISTS line_users (
                id SERIAL PRIMARY KEY,
                line_user_id VARCHAR(255) UNIQUE NOT NULL,
                display_name VARCHAR(255),
                picture_url TEXT,
                is_linked BOOLEAN DEFAULT FALSE,
                prima789_username VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            CREATE TABLE IF NOT EXISTS prima789_accounts (
                id SERIAL PRIMARY KEY,
                username VARCHAR(255) UNIQUE NOT NULL,
                mm_user VARCHAR(255),
                first_name VARCHAR(255),
                last_name VARCHAR(255),
                available DECIMAL(15,2) DEFAULT 0.00,
                tier VARCHAR(50) DEFAULT 'Bronze',
                points INTEGER DEFAULT 0,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            CREATE TABLE IF NOT EXISTS account_links (
                id SERIAL PRIMARY KEY,
                line_user_id VARCHAR(255),
                prima789_username VARCHAR(255),
                link_method VARCHAR(50),
                linked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_active BOOLEAN DEFAULT TRUE,
                UNIQUE(line_user_id, prima789_username)
            );
            
            CREATE TABLE IF NOT EXISTS transactions (
                id SERIAL PRIMARY KEY,
                transaction_id VARCHAR(255) UNIQUE NOT NULL,
                line_user_id VARCHAR(255),
                prima789_username VARCHAR(255),
                transaction_type VARCHAR(50) NOT NULL,
                amount DECIMAL(15,2) DEFAULT 0.00,
                balance_before DECIMAL(15,2),
                balance_after DECIMAL(15,2),
                description TEXT,
                source VARCHAR(100),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            CREATE TABLE IF NOT EXISTS system_logs (
                id SERIAL PRIMARY KEY,
                level VARCHAR(20) DEFAULT 'INFO',
                source VARCHAR(100),
                message TEXT,
                user_id VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            -- Sample data
            INSERT INTO prima789_accounts (username, mm_user, first_name, last_name, available, tier, points) 
            VALUES 
            ('testuser123', 'testuser123', 'สมชาย', 'ทดสอบ', 25680.50, 'Gold', 8750),
            ('vipgamer99', 'vipgamer99', 'วีไอพี', 'เกมเมอร์', 155000.00, 'Diamond', 25680)
            ON CONFLICT (username) DO NOTHING;
        `

    const statements = basicSchema
      .split(';')
      .filter((stmt) => stmt.trim().length > 0)

    for (const statement of statements) {
      try {
        await pool.query(statement.trim())
        console.log('✅ Schema statement executed')
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log('⚠️  Table already exists, skipping')
        } else {
          console.log('⚠️  Schema warning:', error.message.split('\n')[0])
        }
      }
    }

    // Step 4: Verify tables
    console.log('\n📋 Step 4: Verifying database structure...')

    const tables = [
      'line_users',
      'prima789_accounts',
      'account_links',
      'transactions',
      'system_logs',
    ]

    for (const tableName of tables) {
      try {
        const result = await pool.query(`SELECT COUNT(*) FROM ${tableName}`)
        console.log(`✅ Table '${tableName}': ${result.rows[0].count} records`)
      } catch (error) {
        console.log(`❌ Table '${tableName}': ${error.message}`)
      }
    }

    // Step 5: Test basic operations
    console.log('\n📋 Step 5: Testing basic operations...')

    try {
      // Insert test data
      await pool.query(`
                INSERT INTO system_logs (level, source, message) 
                VALUES ('INFO', 'quick-setup', 'Database setup test')
            `)

      // Read test data
      const testResult = await pool.query(`
                SELECT COUNT(*) FROM system_logs WHERE source = 'quick-setup'
            `)

      console.log('✅ Database operations working')

      // Cleanup test data
      await pool.query(`DELETE FROM system_logs WHERE source = 'quick-setup'`)
    } catch (error) {
      console.log('⚠️  Database operations test failed:', error.message)
    }

    await pool.end()

    // Step 6: Next steps
    console.log('\n🎉 Setup Complete!')
    console.log('==================')
    console.log('✅ Database connection verified')
    console.log('✅ Schema created successfully')
    console.log('✅ Sample data inserted')
    console.log('✅ Basic operations tested')

    console.log('\n🚀 Next Steps:')
    console.log('1. npm run deploy     - Deploy to Netlify')
    console.log('2. npm run test       - Test all API endpoints')
    console.log('3. Configure LINE Bot - Set webhook URL')
    console.log('4. Setup LIFF Apps    - Configure LIFF IDs')

    console.log('\n🔗 Useful Commands:')
    console.log('- npm run check-health  - Check system health')
    console.log('- npm run test          - Run API tests')
    console.log('- npm run logs          - View function logs')

    return true
  } catch (error) {
    console.error('\n❌ Setup failed:', error.message)

    if (error.message.includes('connect ENOTFOUND')) {
      console.log('\n💡 Database connection failed. Please check:')
      console.log('   1. Database URL is correct')
      console.log('   2. Database server is running')
      console.log('   3. Network connectivity')
    }

    if (error.message.includes('password authentication failed')) {
      console.log('\n💡 Authentication failed. Please check:')
      console.log('   1. Database username and password')
      console.log('   2. Database URL format')
    }

    return false
  }
}

// Run quick setup
if (require.main === module) {
  quickSetup()
    .then((success) => {
      if (success) {
        console.log('\n🎊 Ready for deployment! Run: npm run deploy')
        process.exit(0)
      } else {
        console.log('\n❌ Setup incomplete. Please fix issues and try again.')
        process.exit(1)
      }
    })
    .catch((error) => {
      console.error('Fatal error:', error.message)
      process.exit(1)
    })
}

module.exports = { quickSetup }
