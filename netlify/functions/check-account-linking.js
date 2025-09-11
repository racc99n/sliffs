import pkg from 'pg'
const { Pool } = pkg

// CORS Headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

export const handler = async (event, context) => {
  // Handle CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: '',
    }
  }

  try {
    const { lineUserId } = event.queryStringParameters || {}

    if (!lineUserId) {
      return {
        statusCode: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          message: 'lineUserId is required',
        }),
      }
    }

    // Database connection
    const pool = new Pool({
      connectionString: process.env.NETLIFY_DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    })

    const client = await pool.connect()

    try {
      // ตรวจสอบว่า LINE User ID นี้ได้ลิงก์กับบัญชี Prima789 แล้วหรือไม่
      const query = `
                SELECT 
                    la.line_user_id,
                    la.prima789_username,
                    la.prima789_user_id,
                    la.linked_at,
                    la.last_sync_at,
                    la.sync_status,
                    -- ข้อมูลจาก Prima789
                    pd.username,
                    pd.balance,
                    pd.points,
                    pd.tier,
                    pd.last_login,
                    pd.created_at,
                    pd.updated_at
                FROM line_accounts la
                LEFT JOIN prima789_data pd ON la.prima789_user_id = pd.user_id
                WHERE la.line_user_id = $1 
                AND la.status = 'active'
                ORDER BY la.linked_at DESC
                LIMIT 1
            `

      const result = await client.query(query, [lineUserId])

      if (result.rows.length === 0) {
        // Account not linked
        return {
          statusCode: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: true,
            isLinked: false,
            data: null,
            message: 'Account not linked',
          }),
        }
      }

      const accountData = result.rows[0]

      // Check if Prima789 data exists
      if (!accountData.username) {
        // Linked but no data sync yet
        return {
          statusCode: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: true,
            isLinked: true,
            needsSync: true,
            data: {
              lineUserId: accountData.line_user_id,
              prima789Username: accountData.prima789_username,
              linkedAt: accountData.linked_at,
              syncStatus: accountData.sync_status,
            },
            message: 'Account linked but data needs sync',
          }),
        }
      }

      // Account linked and has data
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          isLinked: true,
          needsSync: false,
          data: {
            lineUserId: accountData.line_user_id,
            prima789Username: accountData.prima789_username,
            prima789UserId: accountData.prima789_user_id,
            linkedAt: accountData.linked_at,
            lastSyncAt: accountData.last_sync_at,
            syncStatus: accountData.sync_status,

            // Member data
            username: accountData.username,
            balance: parseFloat(accountData.balance) || 0,
            points: parseInt(accountData.points) || 0,
            tier: accountData.tier || 'Bronze',
            lastLogin: accountData.last_login,
            created_at: accountData.created_at,
            updated_at: accountData.updated_at,
          },
          message: 'Account linked and data available',
        }),
      }
    } finally {
      client.release()
      await pool.end()
    }
  } catch (error) {
    console.error('Account linking check error:', error)

    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: 'Database error',
        message: 'Failed to check account linking status',
        details:
          process.env.NODE_ENV === 'development' ? error.message : undefined,
      }),
    }
  }
}
