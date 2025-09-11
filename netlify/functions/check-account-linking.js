const { Pool } = require('pg')

exports.handler = async (event, context) => {
  console.log('🔍 Check Account Linking - Start')
  console.log('HTTP Method:', event.httpMethod)
  console.log('Query params:', event.queryStringParameters)

  // Handle CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      },
      body: '',
    }
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' }),
    }
  }

  let pool
  let client

  try {
    const { lineUserId, username } = event.queryStringParameters || {}

    if (!lineUserId && !username) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: 'Missing required parameter',
          message: 'Please provide either lineUserId or username',
        }),
      }
    }

    console.log('🔗 Checking account linking for:', { lineUserId, username })

    // Database connection with debug
    const connectionString = process.env.NETLIFY_DATABASE_URL
    if (!connectionString) {
      console.error('❌ Database URL not found in environment variables')
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: 'Database configuration error',
          message: 'Database connection string not configured',
        }),
      }
    }

    console.log('🗄️ Connecting to database...')
    console.log(
      'Connection string prefix:',
      connectionString.substring(0, 30) + '...'
    )

    pool = new Pool({
      connectionString: connectionString,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
    })

    client = await pool.connect()
    console.log('✅ Database connected successfully')

    // Test database connection
    const testResult = await client.query('SELECT NOW() as current_time')
    console.log('🕐 Database time:', testResult.rows[0].current_time)

    // Check if tables exist
    const tableCheckResult = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name IN ('line_accounts', 'transaction_logs')
        `)

    const existingTables = tableCheckResult.rows.map((row) => row.table_name)
    console.log('📊 Existing tables:', existingTables)

    if (!existingTables.includes('line_accounts')) {
      console.error('❌ Table line_accounts does not exist')
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: 'Database schema error',
          message:
            'Required tables not found. Please run database schema first.',
          details: {
            existing_tables: existingTables,
            required_tables: ['line_accounts', 'transaction_logs'],
          },
        }),
      }
    }

    // Query user data
    let query, params
    if (lineUserId) {
      query = `
                SELECT 
                    line_user_id,
                    prima789_user_id,
                    username,
                    display_name,
                    balance,
                    points,
                    tier,
                    status,
                    linked_at,
                    last_sync_at,
                    updated_at
                FROM line_accounts 
                WHERE line_user_id = $1 AND status = 'active'
            `
      params = [lineUserId]
    } else {
      query = `
                SELECT 
                    line_user_id,
                    prima789_user_id,
                    username,
                    display_name,
                    balance,
                    points,
                    tier,
                    status,
                    linked_at,
                    last_sync_at,
                    updated_at
                FROM line_accounts 
                WHERE username = $1 AND status = 'active'
            `
      params = [username]
    }

    console.log('🔍 Executing query:', query)
    console.log('📝 Query params:', params)

    const result = await client.query(query, params)
    console.log('📊 Query result rows:', result.rows.length)

    if (result.rows.length === 0) {
      console.log('❌ No linked account found')
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          isLinked: false,
          data: null,
          message: 'Account not linked',
        }),
      }
    }

    const userData = result.rows[0]
    console.log('✅ Account found:', {
      lineUserId: userData.line_user_id,
      username: userData.username,
      balance: userData.balance,
    })

    // Get recent transactions
    const transactionsResult = await client.query(
      `
            SELECT 
                transaction_type,
                amount,
                balance_before,
                balance_after,
                details,
                timestamp,
                created_at
            FROM transaction_logs 
            WHERE prima789_user_id = $1 
            ORDER BY timestamp DESC 
            LIMIT 10
        `,
      [userData.prima789_user_id]
    )

    console.log('📈 Recent transactions:', transactionsResult.rows.length)

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        isLinked: true,
        data: {
          ...userData,
          recent_transactions: transactionsResult.rows,
        },
        message: 'Account linked successfully',
        debug_info: {
          query_type: lineUserId ? 'by_line_user_id' : 'by_username',
          database_time: testResult.rows[0].current_time,
          existing_tables: existingTables,
        },
      }),
    }
  } catch (error) {
    console.error('❌ Database error:', error)
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      detail: error.detail,
      hint: error.hint,
      position: error.position,
    })

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: 'Database error',
        message: 'Failed to check account linking status',
        details:
          process.env.NODE_ENV === 'development'
            ? {
                error_message: error.message,
                error_code: error.code,
                error_detail: error.detail,
              }
            : 'Contact support for assistance',
      }),
    }
  } finally {
    // Clean up connections
    if (client) {
      try {
        client.release()
        console.log('🔄 Database client released')
      } catch (releaseError) {
        console.error('Error releasing client:', releaseError)
      }
    }

    if (pool) {
      try {
        await pool.end()
        console.log('🔄 Database pool closed')
      } catch (poolError) {
        console.error('Error closing pool:', poolError)
      }
    }
  }
}
