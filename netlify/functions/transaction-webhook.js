import pkg from 'pg'
const { Pool } = pkg

// CORS Headers
const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://prima789.com',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
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
    // Verify API Key (security)
    const apiKey = event.headers['x-api-key'] || event.headers['X-API-Key']
    if (apiKey !== process.env.PRIMA789_WEBHOOK_API_KEY) {
      return {
        statusCode: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          message: 'Unauthorized',
        }),
      }
    }

    const body = JSON.parse(event.body || '{}')
    const {
      transaction_type, // 'deposit', 'withdraw', 'bet', 'win'
      user_id,
      username,
      amount,
      balance_before,
      balance_after,
      transaction_id,
      timestamp,
      details,
    } = body

    console.log('Transaction webhook received:', {
      type: transaction_type,
      user: username,
      amount: amount,
    })

    // Database connection
    const pool = new Pool({
      connectionString: process.env.NETLIFY_DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    })

    const client = await pool.connect()

    try {
      // 1. อัปเดตข้อมูลในฐานข้อมูล
      await updateUserData(client, {
        user_id,
        username,
        balance_after,
        transaction_type,
        amount,
      })

      // 2. บันทึก transaction log
      await logTransaction(client, {
        transaction_type,
        user_id,
        username,
        amount,
        balance_before,
        balance_after,
        transaction_id,
        timestamp: timestamp || new Date().toISOString(),
        details,
      })

      // 3. หา LINE User ID ที่เชื่อมโยงกับ account นี้
      const lineUser = await findLinkedLineUser(client, username, user_id)

      if (lineUser) {
        // 4. ส่ง Card Message แจ้งเตือนไปยัง LINE
        await sendTransactionNotification(lineUser.line_user_id, {
          transaction_type,
          username,
          amount,
          balance_before,
          balance_after,
          transaction_id,
          timestamp,
        })

        console.log(
          'Transaction notification sent to LINE user:',
          lineUser.line_user_id
        )
      } else {
        console.log('No linked LINE user found for:', username)
      }

      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          message: 'Transaction processed successfully',
          transaction_id: transaction_id,
          line_notification_sent: !!lineUser,
        }),
      }
    } finally {
      client.release()
      await pool.end()
    }
  } catch (error) {
    console.error('Transaction webhook error:', error)

    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: 'Webhook processing error',
        message: 'Failed to process transaction webhook',
        details:
          process.env.NODE_ENV === 'development' ? error.message : undefined,
      }),
    }
  }
}

// อัปเดตข้อมูล user
async function updateUserData(client, userData) {
  const { user_id, username, balance_after, transaction_type, amount } =
    userData

  // คำนวณ points ตามประเภทธุรกรรม
  let pointsChange = 0
  if (transaction_type === 'deposit') {
    pointsChange = Math.floor(amount / 100) // 1 point per 100 บาท
  } else if (transaction_type === 'bet') {
    pointsChange = Math.floor(amount / 50) // 1 point per 50 บาท bet
  }

  await client.query(
    `
        UPDATE prima789_data 
        SET 
            balance = $1,
            points = COALESCE(points, 0) + $2,
            last_login = NOW(),
            updated_at = NOW(),
            total_deposits = CASE 
                WHEN $3 = 'deposit' THEN COALESCE(total_deposits, 0) + $4
                ELSE COALESCE(total_deposits, 0)
            END,
            total_withdrawals = CASE 
                WHEN $3 = 'withdraw' THEN COALESCE(total_withdrawals, 0) + $4
                ELSE COALESCE(total_withdrawals, 0)
            END,
            games_played = CASE 
                WHEN $3 = 'bet' THEN COALESCE(games_played, 0) + 1
                ELSE COALESCE(games_played, 0)
            END
        WHERE user_id = $5 OR username = $6
    `,
    [balance_after, pointsChange, transaction_type, amount, user_id, username]
  )

  // อัปเดต tier ตาม points
  await updateUserTier(client, user_id, username)
}

// อัปเดต tier ตาม points
async function updateUserTier(client, user_id, username) {
  await client.query(
    `
        UPDATE prima789_data 
        SET tier = CASE 
            WHEN points >= 10000 THEN 'Diamond'
            WHEN points >= 5000 THEN 'Platinum'
            WHEN points >= 2000 THEN 'Gold'
            WHEN points >= 500 THEN 'Silver'
            ELSE 'Bronze'
        END
        WHERE user_id = $1 OR username = $2
    `,
    [user_id, username]
  )
}

// บันทึก transaction log
async function logTransaction(client, transactionData) {
  await client.query(
    `
        INSERT INTO transaction_logs (
            transaction_type, prima789_user_id, prima789_username,
            amount, balance_before, balance_after, transaction_id,
            timestamp, details, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
    `,
    [
      transactionData.transaction_type,
      transactionData.user_id,
      transactionData.username,
      transactionData.amount,
      transactionData.balance_before,
      transactionData.balance_after,
      transactionData.transaction_id,
      transactionData.timestamp,
      JSON.stringify(transactionData.details || {}),
    ]
  )
}

// หา LINE User ที่เชื่อมโยงกับ account
async function findLinkedLineUser(client, username, user_id) {
  const result = await client.query(
    `
        SELECT line_user_id, prima789_username, prima789_user_id
        FROM line_accounts 
        WHERE (prima789_username = $1 OR prima789_user_id = $2)
        AND status = 'active'
        ORDER BY linked_at DESC
        LIMIT 1
    `,
    [username, user_id]
  )

  return result.rows[0] || null
}

// ส่ง Card Message แจ้งเตือนไปยัง LINE
async function sendTransactionNotification(lineUserId, transactionData) {
  const { transaction_type, username, amount, balance_after, transaction_id } =
    transactionData

  // สร้าง Card Message ตามประเภทธุรกรรม
  let cardMessage

  if (transaction_type === 'deposit') {
    cardMessage = createDepositCard(
      username,
      amount,
      balance_after,
      transaction_id
    )
  } else if (transaction_type === 'withdraw') {
    cardMessage = createWithdrawCard(
      username,
      amount,
      balance_after,
      transaction_id
    )
  } else if (transaction_type === 'bet') {
    cardMessage = createBetCard(username, amount, balance_after)
  } else if (transaction_type === 'win') {
    cardMessage = createWinCard(username, amount, balance_after)
  } else {
    cardMessage = createGenericCard(
      transaction_type,
      username,
      amount,
      balance_after
    )
  }

  try {
    const response = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        to: lineUserId,
        messages: [cardMessage],
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      console.error('LINE push message error:', error)
    }
  } catch (error) {
    console.error('Send LINE notification error:', error)
    throw error
  }
}

// สร้าง Deposit Card
function createDepositCard(username, amount, balance, transactionId) {
  return {
    type: 'flex',
    altText: `💰 ฝากเงินสำเร็จ ฿${amount.toLocaleString()}`,
    contents: {
      type: 'bubble',
      size: 'micro',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '💰 ฝากเงินสำเร็จ',
            weight: 'bold',
            color: '#ffffff',
            size: 'sm',
          },
        ],
        backgroundColor: '#28a745',
        paddingAll: '13px',
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: `จำนวน: ฿${amount.toLocaleString()}`,
            size: 'sm',
            weight: 'bold',
            color: '#28a745',
          },
          {
            type: 'text',
            text: `ยอดคงเหลือ: ฿${balance.toLocaleString()}`,
            size: 'sm',
            color: '#333333',
            margin: 'sm',
          },
          {
            type: 'text',
            text: `Ref: ${transactionId}`,
            size: 'xs',
            color: '#999999',
            margin: 'sm',
          },
        ],
        paddingAll: '13px',
      },
    },
  }
}

// สร้าง Withdraw Card
function createWithdrawCard(username, amount, balance, transactionId) {
  return {
    type: 'flex',
    altText: `💸 ถอนเงินสำเร็จ ฿${amount.toLocaleString()}`,
    contents: {
      type: 'bubble',
      size: 'micro',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '💸 ถอนเงินสำเร็จ',
            weight: 'bold',
            color: '#ffffff',
            size: 'sm',
          },
        ],
        backgroundColor: '#dc3545',
        paddingAll: '13px',
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: `จำนวน: ฿${amount.toLocaleString()}`,
            size: 'sm',
            weight: 'bold',
            color: '#dc3545',
          },
          {
            type: 'text',
            text: `ยอดคงเหลือ: ฿${balance.toLocaleString()}`,
            size: 'sm',
            color: '#333333',
            margin: 'sm',
          },
          {
            type: 'text',
            text: `Ref: ${transactionId}`,
            size: 'xs',
            color: '#999999',
            margin: 'sm',
          },
        ],
        paddingAll: '13px',
      },
    },
  }
}

// สร้าง Bet Card
function createBetCard(username, amount, balance) {
  return {
    type: 'flex',
    altText: `🎰 วางเดิมพัน ฿${amount.toLocaleString()}`,
    contents: {
      type: 'bubble',
      size: 'micro',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '🎰 วางเดิมพัน',
            weight: 'bold',
            color: '#ffffff',
            size: 'sm',
          },
        ],
        backgroundColor: '#fd7e14',
        paddingAll: '13px',
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: `จำนวน: ฿${amount.toLocaleString()}`,
            size: 'sm',
            weight: 'bold',
            color: '#fd7e14',
          },
          {
            type: 'text',
            text: `ยอดคงเหลือ: ฿${balance.toLocaleString()}`,
            size: 'sm',
            color: '#333333',
            margin: 'sm',
          },
          {
            type: 'text',
            text: 'โชคดี! 🍀',
            size: 'xs',
            color: '#999999',
            margin: 'sm',
          },
        ],
        paddingAll: '13px',
      },
    },
  }
}

// สร้าง Win Card
function createWinCard(username, amount, balance) {
  return {
    type: 'flex',
    altText: `🎉 ชนะเดิมพัน ฿${amount.toLocaleString()}`,
    contents: {
      type: 'bubble',
      size: 'micro',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '🎉 ชนะเดิมพัน!',
            weight: 'bold',
            color: '#ffffff',
            size: 'sm',
          },
        ],
        backgroundColor: '#20c997',
        paddingAll: '13px',
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: `ได้รับ: ฿${amount.toLocaleString()}`,
            size: 'sm',
            weight: 'bold',
            color: '#20c997',
          },
          {
            type: 'text',
            text: `ยอดคงเหลือ: ฿${balance.toLocaleString()}`,
            size: 'sm',
            color: '#333333',
            margin: 'sm',
          },
          {
            type: 'text',
            text: 'ยินดีด้วย! 🎊',
            size: 'xs',
            color: '#999999',
            margin: 'sm',
          },
        ],
        paddingAll: '13px',
      },
    },
  }
}

// สร้าง Generic Card
function createGenericCard(type, username, amount, balance) {
  return {
    type: 'flex',
    altText: `📊 ${type} ฿${amount.toLocaleString()}`,
    contents: {
      type: 'bubble',
      size: 'micro',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: `📊 ${type}`,
            weight: 'bold',
            color: '#ffffff',
            size: 'sm',
          },
        ],
        backgroundColor: '#6c757d',
        paddingAll: '13px',
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: `จำนวน: ฿${amount.toLocaleString()}`,
            size: 'sm',
            weight: 'bold',
          },
          {
            type: 'text',
            text: `ยอดคงเหลือ: ฿${balance.toLocaleString()}`,
            size: 'sm',
            color: '#333333',
            margin: 'sm',
          },
        ],
        paddingAll: '13px',
      },
    },
  }
}
