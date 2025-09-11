import pkg from 'pg'
const { Pool } = pkg

// CORS Headers
const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://prima789.com',
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

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        message: 'Method not allowed',
      }),
    }
  }

  try {
    const body = JSON.parse(event.body || '{}')
    const {
      prima789Username,
      prima789UserId,
      userData,
      source = 'website',
      timestamp,
    } = body

    // Validate required fields
    if (!prima789Username || !userData) {
      return {
        statusCode: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          message: 'prima789Username and userData are required',
        }),
      }
    }

    console.log('Linking Prima789 account:', {
      username: prima789Username,
      userId: prima789UserId,
      source: source,
    })

    // Database connection
    const pool = new Pool({
      connectionString: process.env.NETLIFY_DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    })

    const client = await pool.connect()

    try {
      // 1. ตรวจสอบว่ามี LINE account ที่เชื่อมโยงกับ username นี้แล้วหรือไม่
      const existingLinkQuery = `
                SELECT la.*, pd.balance, pd.points, pd.tier
                FROM line_accounts la
                LEFT JOIN prima789_data pd ON la.prima789_user_id = pd.user_id
                WHERE la.prima789_username = $1 AND la.status = 'active'
                ORDER BY la.linked_at DESC
                LIMIT 1
            `

      const existingLinkResult = await client.query(existingLinkQuery, [
        prima789Username,
      ])
      let isNewLinking = false
      let lineUserId = null

      if (existingLinkResult.rows.length > 0) {
        // มีการเชื่อมโยงอยู่แล้ว - อัปเดตข้อมูล
        const existingLink = existingLinkResult.rows[0]
        lineUserId = existingLink.line_user_id

        console.log('Updating existing link for:', prima789Username)

        // อัปเดต last_sync_at
        await client.query(
          `
                    UPDATE line_accounts 
                    SET last_sync_at = NOW(), sync_status = 'success'
                    WHERE id = $1
                `,
          [existingLink.id]
        )
      } else {
        // ไม่มีการเชื่อมโยง - รอ LINE user มาเชื่อมโยง
        console.log('No existing LINE linking found for:', prima789Username)
        isNewLinking = false // จะเป็น true เมื่อมี LINE user มาเชื่อมโยงจริง
      }

      // 2. อัปเดต/สร้างข้อมูลใน prima789_data
      const upsertDataQuery = `
                INSERT INTO prima789_data (
                    user_id, username, email, balance, points, tier,
                    total_deposits, total_withdrawals, games_played, 
                    last_login, created_at, updated_at
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW()
                )
                ON CONFLICT (user_id) 
                DO UPDATE SET
                    username = EXCLUDED.username,
                    email = EXCLUDED.email,
                    balance = EXCLUDED.balance,
                    points = EXCLUDED.points,
                    tier = EXCLUDED.tier,
                    total_deposits = EXCLUDED.total_deposits,
                    total_withdrawals = EXCLUDED.total_withdrawals,
                    games_played = EXCLUDED.games_played,
                    last_login = EXCLUDED.last_login,
                    updated_at = NOW()
                RETURNING *
            `

      const userId = prima789UserId || generateUserId(prima789Username)

      const dataResult = await client.query(upsertDataQuery, [
        userId,
        userData.username || prima789Username,
        userData.email,
        parseFloat(userData.balance) || 0,
        parseInt(userData.points) || 0,
        userData.tier || 'Bronze',
        parseFloat(userData.total_deposits) || 0,
        parseFloat(userData.total_withdrawals) || 0,
        parseInt(userData.games_played) || 0,
        userData.last_login ? new Date(userData.last_login) : new Date(),
        userData.created_at ? new Date(userData.created_at) : new Date(),
      ])

      // 3. บันทึก sync log
      await client.query(
        `
                INSERT INTO sync_logs (
                    line_user_id, prima789_user_id, sync_type, 
                    status, details, created_at
                ) VALUES ($1, $2, $3, $4, $5, NOW())
            `,
        [
          lineUserId, // อาจเป็น null ถ้ายังไม่มี LINE user เชื่อมโยง
          userId,
          'website_sync',
          'success',
          JSON.stringify({
            source: source,
            userData: userData,
            timestamp: timestamp,
            hasLineLink: !!lineUserId,
          }),
        ]
      )

      // 4. ถ้ามี LINE account เชื่อมโยงอยู่ ให้ส่งการแจ้งเตือนไปยัง LINE
      if (lineUserId) {
        try {
          await sendLineNotification(lineUserId, {
            type: 'data_updated',
            balance: dataResult.rows[0].balance,
            points: dataResult.rows[0].points,
            tier: dataResult.rows[0].tier,
          })
        } catch (notifyError) {
          console.error('Failed to send LINE notification:', notifyError)
          // ไม่ให้ error นี้ทำให้ response fail
        }
      }

      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          newLinking: isNewLinking,
          hasLineLink: !!lineUserId,
          data: dataResult.rows[0],
          message: lineUserId
            ? 'Data synced successfully with linked LINE account'
            : 'Data saved successfully, waiting for LINE account linking',
        }),
      }
    } finally {
      client.release()
      await pool.end()
    }
  } catch (error) {
    console.error('Link Prima789 account error:', error)

    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: 'Database error',
        message: 'Failed to link Prima789 account',
        details:
          process.env.NODE_ENV === 'development' ? error.message : undefined,
      }),
    }
  }
}

// Generate user ID from username
function generateUserId(username) {
  // สร้าง user ID จาก username (ในทางปฏิบัติควรใช้ ID จริงจาก Prima789)
  return (
    username.toLowerCase().replace(/[^a-z0-9]/g, '') +
    '_' +
    Date.now().toString(36)
  )
}

// Send LINE notification
async function sendLineNotification(lineUserId, data) {
  try {
    if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) {
      console.log('LINE access token not configured')
      return
    }

    const message = {
      type: 'flex',
      altText: 'ข้อมูลบัญชีได้รับการอัปเดต',
      contents: {
        type: 'bubble',
        size: 'micro',
        header: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: '🔄 ข้อมูลอัปเดต',
              weight: 'bold',
              color: '#ffffff',
              size: 'sm',
            },
          ],
          backgroundColor: '#4CAF50',
          paddingAll: '12px',
        },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: `ยอดเงิน: ฿${data.balance?.toLocaleString() || '0'}`,
              size: 'sm',
              weight: 'bold',
              color: '#333333',
            },
            {
              type: 'text',
              text: `คะแนน: ${data.points?.toLocaleString() || '0'} pts`,
              size: 'xs',
              color: '#666666',
              margin: 'sm',
            },
            {
              type: 'text',
              text: `ระดับ: ${data.tier || 'Bronze'}`,
              size: 'xs',
              color: '#666666',
              margin: 'sm',
            },
          ],
          paddingAll: '12px',
        },
      },
    }

    const response = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        to: lineUserId,
        messages: [message],
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      console.error('LINE push message error:', error)
    } else {
      console.log('LINE notification sent successfully to:', lineUserId)
    }
  } catch (error) {
    console.error('Send LINE notification error:', error)
    throw error
  }
}
