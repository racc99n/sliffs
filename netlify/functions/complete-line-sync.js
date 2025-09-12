const { Pool } = require('pg')

exports.handler = async (event, context) => {
  console.log('✅ Complete LINE Sync - Start')

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
    const syncData = JSON.parse(event.body)
    const { details } = syncData

    if (
      !details ||
      !details.line_user_id ||
      !details.sync_id ||
      !details.account_data
    ) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: 'Missing required sync data',
        }),
      }
    }

    console.log(`✅ Completing LINE sync for session: ${details.sync_id}`)

    // Database connection
    pool = new Pool({
      connectionString: process.env.NETLIFY_DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    })

    client = await pool.connect()

    // Get sync session info
    const sessionResult = await client.query(
      `
            SELECT sync_id, line_user_id, user_profile, status
            FROM sync_sessions 
            WHERE sync_id = $1
        `,
      [details.sync_id]
    )

    if (sessionResult.rows.length === 0) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: 'Sync session not found',
        }),
      }
    }

    const session = sessionResult.rows[0]

    if (session.status !== 'pending') {
      return {
        statusCode: 409,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: 'Sync session already processed',
        }),
      }
    }

    const userProfile = JSON.parse(session.user_profile)
    const accountData = details.account_data

    // Check if account is already linked
    const existingResult = await client.query(
      `
            SELECT * FROM line_users 
            WHERE line_user_id = $1 OR prima789_user_id = $2
        `,
      [details.line_user_id, accountData.prima789_user_id]
    )

    if (existingResult.rows.length > 0) {
      const existing = existingResult.rows[0]

      if (
        existing.line_user_id === details.line_user_id &&
        existing.prima789_user_id === accountData.prima789_user_id
      ) {
        // Same linking, just update
        await client.query(
          `
                    UPDATE line_users 
                    SET 
                        display_name = $1,
                        balance = $2,
                        points = $3,
                        tier = $4,
                        phone_number = $5,
                        updated_at = CURRENT_TIMESTAMP,
                        last_sync_at = CURRENT_TIMESTAMP
                    WHERE line_user_id = $6
                `,
          [
            accountData.display_name,
            accountData.balance,
            accountData.points,
            accountData.tier,
            accountData.phone_number,
            details.line_user_id,
          ]
        )
      } else {
        // Conflict - account already linked differently
        await client.query(
          `
                    UPDATE sync_sessions 
                    SET status = 'failed', 
                        result_data = $1,
                        completed_at = CURRENT_TIMESTAMP
                    WHERE sync_id = $2
                `,
          [
            JSON.stringify({
              error: 'Account already linked to different user',
            }),
            details.sync_id,
          ]
        )

        return {
          statusCode: 409,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: false,
            error: 'Account already linked to different user',
          }),
        }
      }
    } else {
      // Create new linking
      await client.query(
        `
                INSERT INTO line_users (
                    line_user_id,
                    prima789_user_id,
                    username,
                    display_name,
                    phone_number,
                    balance,
                    points,
                    tier,
                    status,
                    link_method,
                    linked_at,
                    last_sync_at,
                    created_at
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, 'active', 'socket', 
                    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )
            `,
        [
          details.line_user_id,
          accountData.prima789_user_id,
          accountData.username,
          accountData.display_name,
          accountData.phone_number,
          accountData.balance,
          accountData.points,
          accountData.tier,
        ]
      )
    }

    // Update sync session as completed
    await client.query(
      `
            UPDATE sync_sessions 
            SET status = 'completed', 
                result_data = $1,
                completed_at = CURRENT_TIMESTAMP
            WHERE sync_id = $2
        `,
      [
        JSON.stringify({
          account: accountData,
          linked_at: new Date().toISOString(),
        }),
        details.sync_id,
      ]
    )

    // Log the sync activity
    await client.query(
      `
            INSERT INTO sync_logs (
                line_user_id,
                prima789_user_id,
                sync_type,
                status,
                details,
                created_at
            ) VALUES ($1, $2, 'socket_auto_sync', 'success', $3, CURRENT_TIMESTAMP)
        `,
      [
        details.line_user_id,
        accountData.prima789_user_id,
        JSON.stringify({
          source: 'socket_io',
          sync_id: details.sync_id,
          user_profile: userProfile,
          account_data: accountData,
        }),
      ]
    )

    // Send success notification to LINE
    await sendSyncSuccessMessage(details.line_user_id, accountData)

    console.log('✅ LINE sync completed successfully')

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        message: 'LINE sync completed successfully',
        data: {
          line_user_id: details.line_user_id,
          prima789_user_id: accountData.prima789_user_id,
          username: accountData.username,
          linked_at: new Date().toISOString(),
        },
      }),
    }
  } catch (error) {
    console.error('❌ Complete LINE sync error:', error)

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: 'Failed to complete LINE sync',
      }),
    }
  } finally {
    if (client) client.release()
    if (pool) await pool.end()
  }
}

// Send sync success message to LINE user
async function sendSyncSuccessMessage(lineUserId, accountData) {
  const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN

  if (!LINE_CHANNEL_ACCESS_TOKEN) {
    console.log('⚠️ LINE Channel Access Token not configured')
    return false
  }

  try {
    const message = {
      type: 'flex',
      altText: '🎉 เชื่อมโยงบัญชี Prima789 สำเร็จ (Auto Sync)!',
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
              text: '🔌 Auto Sync สำเร็จ!',
              color: '#ffffff',
              size: 'xl',
              weight: 'bold',
              align: 'center',
            },
            {
              type: 'text',
              text: 'ระบบได้เชื่อมโยงบัญชีอัตโนมัติแล้ว',
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
                  text: accountData.username,
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
                  text: `฿${(accountData.balance || 0).toLocaleString()}`,
                  weight: 'bold',
                  color: '#06C755',
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
              text: '✨ การเชื่อมโยงเสร็จสิ้นแล้ว ตอนนี้คุณสามารถใช้ Member Card ผ่าน LINE ได้เลย!',
              size: 'sm',
              color: '#666666',
              wrap: true,
              margin: 'lg',
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
        messages: [message],
      }),
    })

    if (response.ok) {
      console.log('✅ Sync success message sent')
      return true
    } else {
      const error = await response.text()
      console.error('❌ Failed to send sync success message:', error)
      return false
    }
  } catch (error) {
    console.error('❌ Error sending sync success message:', error)
    return false
  }
}
