// ===== netlify/functions/utils/database.js =====
// Shared database utility functions

const { Pool } = require('pg')

// Single database connection pool instance
let pool = null

// Initialize database connection
const initializeDatabase = () => {
  if (!pool) {
    // แก้ไข: ใช้ process.env.DATABASE_URL ให้ตรงกับไฟล์ .env
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl:
        process.env.NODE_ENV === 'production'
          ? { rejectUnauthorized: false }
          : false,
      max: 10,
      min: 2,
      idleTimeoutMillis: 30000,
      acquireTimeoutMillis: 10000,
    })

    // Handle pool errors
    pool.on('error', (err) => {
      console.error('❌ Database pool error:', err)
    })

    console.log('✅ Database pool initialized')
  }
  return pool
}

// Get database connection
const getDatabase = () => {
  return initializeDatabase()
}

// Execute query with error handling
const executeQuery = async (query, params = []) => {
  const db = getDatabase()

  try {
    console.log('🔍 Executing query:', query.substring(0, 100) + '...')
    const result = await db.query(query, params)
    console.log('✅ Query success, rows:', result.rowCount)
    return result
  } catch (error) {
    console.error('❌ Query error:', error)
    throw error
  }
}

// Upsert LINE user
const upsertLineUser = async (lineUserId, profile = {}) => {
  const query = `
        INSERT INTO line_users (
            line_user_id, display_name, status_message, picture_url, 
            last_sync, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, NOW(), NOW(), NOW())
        ON CONFLICT (line_user_id) 
        DO UPDATE SET 
            display_name = EXCLUDED.display_name,
            status_message = EXCLUDED.status_message,
            picture_url = EXCLUDED.picture_url,
            last_sync = NOW(),
            updated_at = NOW()
        RETURNING *`

  const values = [
    lineUserId,
    profile.displayName || null,
    profile.statusMessage || null,
    profile.pictureUrl || null,
  ]

  const result = await executeQuery(query, values)
  console.log('✅ Line user upserted:', lineUserId)
  return result.rows[0]
}

// Check account linking status
const checkUserLinking = async (lineUserId) => {
  const query = `
        SELECT 
            al.linking_id,
            al.prima789_account_id,
            al.linked_at,
            al.is_active,
            pa.username,
            pa.email,
            pa.balance,
            pa.status as account_status
        FROM account_linking al
        JOIN prima789_accounts pa ON al.prima789_account_id = pa.account_id
        WHERE al.line_user_id = $1 AND al.is_active = true
        ORDER BY al.linked_at DESC
        LIMIT 1`

  const result = await executeQuery(query, [lineUserId])
  const isLinked = result.rows.length > 0

  console.log(`Account linking status for ${lineUserId}: ${isLinked}`)
  return {
    isLinked,
    linkData: result.rows[0] || null,
  }
}

// Upsert Prima789 account
const upsertPrima789Account = async (accountData) => {
  const query = `
        INSERT INTO prima789_accounts (
            username, email, phone, balance, status, last_login, 
            account_type, referral_code, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
        ON CONFLICT (username) 
        DO UPDATE SET 
            email = EXCLUDED.email,
            phone = EXCLUDED.phone,
            balance = EXCLUDED.balance,
            status = EXCLUDED.status,
            last_login = EXCLUDED.last_login,
            account_type = EXCLUDED.account_type,
            updated_at = NOW()
        RETURNING *`

  const values = [
    accountData.username,
    accountData.email || null,
    accountData.phone || null,
    accountData.balance || 0,
    accountData.status || 'active',
    accountData.lastLogin ? new Date(accountData.lastLogin) : null,
    accountData.accountType || 'regular',
    accountData.referralCode || null,
  ]

  const result = await executeQuery(query, values)
  console.log('✅ Prima789 account upserted:', accountData.username)
  return result.rows[0]
}

// Create account linking
const createAccountLink = async (
  lineUserId,
  prima789AccountId,
  verificationData = {}
) => {
  const query = `
        INSERT INTO account_linking (
            line_user_id, prima789_account_id, verification_code,
            verification_method, is_active, linked_at, metadata
        ) VALUES ($1, $2, $3, $4, true, NOW(), $5)
        RETURNING *`

  const values = [
    lineUserId,
    prima789AccountId,
    verificationData.code || null,
    verificationData.method || 'manual',
    JSON.stringify(verificationData.metadata || {}),
  ]

  const result = await executeQuery(query, values)
  console.log('✅ Account link created:', result.rows[0].linking_id)
  return result.rows[0]
}

// Create transaction
const createTransaction = async (transactionData) => {
  const query = `
        INSERT INTO transactions (
            prima789_account_id, line_user_id, transaction_type, amount,
            balance_before, balance_after, currency, reference_id,
            game_type, game_id, status, description, metadata, processed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING *`

  const values = [
    transactionData.accountId,
    transactionData.lineUserId || null,
    transactionData.type,
    transactionData.amount,
    transactionData.balanceBefore || 0,
    transactionData.balanceAfter || 0,
    transactionData.currency || 'THB',
    transactionData.referenceId || null,
    transactionData.gameType || null,
    transactionData.gameId || null,
    transactionData.status || 'completed',
    transactionData.description || null,
    JSON.stringify(transactionData.metadata || {}),
    transactionData.processedAt
      ? new Date(transactionData.processedAt)
      : new Date(),
  ]

  const result = await executeQuery(query, values)
  console.log('✅ Transaction created:', result.rows[0].transaction_id)
  return result.rows[0]
}

// Update account balance
const updateAccountBalance = async (accountId, newBalance) => {
  const query = `
        UPDATE prima789_accounts 
        SET balance = $2, updated_at = NOW() 
        WHERE account_id = $1
        RETURNING *`

  const result = await executeQuery(query, [accountId, newBalance])
  console.log('✅ Account balance updated:', accountId, newBalance)
  return result.rows[0]
}

// Get user balance
const getUserBalance = async (lineUserId) => {
  const query = `
        SELECT pa.balance
        FROM account_linking al
        JOIN prima789_accounts pa ON al.prima789_account_id = pa.account_id
        WHERE al.line_user_id = $1 AND al.is_active = true AND pa.status = 'active'
        LIMIT 1`

  const result = await executeQuery(query, [lineUserId])
  const balance = result.rows.length > 0 ? result.rows[0].balance : 0

  console.log(`Balance for ${lineUserId}: ${balance}`)
  return parseFloat(balance) || 0
}

// Get recent transactions
const getRecentTransactions = async (lineUserId, limit = 10) => {
  const query = `
        SELECT t.*, pa.username
        FROM transactions t
        JOIN prima789_accounts pa ON t.prima789_account_id = pa.account_id
        JOIN account_linking al ON pa.account_id = al.prima789_account_id
        WHERE al.line_user_id = $1 AND al.is_active = true
        ORDER BY t.processed_at DESC
        LIMIT $2`

  const result = await executeQuery(query, [lineUserId, limit])
  console.log(
    `Recent transactions for ${lineUserId}: ${result.rows.length} found`
  )
  return result.rows
}

// Log system event
const logSystemEvent = async (
  eventType,
  lineUserId = null,
  data = {},
  level = 'info'
) => {
  const query = `
        INSERT INTO system_logs (
            event_type, line_user_id, level, message, data, source, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
        RETURNING log_id`

  const values = [
    eventType,
    lineUserId,
    level,
    data.message || null,
    JSON.stringify(data),
    data.source || 'system',
  ]

  try {
    const result = await executeQuery(query, values)
    return result.rows[0].log_id
  } catch (error) {
    console.error('Warning: Failed to log system event:', error)
    return null
  }
}

// Health check
const checkDatabaseHealth = async () => {
  try {
    const result = await executeQuery(
      'SELECT NOW() as current_time, version() as db_version'
    )
    return {
      status: 'healthy',
      timestamp: result.rows[0].current_time,
      version: result.rows[0].db_version,
      poolSize: pool ? pool.totalCount : 0,
    }
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message,
    }
  }
}

// Close database connection (for cleanup)
const closeDatabaseConnection = async () => {
  if (pool) {
    await pool.end()
    pool = null
    console.log('✅ Database pool closed')
  }
}

module.exports = {
  // Core functions
  getDatabase,
  executeQuery,

  // User management
  upsertLineUser,
  checkUserLinking,

  // Prima789 management
  upsertPrima789Account,
  updateAccountBalance,
  getUserBalance,

  // Account linking
  createAccountLink,

  // Transactions
  createTransaction,
  getRecentTransactions,

  // System
  logSystemEvent,
  checkDatabaseHealth,
  closeDatabaseConnection,
}
