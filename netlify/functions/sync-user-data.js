/**
 * Sync User Data Function
 * Netlify Function: /.netlify/functions/sync-user-data
 *
 * ซิงค์ข้อมูลผู้ใช้ระหว่าง LINE และ Prima789
 */

const { Pool } = require('pg')

// Database configuration
let pool = null

function initializeDatabase() {
  if (pool) return pool

  try {
    const databaseUrl =
      process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL

    if (!databaseUrl) {
      throw new Error('Database URL not configured')
    }

    pool = new Pool({
      connectionString: databaseUrl,
      ssl: databaseUrl.includes('localhost')
        ? false
        : { rejectUnauthorized: false },
      max: 5,
      min: 1,
      idleTimeoutMillis: 30000,
    })

    console.log('✅ Database initialized for sync-user-data')
    return pool
  } catch (error) {
    console.error('❌ Database initialization failed:', error)
    throw error
  }
}

// Execute database query
async function executeQuery(query, params = []) {
  const client = initializeDatabase()

  try {
    console.log('🔍 Executing query:', query.substring(0, 100) + '...')
    const result = await client.query(query, params)
    console.log('✅ Query success, rows:', result.rowCount)
    return result
  } catch (error) {
    console.error('❌ Query error:', error)
    throw error
  }
}

// Execute transaction
async function executeTransaction(queries) {
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    const results = []
    for (const { query, params } of queries) {
      const result = await client.query(query, params)
      results.push(result)
    }

    await client.query('COMMIT')
    return results
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

// Upsert LINE user data
async function upsertLineUser(userData) {
  try {
    const query = `
            INSERT INTO line_users (
                line_user_id,
                display_name,
                picture_url,
                status_message,
                language,
                created_at,
                updated_at
            ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT (line_user_id) 
            DO UPDATE SET
                display_name = EXCLUDED.display_name,
                picture_url = EXCLUDED.picture_url,
                status_message = EXCLUDED.status_message,
                language = EXCLUDED.language,
                updated_at = CURRENT_TIMESTAMP
            RETURNING *
        `

    const params = [
      userData.userId || userData.line_user_id,
      userData.displayName || userData.display_name || null,
      userData.pictureUrl || userData.picture_url || null,
      userData.statusMessage || userData.status_message || null,
      userData.language || 'th',
    ]

    const result = await executeQuery(query, params)
    return result.rows[0]
  } catch (error) {
    console.error('❌ Error upserting LINE user:', error)
    throw error
  }
}

// Upsert Prima789 account data
async function upsertPrima789Account(accountData) {
  try {
    const query = `
            INSERT INTO prima789_accounts (
                username, mm_user, acc_no, bank_id, bank_name,
                first_name, last_name, tel, email, available,
                credit_limit, bet_credit, tier, points, 
                member_ref, register_time, last_login, is_active,
                created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
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
                register_time = COALESCE(prima789_accounts.register_time, EXCLUDED.register_time),
                last_login = EXCLUDED.last_login,
                is_active = EXCLUDED.is_active,
                updated_at = CURRENT_TIMESTAMP
            RETURNING *
        `

    const params = [
      accountData.username || accountData.mm_user,
      accountData.mm_user || accountData.username,
      accountData.acc_no || accountData.phone || accountData.tel || null,
      accountData.bank_id || null,
      accountData.bank_name || null,
      accountData.first_name || accountData.firstName || null,
      accountData.last_name || accountData.lastName || null,
      accountData.tel || accountData.phone || null,
      accountData.email || null,
      parseFloat(accountData.available || accountData.balance) || 0,
      parseFloat(accountData.credit_limit || accountData.creditLimit) || 0,
      parseFloat(accountData.bet_credit || accountData.betCredit) || 0,
      accountData.tier || 'Bronze',
      parseInt(accountData.points) || 0,
      accountData.member_ref || accountData.memberRef || null,
      accountData.register_time || accountData.registerTime || null,
      accountData.last_login || accountData.lastLogin || new Date(),
      accountData.is_active !== false,
    ]

    const result = await executeQuery(query, params)
    return result.rows[0]
  } catch (error) {
    console.error('❌ Error upserting Prima789 account:', error)
    throw error
  }
}

// Create transaction record
async function createTransaction(transactionData) {
  try {
    const query = `
            INSERT INTO transactions (
                transaction_type, user_id, username, amount,
                balance_before, balance_after, transaction_id,
                status, details, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
            RETURNING *
        `

    const params = [
      transactionData.transaction_type || 'data_sync',
      transactionData.user_id || transactionData.username,
      transactionData.username || transactionData.user_id,
      parseFloat(transactionData.amount) || 0,
      parseFloat(transactionData.balance_before) || null,
      parseFloat(transactionData.balance_after) || null,
      transactionData.transaction_id ||
        `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      transactionData.status || 'completed',
      JSON.stringify(transactionData.details || {}),
    ]

    const result = await executeQuery(query, params)
    return result.rows[0]
  } catch (error) {
    console.error('❌ Error creating transaction:', error)
    throw error
  }
}

// Log system event
async function logSystemEvent(level, source, message, details = {}) {
  try {
    const query = `
            INSERT INTO system_logs (level, source, message, details, created_at)
            VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
        `

    const params = [level, source, message, JSON.stringify(details)]

    await executeQuery(query, params)
  } catch (error) {
    console.error('❌ Error logging system event:', error)
    // Don't throw here to prevent log errors from breaking main flow
  }
}

// Sync user balance and create balance change transaction
async function syncUserBalance(username, oldBalance, newBalance, details = {}) {
  try {
    if (oldBalance === newBalance) {
      console.log('⚪ No balance change detected')
      return null
    }

    const balanceChange = newBalance - oldBalance
    const transactionType = balanceChange > 0 ? 'deposit' : 'withdrawal'

    const transactionData = {
      transaction_type: transactionType,
      username: username,
      user_id: username,
      amount: Math.abs(balanceChange),
      balance_before: oldBalance,
      balance_after: newBalance,
      transaction_id: `balance_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 6)}`,
      details: {
        source: 'sync-user-data',
        balance_change: balanceChange,
        sync_timestamp: new Date().toISOString(),
        ...details,
      },
    }

    const transaction = await createTransaction(transactionData)

    console.log(`💰 Balance ${transactionType} recorded:`, {
      username: username,
      amount: Math.abs(balanceChange),
      from: oldBalance,
      to: newBalance,
    })

    return transaction
  } catch (error) {
    console.error('❌ Error syncing user balance:', error)
    throw error
  }
}

// Perform comprehensive user data sync
async function performFullUserSync(syncData) {
  try {
    const {
      lineUser,
      prima789Account,
      source = 'api',
      metadata = {},
    } = syncData

    const syncResults = {
      lineUser: null,
      prima789Account: null,
      balanceTransaction: null,
      syncTransaction: null,
      timestamp: new Date().toISOString(),
    }

    // Sync LINE user data if provided
    if (lineUser) {
      console.log('👤 Syncing LINE user data')
      syncResults.lineUser = await upsertLineUser(lineUser)
    }

    // Sync Prima789 account data if provided
    if (prima789Account) {
      console.log('🎰 Syncing Prima789 account data')

      // Get existing account for balance comparison
      let existingAccount = null
      try {
        const existingQuery = `SELECT available FROM prima789_accounts WHERE username = $1`
        const existingResult = await executeQuery(existingQuery, [
          prima789Account.username,
        ])
        existingAccount = existingResult.rows[0]
      } catch (error) {
        console.warn(
          '⚠️ Could not fetch existing account for balance comparison'
        )
      }

      // Upsert account data
      syncResults.prima789Account = await upsertPrima789Account(prima789Account)

      // Check for balance changes and create transaction if needed
      if (existingAccount && prima789Account.available !== undefined) {
        const oldBalance = parseFloat(existingAccount.available) || 0
        const newBalance = parseFloat(prima789Account.available) || 0

        if (Math.abs(oldBalance - newBalance) >= 0.01) {
          syncResults.balanceTransaction = await syncUserBalance(
            prima789Account.username,
            oldBalance,
            newBalance,
            { sync_source: source, ...metadata }
          )
        }
      }
    }

    // Create sync transaction record
    const syncTransactionData = {
      transaction_type: 'data_sync',
      username: prima789Account?.username || lineUser?.userId,
      user_id: prima789Account?.username || lineUser?.userId,
      amount: 0,
      details: {
        source: source,
        sync_timestamp: new Date().toISOString(),
        line_user_synced: !!lineUser,
        prima789_account_synced: !!prima789Account,
        balance_change_detected: !!syncResults.balanceTransaction,
        metadata: metadata,
      },
    }

    syncResults.syncTransaction = await createTransaction(syncTransactionData)

    // Log successful sync
    await logSystemEvent(
      'INFO',
      'sync-user-data',
      'Full user sync completed successfully',
      {
        line_user_id: lineUser?.userId,
        prima789_username: prima789Account?.username,
        source: source,
        sync_results: {
          line_user_updated: !!syncResults.lineUser,
          account_updated: !!syncResults.prima789Account,
          balance_transaction_created: !!syncResults.balanceTransaction,
        },
      }
    )

    return syncResults
  } catch (error) {
    console.error('❌ Error performing full user sync:', error)

    // Log error
    await logSystemEvent('ERROR', 'sync-user-data', 'Full user sync failed', {
      error: error.message,
      line_user_id: syncData.lineUser?.userId,
      prima789_username: syncData.prima789Account?.username,
      source: syncData.source,
    })

    throw error
  }
}

// Batch sync multiple users
async function performBatchSync(batchData) {
  try {
    const results = []
    const errors = []

    console.log(`🔄 Starting batch sync for ${batchData.length} items`)

    for (let i = 0; i < batchData.length; i++) {
      try {
        const item = batchData[i]
        console.log(`⚡ Syncing batch item ${i + 1}/${batchData.length}`)

        const result = await performFullUserSync(item)
        results.push({
          index: i,
          success: true,
          data: result,
        })

        // Add small delay to prevent overwhelming the database
        if (i < batchData.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
      } catch (error) {
        console.error(`❌ Batch item ${i} failed:`, error)
        errors.push({
          index: i,
          error: error.message,
          data: batchData[i],
        })
      }
    }

    console.log(
      `✅ Batch sync completed: ${results.length} successful, ${errors.length} failed`
    )

    return {
      success: true,
      total: batchData.length,
      successful: results.length,
      failed: errors.length,
      results: results,
      errors: errors,
    }
  } catch (error) {
    console.error('❌ Error performing batch sync:', error)
    throw error
  }
}

// Main handler
exports.handler = async (event, context) => {
  console.log('🔄 Sync User Data - Start')
  console.log('📊 Request info:', {
    method: event.httpMethod,
    bodyLength: event.body ? event.body.length : 0,
  })

  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  }

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' }
  }

  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Method not allowed',
        message: 'Only POST method is supported',
      }),
    }
  }

  try {
    // Parse request body
    if (!event.body) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Request body required',
          message: 'Please provide sync data in request body',
        }),
      }
    }

    const requestData = JSON.parse(event.body)
    console.log('📋 Sync request data:', {
      isBatch: Array.isArray(requestData.data || requestData),
      hasLineUser: !!(requestData.lineUser || requestData.line_user),
      hasPrima789Account: !!(
        requestData.prima789Account || requestData.account
      ),
      source: requestData.source,
    })

    // Initialize database
    initializeDatabase()

    let syncResult

    // Check if it's a batch sync request
    if (Array.isArray(requestData.data) || Array.isArray(requestData)) {
      console.log('📦 Processing batch sync request')
      const batchData = requestData.data || requestData
      syncResult = await performBatchSync(batchData)
    } else {
      console.log('👤 Processing single user sync request')

      // Extract sync data from request
      const syncData = {
        lineUser: requestData.lineUser || requestData.line_user || null,
        prima789Account:
          requestData.prima789Account ||
          requestData.account ||
          requestData.prima789_account ||
          null,
        source: requestData.source || 'api',
        metadata: requestData.metadata || {},
      }

      // Validate that we have at least one data source
      if (!syncData.lineUser && !syncData.prima789Account) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'Invalid sync data',
            message: 'Please provide either lineUser or prima789Account data',
          }),
        }
      }

      syncResult = await performFullUserSync(syncData)
    }

    console.log('✅ User data sync completed successfully')

    const responseData = {
      success: true,
      message: Array.isArray(requestData.data || requestData)
        ? 'Batch sync completed'
        : 'User data sync completed',
      data: syncResult,
      timestamp: new Date().toISOString(),
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(responseData),
    }
  } catch (error) {
    console.error('❌ Sync user data error:', error)
    console.error('Stack trace:', error.stack)

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Internal server error',
        message: 'Failed to sync user data',
        timestamp: new Date().toISOString(),
      }),
    }
  }
}
