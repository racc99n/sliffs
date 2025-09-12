const { Pool } = require('pg')

// Database connection pool
let pool = null

/**
 * Get database connection pool
 */
function getPool() {
  if (!pool) {
    const connectionString = process.env.NETLIFY_DATABASE_URL

    if (!connectionString) {
      throw new Error('Database connection string not found')
    }

    pool = new Pool({
      connectionString: connectionString,
      ssl: {
        rejectUnauthorized: false,
      },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    })

    pool.on('error', (err) => {
      console.error('Database pool error:', err)
    })
  }

  return pool
}

/**
 * Execute a database query
 */
async function query(text, params = []) {
  const client = getPool()
  const start = Date.now()

  try {
    const result = await client.query(text, params)
    const duration = Date.now() - start

    console.log('Query executed:', {
      text: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
      duration: duration + 'ms',
      rows: result.rowCount,
    })

    return result
  } catch (error) {
    console.error('Database query error:', {
      text: text.substring(0, 100),
      error: error.message,
      duration: Date.now() - start + 'ms',
    })
    throw error
  }
}

/**
 * Test database connection
 */
async function testConnection() {
  try {
    const result = await query(
      'SELECT NOW() as server_time, version() as db_version'
    )
    return {
      connected: true,
      server_time: result.rows[0].server_time,
      db_version:
        result.rows[0].db_version.split(' ')[0] +
        ' ' +
        result.rows[0].db_version.split(' ')[1],
      pool_total: pool?.totalCount || 0,
      pool_idle: pool?.idleCount || 0,
    }
  } catch (error) {
    return {
      connected: false,
      error: error.message,
    }
  }
}

/**
 * Log system event
 */
async function logSystemEvent(
  level,
  source,
  message,
  data = null,
  userId = null
) {
  try {
    await query(
      `INSERT INTO system_logs (level, source, message, data, user_id) 
             VALUES ($1, $2, $3, $4, $5)`,
      [level, source, message, data ? JSON.stringify(data) : null, userId]
    )
  } catch (error) {
    console.error('Failed to log system event:', error)
  }
}

// ====================
// LINE USERS FUNCTIONS
// ====================

/**
 * Create or update LINE user
 */
async function upsertLineUser(userProfile) {
  const { userId, displayName, pictureUrl, statusMessage, language } =
    userProfile

  const result = await query(
    `
        INSERT INTO line_users (line_user_id, display_name, picture_url, status_message, language)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (line_user_id)
        DO UPDATE SET
            display_name = EXCLUDED.display_name,
            picture_url = EXCLUDED.picture_url,
            status_message = EXCLUDED.status_message,
            language = EXCLUDED.language,
            updated_at = CURRENT_TIMESTAMP
        RETURNING *
    `,
    [userId, displayName, pictureUrl, statusMessage, language || 'th']
  )

  await logSystemEvent(
    'INFO',
    'upsertLineUser',
    `User upserted: ${displayName}`,
    userProfile,
    userId
  )

  return result.rows[0]
}

/**
 * Get LINE user by ID
 */
async function getLineUser(lineUserId) {
  const result = await query(
    'SELECT * FROM line_users WHERE line_user_id = $1',
    [lineUserId]
  )

  return result.rows[0] || null
}

/**
 * Check if user is linked
 */
async function checkUserLinking(lineUserId) {
  const result = await query(
    `
        SELECT 
            lu.*,
            al.prima789_username,
            al.link_method,
            al.linked_at,
            pa.available as balance,
            pa.tier,
            pa.points,
            pa.total_transactions,
            pa.first_name,
            pa.last_name
        FROM line_users lu
        LEFT JOIN account_links al ON lu.line_user_id = al.line_user_id AND al.is_active = TRUE
        LEFT JOIN prima789_accounts pa ON al.prima789_username = pa.username
        WHERE lu.line_user_id = $1
    `,
    [lineUserId]
  )

  const user = result.rows[0]
  if (!user) return null

  return {
    ...user,
    is_linked: !!user.prima789_username,
  }
}

// ========================
// PRIMA789 USERS FUNCTIONS
// ========================

/**
 * Search Prima789 account by various criteria
 */
async function searchPrima789Account(searchCriteria) {
  const { username, phone, displayName, mm_user } = searchCriteria

  let whereClause = 'WHERE is_active = TRUE'
  let params = []
  let paramCount = 0

  if (username) {
    paramCount++
    whereClause += ` AND (username ILIKE $${paramCount} OR mm_user ILIKE $${paramCount})`
    params.push(`%${username}%`)
  }

  if (phone) {
    paramCount++
    whereClause += ` AND (tel = $${paramCount} OR acc_no = $${paramCount})`
    params.push(phone)
  }

  if (displayName) {
    paramCount++
    whereClause += ` AND (CONCAT(first_name, ' ', last_name) ILIKE $${paramCount})`
    params.push(`%${displayName}%`)
  }

  if (mm_user) {
    paramCount++
    whereClause += ` AND mm_user = $${paramCount}`
    params.push(mm_user)
  }

  const result = await query(
    `
        SELECT * FROM prima789_accounts 
        ${whereClause}
        ORDER BY last_login DESC, updated_at DESC
        LIMIT 5
    `,
    params
  )

  return result.rows
}

/**
 * Get Prima789 account by username
 */
async function getPrima789Account(username) {
  const result = await query(
    'SELECT * FROM prima789_accounts WHERE username = $1 AND is_active = TRUE',
    [username]
  )

  return result.rows[0] || null
}

/**
 * Create or update Prima789 account
 */
async function upsertPrima789Account(accountData) {
  const {
    username,
    mm_user,
    acc_no,
    bank_id,
    bank_name,
    first_name,
    last_name,
    tel,
    email,
    available,
    credit_limit,
    bet_credit,
    tier = 'Bronze',
    points = 0,
    member_ref,
    register_time,
    last_login,
  } = accountData

  const result = await query(
    `
        INSERT INTO prima789_accounts (
            username, mm_user, acc_no, bank_id, bank_name,
            first_name, last_name, tel, email, available,
            credit_limit, bet_credit, tier, points,
            member_ref, register_time, last_login
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        ON CONFLICT (username)
        DO UPDATE SET
            mm_user = EXCLUDED.mm_user,
            acc_no = EXCLUDED.acc_no,
            bank_id = EXCLUDED.bank_id,
            bank_name = EXCLUDED.bank_name,
            first_name = EXCLUDED.first_name,
            last_name = EXCLUDED.last_name,
            tel = EXCLUDED.tel,
            email = EXCLUDED.email,
            available = EXCLUDED.available,
            credit_limit = EXCLUDED.credit_limit,
            bet_credit = EXCLUDED.bet_credit,
            tier = EXCLUDED.tier,
            points = EXCLUDED.points,
            member_ref = EXCLUDED.member_ref,
            last_login = EXCLUDED.last_login,
            updated_at = CURRENT_TIMESTAMP
        RETURNING *
    `,
    [
      username,
      mm_user,
      acc_no,
      bank_id,
      bank_name,
      first_name,
      last_name,
      tel,
      email,
      available,
      credit_limit,
      bet_credit,
      tier,
      points,
      member_ref,
      register_time,
      last_login,
    ]
  )

  // Update transaction count
  if (result.rows[0]) {
    await updateTransactionCount(username)
  }

  await logSystemEvent(
    'INFO',
    'upsertPrima789Account',
    `Account upserted: ${username}`,
    accountData
  )

  return result.rows[0]
}

/**
 * Update Prima789 account balance
 */
async function updateAccountBalance(username, newBalance, source = 'api') {
  const result = await query(
    `
        UPDATE prima789_accounts 
        SET available = $2, updated_at = CURRENT_TIMESTAMP
        WHERE username = $1 AND is_active = TRUE
        RETURNING *
    `,
    [username, newBalance]
  )

  if (result.rows[0]) {
    await logSystemEvent(
      'INFO',
      'updateAccountBalance',
      `Balance updated for ${username}: ${newBalance}`,
      { source, new_balance: newBalance }
    )
  }

  return result.rows[0]
}

// =======================
// ACCOUNT LINKING FUNCTIONS
// =======================

/**
 * Create account link
 */
async function createAccountLink(
  lineUserId,
  prima789Username,
  linkMethod = 'manual'
) {
  const client = getPool()

  try {
    await client.query('BEGIN')

    // Create the link
    const linkResult = await client.query(
      `
            INSERT INTO account_links (line_user_id, prima789_username, link_method)
            VALUES ($1, $2, $3)
            ON CONFLICT (line_user_id, prima789_username)
            DO UPDATE SET
                is_active = TRUE,
                link_method = EXCLUDED.link_method,
                linked_at = CURRENT_TIMESTAMP
            RETURNING *
        `,
      [lineUserId, prima789Username, linkMethod]
    )

    // Update LINE user as linked
    await client.query(
      `
            UPDATE line_users 
            SET is_linked = TRUE, prima789_username = $2, updated_at = CURRENT_TIMESTAMP
            WHERE line_user_id = $1
        `,
      [lineUserId, prima789Username]
    )

    await client.query('COMMIT')

    await logSystemEvent(
      'INFO',
      'createAccountLink',
      `Account linked: ${lineUserId} -> ${prima789Username}`,
      {
        line_user_id: lineUserId,
        prima789_username: prima789Username,
        method: linkMethod,
      }
    )

    return linkResult.rows[0]
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

/**
 * Remove account link
 */
async function removeAccountLink(lineUserId) {
  const client = getPool()

  try {
    await client.query('BEGIN')

    // Deactivate the link
    await client.query(
      `
            UPDATE account_links 
            SET is_active = FALSE
            WHERE line_user_id = $1
        `,
      [lineUserId]
    )

    // Update LINE user as unlinked
    await client.query(
      `
            UPDATE line_users 
            SET is_linked = FALSE, prima789_username = NULL, updated_at = CURRENT_TIMESTAMP
            WHERE line_user_id = $1
        `,
      [lineUserId]
    )

    await client.query('COMMIT')

    await logSystemEvent(
      'INFO',
      'removeAccountLink',
      `Account unlinked: ${lineUserId}`,
      { line_user_id: lineUserId }
    )

    return true
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

// ==================
// TRANSACTION FUNCTIONS
// ==================

/**
 * Create transaction record
 */
async function createTransaction(transactionData) {
  const {
    transaction_id,
    line_user_id,
    prima789_username,
    transaction_type,
    amount = 0,
    balance_before,
    balance_after,
    description,
    source = 'api',
    details = {},
  } = transactionData

  const result = await query(
    `
        INSERT INTO transactions (
            transaction_id, line_user_id, prima789_username,
            transaction_type, amount, balance_before, balance_after,
            description, source, details
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
    `,
    [
      transaction_id,
      line_user_id,
      prima789_username,
      transaction_type,
      amount,
      balance_before,
      balance_after,
      description,
      source,
      JSON.stringify(details),
    ]
  )

  // Update transaction count
  if (prima789_username) {
    await updateTransactionCount(prima789_username)
  }

  return result.rows[0]
}

/**
 * Get transactions for user
 */
async function getUserTransactions(lineUserId, limit = 10) {
  const result = await query(
    `
        SELECT t.*, pa.first_name, pa.last_name, pa.tier
        FROM transactions t
        LEFT JOIN prima789_accounts pa ON t.prima789_username = pa.username
        WHERE t.line_user_id = $1
        ORDER BY t.created_at DESC
        LIMIT $2
    `,
    [lineUserId, limit]
  )

  return result.rows
}

/**
 * Update transaction count for Prima789 account
 */
async function updateTransactionCount(prima789Username) {
  await query(
    `
        UPDATE prima789_accounts 
        SET total_transactions = (
            SELECT COUNT(*) 
            FROM transactions 
            WHERE prima789_username = $1
        ),
        updated_at = CURRENT_TIMESTAMP
        WHERE username = $1
    `,
    [prima789Username]
  )
}

// ====================
// SOCKET SYNC FUNCTIONS
// ====================

/**
 * Create socket sync session
 */
async function createSocketSyncSession(lineUserId, expirationMinutes = 10) {
  const syncId =
    'sync_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)

  const result = await query(
    `
        INSERT INTO socket_sync_sessions (sync_id, line_user_id, expires_at)
        VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '${expirationMinutes} minutes')
        RETURNING *
    `,
    [syncId, lineUserId]
  )

  return result.rows[0]
}

/**
 * Complete socket sync session
 */
async function completeSocketSyncSession(syncId, prima789Data) {
  const result = await query(
    `
        UPDATE socket_sync_sessions 
        SET status = 'completed', 
            prima789_data = $2,
            completed_at = CURRENT_TIMESTAMP
        WHERE sync_id = $1
        RETURNING *
    `,
    [syncId, JSON.stringify(prima789Data)]
  )

  return result.rows[0]
}

/**
 * Get socket sync session
 */
async function getSocketSyncSession(syncId) {
  const result = await query(
    'SELECT * FROM socket_sync_sessions WHERE sync_id = $1',
    [syncId]
  )

  return result.rows[0] || null
}

/**
 * Clean up expired socket sync sessions
 */
async function cleanupExpiredSyncSessions() {
  const result = await query(`
        UPDATE socket_sync_sessions 
        SET status = 'expired'
        WHERE expires_at < CURRENT_TIMESTAMP AND status = 'waiting'
    `)

  return result.rowCount
}

// ===============
// UTILITY FUNCTIONS
// ===============

/**
 * Get user statistics
 */
async function getUserStats(lineUserId) {
  const result = await query(
    `
        SELECT 
            COUNT(CASE WHEN transaction_type IN ('deposit', 'win', 'bonus') THEN 1 END) as total_income_transactions,
            COUNT(CASE WHEN transaction_type IN ('withdraw', 'bet') THEN 1 END) as total_expense_transactions,
            SUM(CASE WHEN transaction_type IN ('deposit', 'win', 'bonus') THEN amount ELSE 0 END) as total_income,
            SUM(CASE WHEN transaction_type IN ('withdraw', 'bet') THEN amount ELSE 0 END) as total_expenses,
            COUNT(*) as total_transactions,
            MAX(created_at) as last_transaction_date
        FROM transactions 
        WHERE line_user_id = $1
    `,
    [lineUserId]
  )

  return (
    result.rows[0] || {
      total_income_transactions: 0,
      total_expense_transactions: 0,
      total_income: 0,
      total_expenses: 0,
      total_transactions: 0,
      last_transaction_date: null,
    }
  )
}

/**
 * Get dashboard stats
 */
async function getDashboardStats() {
  const result = await query(`
        SELECT 
            (SELECT COUNT(*) FROM line_users) as total_line_users,
            (SELECT COUNT(*) FROM line_users WHERE is_linked = TRUE) as linked_users,
            (SELECT COUNT(*) FROM prima789_accounts WHERE is_active = TRUE) as total_prima789_accounts,
            (SELECT COUNT(*) FROM transactions WHERE created_at > CURRENT_DATE) as today_transactions,
            (SELECT COUNT(*) FROM socket_sync_sessions WHERE status = 'waiting') as pending_sync_sessions
    `)

  return result.rows[0]
}

module.exports = {
  // Database
  query,
  testConnection,
  logSystemEvent,

  // LINE Users
  upsertLineUser,
  getLineUser,
  checkUserLinking,

  // Prima789 Accounts
  searchPrima789Account,
  getPrima789Account,
  upsertPrima789Account,
  updateAccountBalance,

  // Account Linking
  createAccountLink,
  removeAccountLink,

  // Transactions
  createTransaction,
  getUserTransactions,
  updateTransactionCount,

  // Socket Sync
  createSocketSyncSession,
  completeSocketSyncSession,
  getSocketSyncSession,
  cleanupExpiredSyncSessions,

  // Statistics
  getUserStats,
  getDashboardStats,
}
