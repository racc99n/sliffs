/**
 * Prima789 Transaction Webhook - Enhanced Error Handling
 * Handles all transaction data from Prima789 console integration
 */

const { Pool } = require('pg')

// Database configuration with enhanced error handling
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
      connectionTimeoutMillis: 10000,
      acquireTimeoutMillis: 10000,
    })

    pool.on('error', (err) => {
      console.error('Database pool error:', err)
    })

    console.log('✅ Database pool initialized')
    return pool
  } catch (error) {
    console.error('❌ Database initialization failed:', error)
    throw error
  }
}

// Enhanced database utilities
async function executeQuery(query, params = []) {
  const client = initializeDatabase()

  try {
    console.log('🔍 Executing query:', query.substring(0, 100) + '...')
    console.log('📊 Parameters:', params)

    const result = await client.query(query, params)
    console.log('✅ Query executed successfully, rows:', result.rowCount)

    return result
  } catch (error) {
    console.error('❌ Database query error:', error)
    console.error('Query:', query)
    console.error('Params:', params)
    throw error
  }
}

// Upsert Prima789 account
async function upsertPrima789Account(accountData) {
  try {
    const query = `
            INSERT INTO prima789_accounts (
                username, mm_user, acc_no, bank_id, bank_name, 
                first_name, last_name, tel, email, available, 
                credit_limit, bet_credit, tier, points, 
                member_ref, register_time, last_login, is_active
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
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
                last_login = EXCLUDED.last_login,
                updated_at = CURRENT_TIMESTAMP
            RETURNING id, username, available, updated_at;
        `

    const params = [
      accountData.username || accountData.mm_user,
      accountData.mm_user || accountData.username,
      accountData.acc_no || null,
      accountData.bank_id || null,
      accountData.bank_name || null,
      accountData.first_name || null,
      accountData.last_name || null,
      accountData.tel || accountData.phone || null,
      accountData.email || null,
      parseFloat(accountData.available) || 0,
      parseFloat(accountData.credit_limit) || 0,
      parseFloat(accountData.bet_credit) || 0,
      accountData.tier || 'Bronze',
      parseInt(accountData.points) || 0,
      accountData.member_ref || null,
      accountData.register_time || accountData.registerTime || new Date(),
      new Date(),
      true,
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
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING id, transaction_id, created_at;
        `

    const params = [
      transactionData.transaction_type,
      transactionData.user_id,
      transactionData.username,
      parseFloat(transactionData.amount) || 0,
      parseFloat(transactionData.balance_before) || null,
      parseFloat(transactionData.balance_after) || null,
      transactionData.transaction_id,
      'completed',
      JSON.stringify(transactionData.details || {}),
      new Date(transactionData.timestamp),
    ]

    const result = await executeQuery(query, params)
    return result.rows[0]
  } catch (error) {
    console.error('❌ Error creating transaction:', error)
    throw error
  }
}

// Log system events
async function logSystemEvent(level, source, message, details = {}) {
  try {
    const query = `
            INSERT INTO system_logs (level, source, message, details, created_at)
            VALUES ($1, $2, $3, $4, $5);
        `

    const params = [level, source, message, JSON.stringify(details), new Date()]

    await executeQuery(query, params)
  } catch (error) {
    console.error('❌ Error logging system event:', error)
    // Don't throw here to prevent log errors from breaking main flow
  }
}

// Validate transaction data
function validateTransactionData(data) {
  const errors = []

  if (!data) {
    errors.push('Transaction data is required')
    return errors
  }

  if (!data.transaction_type) {
    errors.push('transaction_type is required')
  }

  if (!data.user_id && !data.username) {
    errors.push('user_id or username is required')
  }

  if (!data.transaction_id) {
    errors.push('transaction_id is required')
  }

  // Validate transaction types
  const validTypes = [
    'user_login',
    'deposit',
    'withdrawal',
    'data_sync',
    'heartbeat',
    'transaction',
    'system_event',
  ]

  if (data.transaction_type && !validTypes.includes(data.transaction_type)) {
    errors.push(`Invalid transaction_type: ${data.transaction_type}`)
  }

  return errors
}

// Process transaction data
async function processTransaction(transactionData) {
  console.log('🔄 Processing transaction:', transactionData.transaction_type)

  try {
    // Validate data
    const validationErrors = validateTransactionData(transactionData)
    if (validationErrors.length > 0) {
      throw new Error(`Validation failed: ${validationErrors.join(', ')}`)
    }

    let result = {}

    // Process based on transaction type
    switch (transactionData.transaction_type) {
      case 'user_login':
        result = await processUserLogin(transactionData)
        break

      case 'data_sync':
        result = await processDataSync(transactionData)
        break

      case 'deposit':
      case 'withdrawal':
        result = await processBalanceTransaction(transactionData)
        break

      case 'heartbeat':
        result = await processHeartbeat(transactionData)
        break

      case 'system_event':
        result = await processSystemEvent(transactionData)
        break

      default:
        result = await processGenericTransaction(transactionData)
    }

    console.log('✅ Transaction processed successfully:', result)
    return result
  } catch (error) {
    console.error('❌ Error processing transaction:', error)

    // Log error to database
    await logSystemEvent(
      'ERROR',
      'transaction-processor',
      `Failed to process ${transactionData.transaction_type}`,
      {
        error: error.message,
        transaction_id: transactionData.transaction_id,
        user_id: transactionData.user_id,
      }
    )

    throw error
  }
}

// Process user login
async function processUserLogin(transactionData) {
  console.log('👤 Processing user login')

  // Extract user data from transaction details
  const userData = transactionData.details?.user_data || {}
  const username = transactionData.user_id || transactionData.username

  // Upsert Prima789 account
  const accountData = {
    username: username,
    mm_user: username,
    ...userData,
  }

  const account = await upsertPrima789Account(accountData)
  const transaction = await createTransaction(transactionData)

  return {
    type: 'user_login',
    account_id: account?.id,
    transaction_id: transaction?.id,
    username: username,
  }
}

// Process data sync
async function processDataSync(transactionData) {
  console.log('🔄 Processing data sync')

  const userData = transactionData.details?.user_data || {}
  const username = transactionData.user_id || transactionData.username

  if (Object.keys(userData).length > 0) {
    const accountData = {
      username: username,
      mm_user: username,
      ...userData,
    }

    const account = await upsertPrima789Account(accountData)
    const transaction = await createTransaction(transactionData)

    return {
      type: 'data_sync',
      account_id: account?.id,
      transaction_id: transaction?.id,
      synced_data: Object.keys(userData),
    }
  }

  // Just log the sync attempt
  const transaction = await createTransaction(transactionData)
  return {
    type: 'data_sync',
    transaction_id: transaction?.id,
    message: 'Sync logged without data update',
  }
}

// Process balance transaction
async function processBalanceTransaction(transactionData) {
  console.log('💰 Processing balance transaction')

  const transaction = await createTransaction(transactionData)

  // Update account balance if user data is available
  const username = transactionData.user_id || transactionData.username
  const newBalance = transactionData.balance_after

  if (username && newBalance !== null && newBalance !== undefined) {
    try {
      const updateQuery = `
                UPDATE prima789_accounts 
                SET available = $1, updated_at = CURRENT_TIMESTAMP
                WHERE username = $2 OR mm_user = $2
                RETURNING id, username, available;
            `

      const updateResult = await executeQuery(updateQuery, [
        parseFloat(newBalance),
        username,
      ])

      return {
        type: transactionData.transaction_type,
        transaction_id: transaction?.id,
        account_updated: updateResult.rows.length > 0,
        new_balance: newBalance,
      }
    } catch (error) {
      console.error('⚠️ Failed to update account balance:', error)
    }
  }

  return {
    type: transactionData.transaction_type,
    transaction_id: transaction?.id,
    account_updated: false,
  }
}

// Process heartbeat
async function processHeartbeat(transactionData) {
  console.log('💓 Processing heartbeat')

  // For heartbeat, we just log the event and update system status
  await logSystemEvent('INFO', 'heartbeat', 'System heartbeat received', {
    user_id: transactionData.user_id,
    session_id: transactionData.details?.session_id,
    stats: transactionData.details?.stats,
    uptime: transactionData.details?.uptime,
  })

  return {
    type: 'heartbeat',
    status: 'received',
    timestamp: new Date().toISOString(),
  }
}

// Process system event
async function processSystemEvent(transactionData) {
  console.log('🔧 Processing system event')

  await logSystemEvent('INFO', 'system-event', 'System event received', {
    event_type: transactionData.details?.event_type,
    user_id: transactionData.user_id,
    details: transactionData.details,
  })

  return {
    type: 'system_event',
    event_logged: true,
  }
}

// Process generic transaction
async function processGenericTransaction(transactionData) {
  console.log('📝 Processing generic transaction')

  const transaction = await createTransaction(transactionData)

  return {
    type: 'generic',
    transaction_id: transaction?.id,
    transaction_type: transactionData.transaction_type,
  }
}

// Main webhook handler
exports.handler = async (event, context) => {
  console.log('🎯 Prima789 Transaction Webhook - Start')
  console.log('📊 Request info:', {
    method: event.httpMethod,
    headers: event.headers ? Object.keys(event.headers) : 'none',
    bodyLength: event.body ? event.body.length : 0,
  })

  // Enhanced CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, X-API-Key, X-Session-ID, X-Transaction-Priority, X-Retry-Attempt',
    'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
  }

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ message: 'CORS preflight OK' }),
    }
  }

  // Health check endpoint
  if (event.httpMethod === 'GET') {
    try {
      // Test database connection
      const testResult = await executeQuery(
        'SELECT NOW() as server_time, version() as db_version'
      )

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          status: 'healthy',
          timestamp: new Date().toISOString(),
          database: {
            connected: true,
            server_time: testResult.rows[0]?.server_time,
            version: testResult.rows[0]?.db_version?.substring(0, 50),
          },
          environment: {
            database_configured: !!process.env.NETLIFY_DATABASE_URL,
            api_key_configured: !!process.env.PRIMA789_WEBHOOK_API_KEY,
          },
        }),
      }
    } catch (error) {
      return {
        statusCode: 503,
        headers,
        body: JSON.stringify({
          success: false,
          status: 'unhealthy',
          error: error.message,
          timestamp: new Date().toISOString(),
        }),
      }
    }
  }

  // Only allow POST for webhook
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Method not allowed',
        message: 'Only POST method is supported for webhook data',
      }),
    }
  }

  let transactionData = null

  try {
    // Validate environment
    const WEBHOOK_API_KEY = process.env.PRIMA789_WEBHOOK_API_KEY

    if (!WEBHOOK_API_KEY) {
      console.error('❌ WEBHOOK_API_KEY not configured')
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Server configuration error',
          message: 'Webhook API key not configured',
        }),
      }
    }

    if (!process.env.NETLIFY_DATABASE_URL && !process.env.DATABASE_URL) {
      console.error('❌ Database URL not configured')
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Server configuration error',
          message: 'Database connection not configured',
        }),
      }
    }

    // Validate API key
    const providedApiKey =
      event.headers['x-api-key'] ||
      event.headers['X-API-Key'] ||
      event.headers['x-API-key']

    console.log('🔑 API Key validation:', {
      provided: !!providedApiKey,
      configured: !!WEBHOOK_API_KEY,
      matches: providedApiKey === WEBHOOK_API_KEY,
    })

    if (!providedApiKey) {
      await logSystemEvent(
        'WARN',
        'transaction-webhook',
        'Missing API key in request'
      )
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Unauthorized',
          message: 'API key required',
        }),
      }
    }

    if (providedApiKey !== WEBHOOK_API_KEY) {
      await logSystemEvent(
        'WARN',
        'transaction-webhook',
        'Invalid API key provided',
        {
          provided_key_prefix: providedApiKey?.substring(0, 10) + '...',
        }
      )
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Unauthorized',
          message: 'Invalid API key',
        }),
      }
    }

    // Parse request body
    if (!event.body) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Bad request',
          message: 'Request body is required',
        }),
      }
    }

    try {
      transactionData = JSON.parse(event.body)
      console.log('📋 Parsed transaction data:', {
        type: transactionData.transaction_type,
        user_id: transactionData.user_id,
        transaction_id: transactionData.transaction_id,
        amount: transactionData.amount,
        timestamp: transactionData.timestamp,
      })
    } catch (parseError) {
      console.error('❌ JSON parse error:', parseError)
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Bad request',
          message: 'Invalid JSON in request body',
        }),
      }
    }

    // Initialize database connection
    initializeDatabase()

    // Process the transaction
    const result = await processTransaction(transactionData)

    // Log success
    await logSystemEvent(
      'INFO',
      'transaction-webhook',
      'Transaction processed successfully',
      {
        transaction_type: transactionData.transaction_type,
        transaction_id: transactionData.transaction_id,
        user_id: transactionData.user_id,
        result: result,
      }
    )

    // Return success response
    const response = {
      success: true,
      message: 'Transaction processed successfully',
      data: result,
      timestamp: new Date().toISOString(),
      transaction_id: transactionData.transaction_id,
    }

    console.log('✅ Webhook completed successfully:', response)

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(response),
    }
  } catch (error) {
    console.error('❌ Webhook error:', error)
    console.error('Stack trace:', error.stack)

    // Enhanced error logging
    try {
      await logSystemEvent(
        'ERROR',
        'transaction-webhook',
        'Webhook processing failed',
        {
          error: error.message,
          stack: error.stack,
          transaction_data: transactionData
            ? {
                type: transactionData.transaction_type,
                user_id: transactionData.user_id,
                transaction_id: transactionData.transaction_id,
              }
            : 'not_parsed',
          request_info: {
            method: event.httpMethod,
            body_length: event.body ? event.body.length : 0,
          },
        }
      )
    } catch (logError) {
      console.error('❌ Failed to log error:', logError)
    }

    // Return error response
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Internal server error',
        message: 'Failed to process webhook',
        timestamp: new Date().toISOString(),
        error_id: Date.now().toString(), // Simple error tracking ID
        debug_info:
          process.env.NODE_ENV === 'development'
            ? {
                error_message: error.message,
                transaction_type: transactionData?.transaction_type,
              }
            : undefined,
      }),
    }
  }
}
