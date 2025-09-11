const { Pool } = require('pg')

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN

exports.handler = async (event, context) => {
  console.log('💰 Balance Inquiry - Start')
  console.log('HTTP Method:', event.httpMethod)
  console.log('Request body:', event.body)

  // Handle CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      },
      body: '',
    }
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' }),
    }
  }

  let pool
  let client

  try {
    const { lineUserId, requestType = 'balance' } = JSON.parse(event.body)

    if (!lineUserId) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: 'Missing lineUserId',
        }),
      }
    }

    console.log(`💰 Processing balance inquiry for LINE user: ${lineUserId}`)
    console.log(`📋 Request type: ${requestType}`)

    // Database connection with detailed logging
    const connectionString = process.env.NETLIFY_DATABASE_URL
    if (!connectionString) {
      console.error('❌ Database URL not found')
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: 'Database configuration error',
        }),
      }
    }

    console.log('🗄️ Connecting to database...')
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

    // Check if line_accounts table exists and has required columns
    const tableCheckResult = await client.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'line_accounts'
        `)

    const availableColumns = tableCheckResult.rows.map((row) => row.column_name)
    console.log('📊 Available columns in line_accounts:', availableColumns)

    // Required columns check
    const requiredColumns = ['line_user_id', 'prima789_user_id', 'username']
    const missingColumns = requiredColumns.filter(
      (col) => !availableColumns.includes(col)
    )

    if (missingColumns.length > 0) {
      console.error('❌ Missing required columns:', missingColumns)
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: 'Database schema error',
          message: 'Required columns missing from line_accounts table',
          details: {
            missing_columns: missingColumns,
            available_columns: availableColumns,
          },
        }),
      }
    }

    // Query user data with dynamic column selection
    const selectColumns = [
      'line_user_id',
      'prima789_user_id',
      availableColumns.includes('username')
        ? 'username'
        : 'prima789_user_id as username',
      availableColumns.includes('display_name')
        ? 'display_name'
        : 'NULL as display_name',
      availableColumns.includes('balance') ? 'balance' : '0.00 as balance',
      availableColumns.includes('points') ? 'points' : '0 as points',
      availableColumns.includes('tier') ? 'tier' : "'Bronze' as tier",
      availableColumns.includes('status') ? 'status' : "'active' as status",
      availableColumns.includes('last_sync_at')
        ? 'last_sync_at'
        : 'created_at as last_sync_at',
      availableColumns.includes('updated_at')
        ? 'updated_at'
        : 'created_at as updated_at',
      'created_at',
    ].join(', ')

    const userQuery = `
            SELECT ${selectColumns}
            FROM line_accounts 
            WHERE line_user_id = $1
        `

    console.log('🔍 Executing user query:', userQuery)
    console.log('📝 Query params:', [lineUserId])

    const userResult = await client.query(userQuery, [lineUserId])
    console.log('📊 User query result rows:', userResult.rows.length)

    if (userResult.rows.length === 0) {
      console.log('❌ No linked account found')

      // Try to send "not linked" message to LINE
      if (LINE_CHANNEL_ACCESS_TOKEN) {
        await sendNotLinkedMessage(lineUserId)
      }

      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: 'Account not linked',
          message: 'LINE account is not linked to Prima789 account',
        }),
      }
    }

    let userData = userResult.rows[0]
    console.log('✅ Account found:', {
      lineUserId: userData.line_user_id,
      username: userData.username,
      balance: userData.balance,
    })

    // Update last_sync_at if column exists
    if (availableColumns.includes('last_sync_at')) {
      const updateResult = await client.query(
        `
                UPDATE line_accounts 
                SET last_sync_at = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
                WHERE line_user_id = $1 
                RETURNING *
            `,
        [lineUserId]
      )

      if (updateResult.rows.length > 0) {
        userData = updateResult.rows[0]
        console.log('🔄 User data updated with new sync time')
      }
    }

    // Get recent transactions (if transaction_logs table exists)
    let recentTransactions = []
    try {
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

      recentTransactions = transactionsResult.rows
      console.log('📈 Recent transactions found:', recentTransactions.length)
    } catch (transactionError) {
      console.log(
        '⚠️ Transaction logs table not found or error:',
        transactionError.message
      )
    }

    // Create and send balance card
    const cardMessage = createBalanceCard(userData, recentTransactions)

    if (LINE_CHANNEL_ACCESS_TOKEN) {
      const cardSent = await sendBalanceCard(lineUserId, cardMessage)
      console.log('💳 Balance card sent:', cardSent ? 'success' : 'failed')
    } else {
      console.log('⚠️ LINE Channel Access Token not configured')
    }

    // Log activity if sync_logs table exists
    try {
      await client.query(
        `
                INSERT INTO sync_logs (
                    line_user_id, prima789_user_id, sync_type, 
                    status, details, created_at
                ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
            `,
        [
          lineUserId,
          userData.prima789_user_id,
          'balance_inquiry',
          'success',
          JSON.stringify({
            request_type: requestType,
            balance: userData.balance,
            points: userData.points,
            tier: userData.tier,
          }),
        ]
      )
      console.log('📝 Activity logged successfully')
    } catch (logError) {
      console.log('⚠️ Could not log activity:', logError.message)
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        message: 'Balance inquiry completed successfully',
        data: {
          line_user_id: userData.line_user_id,
          username: userData.username,
          display_name: userData.display_name,
          balance: userData.balance,
          points: userData.points,
          tier: userData.tier,
          status: userData.status,
          last_sync_at: userData.last_sync_at,
          recent_transactions: recentTransactions,
        },
        debug_info: {
          available_columns: availableColumns,
          database_time: testResult.rows[0].current_time,
          line_token_configured: !!LINE_CHANNEL_ACCESS_TOKEN,
        },
      }),
    }
  } catch (error) {
    console.error('❌ Balance inquiry error:', error)
    console.error('Error stack:', error.stack)

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: 'Balance inquiry error',
        message: 'Failed to process balance inquiry',
        details:
          process.env.NODE_ENV === 'development'
            ? {
                error_message: error.message,
                error_code: error.code,
                error_detail: error.detail,
                error_hint: error.hint,
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

// สร้าง Balance Card Message
function createBalanceCard(userData, transactions) {
  const tier = userData.tier || 'Bronze'
  const tierEmoji = {
    Bronze: '🥉',
    Silver: '🥈',
    Gold: '🥇',
    Platinum: '💎',
    Diamond: '💠',
  }

  // คำนวณ progress bar สำหรับคะแนน
  const points = parseInt(userData.points) || 0
  const pointsProgress = Math.min(points / 1000, 1) * 100
  const progressBar =
    '▓'.repeat(Math.floor(pointsProgress / 10)) +
    '▒'.repeat(10 - Math.floor(pointsProgress / 10))

  // Format ธุรกรรมล่าสุด
  const recentTransactions =
    transactions
      .slice(0, 3)
      .map((tx) => {
        const date = new Date(tx.timestamp || tx.created_at).toLocaleDateString(
          'th-TH',
          {
            day: '2-digit',
            month: '2-digit',
          }
        )
        const amount =
          parseFloat(tx.amount) >= 0
            ? `+฿${Math.abs(parseFloat(tx.amount)).toLocaleString()}`
            : `-฿${Math.abs(parseFloat(tx.amount)).toLocaleString()}`
        const emoji = parseFloat(tx.amount) >= 0 ? '💰' : '💸'
        return `${emoji} ${date} ${amount}`
      })
      .join('\n') || 'ไม่มีธุรกรรม'

  const balance = parseFloat(userData.balance) || 0

  return {
    type: 'flex',
    altText: `💳 Prima789 Member Card - Balance: ฿${balance.toLocaleString()}`,
    contents: {
      type: 'bubble',
      size: 'giga',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#1a1a2e',
        paddingAll: '20px',
        spacing: 'md',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              {
                type: 'text',
                text: '💳 PRIMA789',
                color: '#ffffff',
                size: 'xl',
                weight: 'bold',
                flex: 1,
              },
              {
                type: 'text',
                text: `${tierEmoji[tier] || '🥉'} ${tier}`,
                color: '#ffd700',
                size: 'md',
                weight: 'bold',
                align: 'end',
              },
            ],
          },
          {
            type: 'text',
            text: userData.display_name || userData.username || 'Member',
            color: '#cccccc',
            size: 'sm',
          },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#16213e',
        paddingAll: '20px',
        spacing: 'lg',
        contents: [
          // ยอดเงินคงเหลือ
          {
            type: 'box',
            layout: 'vertical',
            backgroundColor: '#0f3460',
            cornerRadius: 'md',
            paddingAll: '15px',
            spacing: 'sm',
            contents: [
              {
                type: 'text',
                text: '💰 ยอดเงินคงเหลือ',
                color: '#a0a0a0',
                size: 'sm',
              },
              {
                type: 'text',
                text: `฿${balance.toLocaleString()}`,
                color: '#00ff88',
                size: 'xxl',
                weight: 'bold',
              },
            ],
          },
          // คะแนนสะสม
          {
            type: 'box',
            layout: 'vertical',
            backgroundColor: '#0f3460',
            cornerRadius: 'md',
            paddingAll: '15px',
            spacing: 'sm',
            contents: [
              {
                type: 'text',
                text: '🎯 คะแนนสะสม',
                color: '#a0a0a0',
                size: 'sm',
              },
              {
                type: 'text',
                text: `${points.toLocaleString()} pts`,
                color: '#ffdd44',
                size: 'xl',
                weight: 'bold',
              },
              {
                type: 'text',
                text: progressBar,
                color: '#666666',
                size: 'xs',
              },
            ],
          },
          // ธุรกรรมล่าสุด
          {
            type: 'box',
            layout: 'vertical',
            backgroundColor: '#0f3460',
            cornerRadius: 'md',
            paddingAll: '15px',
            spacing: 'sm',
            contents: [
              {
                type: 'text',
                text: '📊 ธุรกรรมล่าสุด',
                color: '#a0a0a0',
                size: 'sm',
              },
              {
                type: 'text',
                text: recentTransactions,
                color: '#ffffff',
                size: 'xs',
                wrap: true,
              },
            ],
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#1a1a2e',
        paddingAll: '15px',
        spacing: 'sm',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            spacing: 'sm',
            contents: [
              {
                type: 'button',
                style: 'primary',
                color: '#00ff88',
                action: {
                  type: 'postback',
                  label: '🔄 อัปเดต',
                  data: 'action=refresh_balance',
                },
                flex: 1,
              },
              {
                type: 'button',
                style: 'secondary',
                action: {
                  type: 'postback',
                  label: '📈 ประวัติ',
                  data: 'action=view_history',
                },
                flex: 1,
              },
            ],
          },
          {
            type: 'text',
            text: `⏰ อัปเดตล่าสุด: ${new Date().toLocaleString('th-TH')}`,
            color: '#888888',
            size: 'xxs',
            align: 'center',
          },
        ],
      },
    },
  }
}

// ส่ง Balance Card ไปยัง LINE
async function sendBalanceCard(lineUserId, cardMessage) {
  if (!LINE_CHANNEL_ACCESS_TOKEN) {
    console.log('⚠️ LINE Channel Access Token not configured')
    return false
  }

  try {
    const response = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        to: lineUserId,
        messages: [cardMessage],
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      console.error('LINE push message error:', error)
      return false
    }

    console.log('✅ Balance card sent successfully')
    return true
  } catch (error) {
    console.error('❌ Send balance card error:', error)
    return false
  }
}

// ส่งข้อความแจ้งว่ายังไม่ได้เชื่อมโยงบัญชี
async function sendNotLinkedMessage(lineUserId) {
  if (!LINE_CHANNEL_ACCESS_TOKEN) {
    return false
  }

  const message = {
    type: 'flex',
    altText: '❌ บัญชียังไม่ได้เชื่อมโยง',
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          {
            type: 'text',
            text: '❌ บัญชียังไม่ได้เชื่อมโยง',
            weight: 'bold',
            size: 'lg',
            color: '#ff6b6b',
          },
          {
            type: 'text',
            text: 'กรุณาเข้าสู่ระบบผ่าน Prima789.com เพื่อเชื่อมโยงบัญชี LINE ของคุณ',
            wrap: true,
            color: '#666666',
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'primary',
            height: 'sm',
            action: {
              type: 'uri',
              label: '🔗 เชื่อมโยงบัญชี',
              uri: 'https://prima789.com/login',
            },
          },
        ],
      },
    },
  }

  try {
    const response = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        to: lineUserId,
        messages: [message],
      }),
    })

    return response.ok
  } catch (error) {
    console.error('Send not linked message error:', error)
    return false
  }
}
