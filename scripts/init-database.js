/**
 * Database Initialization Script for Prima789 LINE Member Card
 * Run this script to set up the database schema and initial data
 * Usage: node scripts/init-database.js
 */

const { Pool } = require('pg')
const fs = require('fs')
const path = require('path')

// Load environment variables
require('dotenv').config()

const DATABASE_URL = process.env.NETLIFY_DATABASE_URL

if (!DATABASE_URL) {
  console.error('❌ NETLIFY_DATABASE_URL environment variable is required')
  process.exit(1)
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
})

async function initializeDatabase() {
  console.log('🗄️  Initializing Prima789 LINE Member Card Database...\n')

  try {
    // Test connection
    console.log('🔗 Testing database connection...')
    const client = await pool.connect()
    const result = await client.query('SELECT NOW()')
    console.log('✅ Database connected:', result.rows[0].now)
    client.release()

    // Read and execute schema
    console.log('\n📋 Creating database schema...')
    const schemaSQL = await fs.promises.readFile(
      path.join(__dirname, '..', 'database-schema.sql'),
      'utf8'
    )

    // Split and execute SQL statements
    const statements = schemaSQL
      .split(';')
      .map((stmt) => stmt.trim())
      .filter((stmt) => stmt.length > 0)

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i]
      if (statement.startsWith('--') || !statement) continue

      try {
        await pool.query(statement)
        console.log(`✅ Statement ${i + 1}/${statements.length} executed`)
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log(`⚠️  Statement ${i + 1}: Already exists, skipping`)
        } else {
          console.error(`❌ Statement ${i + 1} failed:`, error.message)
        }
      }
    }

    console.log('\n🎯 Verifying database structure...')
    await verifyTables()

    console.log('\n📊 Checking existing data...')
    await checkExistingData()

    console.log('\n🧪 Running database tests...')
    await runDatabaseTests()

    console.log('\n✅ Database initialization completed successfully!')
    console.log('\n📋 Next steps:')
    console.log('   1. Update environment variables in Netlify')
    console.log('   2. Deploy functions: netlify deploy --prod')
    console.log('   3. Test API endpoints')
    console.log('   4. Set up LINE Bot webhook')
  } catch (error) {
    console.error('❌ Database initialization failed:', error)
    process.exit(1)
  } finally {
    await pool.end()
  }
}

async function verifyTables() {
  const expectedTables = [
    'line_users',
    'prima789_accounts',
    'account_links',
    'transactions',
    'socket_sync_sessions',
    'system_logs',
  ]

  for (const tableName of expectedTables) {
    try {
      const result = await pool.query(
        `
                SELECT COUNT(*) FROM information_schema.tables 
                WHERE table_name = $1
            `,
        [tableName]
      )

      if (result.rows[0].count > 0) {
        // Get column count
        const cols = await pool.query(
          `
                    SELECT COUNT(*) FROM information_schema.columns 
                    WHERE table_name = $1
                `,
          [tableName]
        )

        console.log(
          `✅ Table '${tableName}' exists with ${cols.rows[0].count} columns`
        )
      } else {
        console.log(`❌ Table '${tableName}' not found`)
      }
    } catch (error) {
      console.error(`❌ Error checking table '${tableName}':`, error.message)
    }
  }
}

async function checkExistingData() {
  const tables = [
    'line_users',
    'prima789_accounts',
    'account_links',
    'transactions',
    'socket_sync_sessions',
    'system_logs',
  ]

  for (const table of tables) {
    try {
      const result = await pool.query(`SELECT COUNT(*) FROM ${table}`)
      const count = parseInt(result.rows[0].count)

      if (count > 0) {
        console.log(`📊 ${table}: ${count} records`)
      } else {
        console.log(`📊 ${table}: empty`)
      }
    } catch (error) {
      console.error(`❌ Error checking data in '${table}':`, error.message)
    }
  }
}

async function runDatabaseTests() {
  try {
    // Test 1: Insert test LINE user
    console.log('🧪 Test 1: Insert LINE user...')
    const testUser = await pool.query(`
            INSERT INTO line_users (line_user_id, display_name, picture_url)
            VALUES ('test_user_init', 'Test User Init', 'https://example.com/avatar.jpg')
            ON CONFLICT (line_user_id) 
            DO UPDATE SET display_name = EXCLUDED.display_name
            RETURNING *
        `)
    console.log('✅ LINE user test passed')

    // Test 2: Insert test Prima789 account
    console.log('🧪 Test 2: Insert Prima789 account...')
    const testAccount = await pool.query(`
            INSERT INTO prima789_accounts (username, first_name, last_name, available, tier)
            VALUES ('test_init_user', 'Test', 'Init User', 1000.50, 'Bronze')
            ON CONFLICT (username)
            DO UPDATE SET available = EXCLUDED.available
            RETURNING *
        `)
    console.log('✅ Prima789 account test passed')

    // Test 3: Create account link
    console.log('🧪 Test 3: Create account link...')
    await pool.query(`
            INSERT INTO account_links (line_user_id, prima789_username, link_method)
            VALUES ('test_user_init', 'test_init_user', 'test')
            ON CONFLICT (line_user_id, prima789_username)
            DO UPDATE SET is_active = TRUE
        `)
    console.log('✅ Account link test passed')

    // Test 4: Insert transaction
    console.log('🧪 Test 4: Insert transaction...')
    await pool.query(`
            INSERT INTO transactions (transaction_id, line_user_id, prima789_username, 
                                    transaction_type, amount, balance_after, description, source)
            VALUES ('test_init_txn', 'test_user_init', 'test_init_user',
                   'test', 0, 1000.50, 'Database initialization test', 'init_script')
        `)
    console.log('✅ Transaction test passed')

    // Test 5: System log
    console.log('🧪 Test 5: System log...')
    await pool.query(`
            INSERT INTO system_logs (level, source, message, user_id)
            VALUES ('INFO', 'init-database', 'Database initialization test completed', 'test_user_init')
        `)
    console.log('✅ System log test passed')

    // Test 6: Cleanup test data
    console.log('🧪 Test 6: Cleanup test data...')
    await pool.query('DELETE FROM transactions WHERE transaction_id = $1', [
      'test_init_txn',
    ])
    await pool.query('DELETE FROM account_links WHERE line_user_id = $1', [
      'test_user_init',
    ])
    await pool.query('DELETE FROM prima789_accounts WHERE username = $1', [
      'test_init_user',
    ])
    await pool.query('DELETE FROM line_users WHERE line_user_id = $1', [
      'test_user_init',
    ])
    console.log('✅ Cleanup test passed')

    console.log('✅ All database tests passed!')
  } catch (error) {
    console.error('❌ Database tests failed:', error)
    throw error
  }
}

// Add sample data for development
async function addSampleData() {
  console.log('\n🎭 Adding sample data for development...')

  try {
    // Sample Prima789 accounts
    const sampleAccounts = [
      {
        username: 'demo001',
        mm_user: 'demo001',
        first_name: 'สมชาย',
        last_name: 'ทดสอบ',
        tel: '081-234-5678',
        bank_name: 'กสิกรไทย',
        available: 15680.5,
        credit_limit: 50000,
        tier: 'Gold',
        points: 4250,
      },
      {
        username: 'vipuser99',
        mm_user: 'vipuser99',
        first_name: 'วีไอพี',
        last_name: 'เกมเมอร์',
        tel: '089-876-5432',
        bank_name: 'กรุงเทพ',
        available: 285000.75,
        credit_limit: 500000,
        tier: 'Diamond',
        points: 18900,
      },
    ]

    for (const account of sampleAccounts) {
      await pool.query(
        `
                INSERT INTO prima789_accounts (username, mm_user, first_name, last_name, tel, 
                                             bank_name, available, credit_limit, tier, points,
                                             register_time, last_login)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW() - INTERVAL '30 days', NOW())
                ON CONFLICT (username) DO NOTHING
            `,
        [
          account.username,
          account.mm_user,
          account.first_name,
          account.last_name,
          account.tel,
          account.bank_name,
          account.available,
          account.credit_limit,
          account.tier,
          account.points,
        ]
      )

      console.log(`✅ Sample account created: ${account.username}`)
    }

    console.log('✅ Sample data added successfully')
  } catch (error) {
    console.error('❌ Error adding sample data:', error)
  }
}

// Command line interface
async function main() {
  const args = process.argv.slice(2)
  const command = args[0] || 'init'

  switch (command) {
    case 'init':
      await initializeDatabase()
      break
    case 'sample':
      await addSampleData()
      break
    case 'verify':
      console.log('🔍 Verifying database...')
      await verifyTables()
      await checkExistingData()
      console.log('✅ Verification completed')
      break
    case 'test':
      console.log('🧪 Running database tests...')
      await runDatabaseTests()
      console.log('✅ Tests completed')
      break
    default:
      console.log('Usage: node init-database.js [command]')
      console.log('Commands:')
      console.log('  init    - Initialize database (default)')
      console.log('  sample  - Add sample data')
      console.log('  verify  - Verify database structure')
      console.log('  test    - Run database tests')
      break
  }

  await pool.end()
}

if (require.main === module) {
  main().catch((error) => {
    console.error('❌ Script failed:', error)
    process.exit(1)
  })
}

module.exports = {
  initializeDatabase,
  verifyTables,
  checkExistingData,
  runDatabaseTests,
}
