const { Pool } = require('pg')

exports.handler = async (event, context) => {
  console.log('✅ Confirm Account Linking - Start')

  // Handle CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
    const { lineUserId, prima789Account, userProfile } = JSON.parse(event.body)

    if (!lineUserId || !prima789Account || !userProfile) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: 'Missing required parameters',
        }),
      }
    }

    console.log(`✅ Confirming account linking for LINE user: ${lineUserId}`)
    console.log(`🔗 Prima789 account: ${prima789Account.username}`)

    // Database connection
    pool = new Pool({
      connectionString: process.env.NETLIFY_DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    })

    client = await pool.connect()

    // Check if already linked
    const existingResult = await client.query(
      `
            SELECT * FROM line_users
            WHERE line_user_id = $1 OR prima789_user_id = $2
        `,
      [lineUserId, prima789Account.prima789UserId]
    )

    if (existingResult.rows.length > 0) {
      const existing = existingResult.rows[0]

      if (
        existing.line_user_id === lineUserId &&
        existing.prima789_user_id === prima789Account.prima789UserId
      ) {
        // Same linking already exists, just update
        console.log('ℹ️ Account already linked, updating data')

        await client.query(
          `
                    UPDATE line_users 
                    SET 
                        display_name = $1,
                        balance = $2,
                        points = $3,
                        tier = $4,
                        phone_number = $5,
                        email = $6,
                        updated_at = CURRENT_TIMESTAMP,
                        last_sync_at = CURRENT_TIMESTAMP
                    WHERE line_user_id = $7
                `,
          [
            userProfile.displayName,
            prima789Account.balance,
            prima789Account.points,
            prima789Account.tier,
            prima789Account.phoneNumber,
            prima789Account.email,
            lineUserId,
          ]
        )
      } else if (existing.line_user_id === lineUserId) {
        // LINE user already linked to different Prima789 account
        return {
          statusCode: 409,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: false,
            error: 'LINE account already linked to another Prima789 account',
          }),
        }
      } else if (existing.prima789_user_id === prima789Account.prima789UserId) {
        // Prima789 account already linked to different LINE user
        return {
          statusCode: 409,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: false,
            error: 'Prima789 account already linked to another LINE user',
          }),
        }
      }
    } else {
      // Create new linking
      console.log('🆕 Creating new account linking')

      await client.query(
        `
                INSERT INTO line_users (
                    line_user_id,
                    prima789_user_id,
                    username,
                    display_name,
                    phone_number,
                    email,
                    balance,
                    points,
                    tier,
                    status,
                    link_method,
                    linked_at,
                    last_sync_at,
                    created_at
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', 'liff', 
                    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )
            `,
        [
          lineUserId,
          prima789Account.prima789UserId,
          prima789Account.username,
          userProfile.displayName,
          prima789Account.phoneNumber,
          prima789Account.email,
          prima789Account.balance,
          prima789Account.points,
          prima789Account.tier,
        ]
      )
    }

    // Log the linking activity
    await client.query(
      `
            INSERT INTO sync_logs (
                line_user_id,
                prima789_user_id,
                sync_type,
                status,
                details,
                created_at
            ) VALUES ($1, $2, 'account_linking', 'success', $3, CURRENT_TIMESTAMP)
        `,
      [
        lineUserId,
        prima789Account.prima789UserId,
        JSON.stringify({
          source: 'liff_app',
          user_profile: userProfile,
          prima789_account: prima789Account,
        }),
      ]
    )

    // Send welcome message to LINE (if possible)
    await sendWelcomeMessage(lineUserId, prima789Account)

    console.log('✅ Account linking confirmed successfully')

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        message: 'Account linked successfully',
        data: {
          lineUserId: lineUserId,
          prima789UserId: prima789Account.prima789UserId,
          username: prima789Account.username,
          displayName: userProfile.displayName,
          linkedAt: new Date().toISOString(),
        },
      }),
    }
  } catch (error) {
    console.error('❌ Confirm account linking error:', error)

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: 'Failed to confirm account linking',
        details:
          process.env.NODE_ENV === 'development' ? error.message : undefined,
      }),
    }
  } finally {
    if (client) client.release()
    if (pool) await pool.end()
  }
}

// Send welcome message to LINE user
async function sendWelcomeMessage(lineUserId, prima789Account) {
  const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN

  if (!LINE_CHANNEL_ACCESS_TOKEN) {
    console.log('⚠️ LINE Channel Access Token not configured')
    return false
  }

  try {
    const welcomeMessage = {
      type: 'flex',
      altText: '🎉 เชื่อมโยงบัญชี Prima789 สำเร็จ!',
      contents: {
        type: 'bubble',
        header: {
          type: 'box',
          layout: 'vertical',
          backgroundColor: '#06C755',
          paddingAll: '20px',
          contents: [
            {
              type: 'text',
              text: '🎉 เชื่อมโยงสำเร็จ!',
              color: '#ffffff',
              size: 'xl',
              weight: 'bold',
              align: 'center',
            },
            {
              type: 'text',
              text: 'ยินดีต้อนรับสู่ Prima789 Member Card',
              color: '#ffffff',
              size: 'sm',
              align: 'center',
              margin: 'sm',
            },
          ],
        },
        body: {
          type: 'box',
          layout: 'vertical',
          spacing: 'md',
          paddingAll: '20px',
          contents: [
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                {
                  type: 'text',
                  text: 'บัญชี:',
                  color: '#666666',
                  flex: 1,
                },
                {
                  type: 'text',
                  text: prima789Account.username,
                  weight: 'bold',
                  flex: 2,
                },
              ],
            },
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                {
                  type: 'text',
                  text: 'ยอดเงิน:',
                  color: '#666666',
                  flex: 1,
                },
                {
                  type: 'text',
                  text: `฿${(prima789Account.balance || 0).toLocaleString()}`,
                  weight: 'bold',
                  color: '#06C755',
                  flex: 2,
                },
              ],
            },
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                {
                  type: 'text',
                  text: 'ระดับ:',
                  color: '#666666',
                  flex: 1,
                },
                {
                  type: 'text',
                  text: prima789Account.tier || 'Bronze',
                  weight: 'bold',
                  color: '#FFD700',
                  flex: 2,
                },
              ],
            },
            {
              type: 'separator',
              margin: 'lg',
            },
            {
              type: 'text',
              text: '🎯 สิทธิประโยชน์ที่คุณได้รับ:',
              weight: 'bold',
              margin: 'lg',
            },
            {
              type: 'text',
              text: '• เข้าถึง Member Card ผ่าน LINE\n• รับแจ้งเตือนธุรกรรมแบบ Real-time\n• ตรวจสอบยอดเงินและคะแนน\n• รับโปรโมชั่นพิเศษ',
              size: 'sm',
              color: '#666666',
              wrap: true,
            },
          ],
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          paddingAll: '20px',
          contents: [
            {
              type: 'button',
              style: 'primary',
              action: {
                type: 'postback',
                label: '💳 เปิด Member Card',
                data: 'action=open_member_card',
              },
            },
          ],
        },
      },
    }

    const response = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        to: lineUserId,
        messages: [welcomeMessage],
      }),
    })

    if (response.ok) {
      console.log('✅ Welcome message sent successfully')
      return true
    } else {
      const error = await response.text()
      console.error('❌ Failed to send welcome message:', error)
      return false
    }
  } catch (error) {
    console.error('❌ Error sending welcome message:', error)
    return false
  }
}
