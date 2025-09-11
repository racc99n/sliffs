import pkg from 'pg'
const { Pool } = pkg

export const handler = async (event, context) => {
  try {
    const { lineUserId, requestType = 'balance' } = JSON.parse(
      event.body || '{}'
    )

    if (!lineUserId) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          message: 'lineUserId is required',
        }),
      }
    }

    console.log(
      'Balance inquiry for LINE User:',
      lineUserId,
      'Type:',
      requestType
    )

    // Database connection
    const pool = new Pool({
      connectionString: process.env.NETLIFY_DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    })

    const client = await pool.connect()

    try {
      // 1. หาข้อมูล user ที่เชื่อมโยงกับ LINE account
      const userQuery = `
                SELECT 
                    la.line_user_id,
                    la.prima789_username,
                    la.prima789_user_id,
                    la.linked_at,
                    la.last_sync_at,
                    pd.username,
                    pd.balance,
                    pd.points,
                    pd.tier,
                    pd.total_deposits,
                    pd.total_withdrawals,
                    pd.games_played,
                    pd.last_login,
                    pd.updated_at
                FROM line_accounts la
                LEFT JOIN prima789_data pd ON la.prima789_user_id = pd.user_id
                WHERE la.line_user_id = $1 AND la.status = 'active'
                ORDER BY la.linked_at DESC
                LIMIT 1
            `

      const userResult = await client.query(userQuery, [lineUserId])

      if (userResult.rows.length === 0) {
        // Account ยังไม่ได้เชื่อมโยง
        await sendAccountNotLinkedMessage(lineUserId)

        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: true,
            message: 'Account not linked message sent',
          }),
        }
      }

      const userData = userResult.rows[0]

      // 2. ดึงข้อมูลล่าสุดจาก Prima789 (optional - สำหรับ real-time sync)
      if (requestType === 'refresh') {
        await refreshUserDataFromPrima789(client, userData)

        // Re-fetch updated data
        const updatedResult = await client.query(userQuery, [lineUserId])
        userData = updatedResult.rows[0]
      }

      // 3. ดึงธุรกรรมล่าสุด (5 รายการ)
      const transactionsQuery = `
                SELECT 
                    transaction_type,
                    amount,
                    balance_after,
                    transaction_id,
                    timestamp,
                    created_at
                FROM transaction_logs
                WHERE prima789_user_id = $1 OR prima789_username = $2
                ORDER BY created_at DESC
                LIMIT 5
            `

      const transactionsResult = await client.query(transactionsQuery, [
        userData.prima789_user_id,
        userData.prima789_username,
      ])

      // 4. ส่ง Balance Card Message
      const cardMessage = createBalanceCard(userData, transactionsResult.rows)
      await sendBalanceCard(lineUserId, cardMessage)

      // 5. อัปเดต last_sync_at
      await client.query(
        `
                UPDATE line_accounts 
                SET last_sync_at = NOW()
                WHERE line_user_id = $1
            `,
        [lineUserId]
      )

      // 6. Log การเข้าถึง
      await client.query(
        `
                INSERT INTO sync_logs (
                    line_user_id, prima789_user_id, sync_type, 
                    status, details, created_at
                ) VALUES ($1, $2, $3, $4, $5, NOW())
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

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          message: 'Balance card sent successfully',
          data: {
            username: userData.username,
            balance: userData.balance,
            points: userData.points,
            tier: userData.tier,
            last_updated: userData.updated_at,
          },
        }),
      }
    } finally {
      client.release()
      await pool.end()
    }
  } catch (error) {
    console.error('Balance inquiry error:', error)

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: 'Balance inquiry error',
        message: 'Failed to process balance inquiry',
        details:
          process.env.NODE_ENV === 'development' ? error.message : undefined,
      }),
    }
  }
}

// ส่งข้อความแจ้งว่า account ยังไม่ได้เชื่อมโยง
async function sendAccountNotLinkedMessage(lineUserId) {
  const message = {
    type: 'flex',
    altText: '❌ บัญชียังไม่ได้เชื่อมโยง',
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '❌ บัญชียังไม่ได้เชื่อมโยง',
            weight: 'bold',
            color: '#ffffff',
            size: 'md',
          },
        ],
        backgroundColor: '#dc3545',
        paddingAll: '20px',
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: 'กรุณาเข้าสู่ระบบผ่าน Prima789.com เพื่อเชื่อมโยงบัญชี LINE ของคุณ',
            wrap: true,
            size: 'sm',
            color: '#333333',
          },
          {
            type: 'text',
            text: 'หลังจากเข้าสู่ระบบแล้ว ระบบจะเชื่อมโยงอัตโนมัติ',
            wrap: true,
            size: 'xs',
            color: '#666666',
            margin: 'md',
          },
        ],
        paddingAll: '20px',
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'button',
            style: 'primary',
            action: {
              type: 'uri',
              label: '🌐 เข้าสู่ระบบ Prima789',
              uri: 'https://prima789.com/login',
            },
            color: '#667eea',
          },
        ],
        paddingAll: '20px',
      },
    },
  }

  await sendLineMessage(lineUserId, message)
}

// ดึงข้อมูลล่าสุดจาก Prima789 (สำหรับ refresh)
async function refreshUserDataFromPrima789(client, userData) {
  try {
    // TODO: เรียก Prima789 API เพื่อดึงข้อมูลล่าสุด
    // สำหรับตอนนี้ใช้ mock data
    console.log('Refreshing data from Prima789 for:', userData.username)

    // Mock API call - ในความเป็นจริงจะเรียก Prima789 API
    const mockUpdatedData = {
      balance: userData.balance + Math.floor(Math.random() * 1000) - 500,
      points: userData.points + Math.floor(Math.random() * 10),
      last_login: new Date().toISOString(),
    }

    // อัปเดตข้อมูลในฐานข้อมูล
    await client.query(
      `
            UPDATE prima789_data 
            SET 
                balance = $1,
                points = $2,
                last_login = $3,
                updated_at = NOW()
            WHERE user_id = $4
        `,
      [
        mockUpdatedData.balance,
        mockUpdatedData.points,
        mockUpdatedData.last_login,
        userData.prima789_user_id,
      ]
    )

    console.log('Data refreshed successfully for:', userData.username)
  } catch (error) {
    console.error('Failed to refresh data from Prima789:', error)
    // ไม่ throw error เพื่อให้ส่งข้อมูลเก่าได้
  }
}

// สร้าง Balance Card
function createBalanceCard(userData, recentTransactions) {
  const {
    username,
    balance,
    points,
    tier,
    total_deposits,
    total_withdrawals,
    last_login,
  } = userData

  // สร้าง transaction history
  const transactionContents = recentTransactions.slice(0, 3).map((tx) => ({
    type: 'box',
    layout: 'horizontal',
    contents: [
      {
        type: 'text',
        text: getTransactionIcon(tx.transaction_type),
        size: 'sm',
        flex: 0,
      },
      {
        type: 'text',
        text: getTransactionLabel(tx.transaction_type),
        size: 'xs',
        color: '#666666',
        flex: 2,
      },
      {
        type: 'text',
        text: `฿${Math.abs(tx.amount).toLocaleString()}`,
        size: 'xs',
        color: getTransactionColor(tx.transaction_type),
        align: 'end',
        flex: 1,
      },
    ],
    margin: 'sm',
  }))

  return {
    type: 'flex',
    altText: `💰 ยอดคงเหลือ: ฿${balance.toLocaleString()}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '💳 Prima789 Member Card',
            weight: 'bold',
            color: '#ffffff',
            size: 'md',
          },
          {
            type: 'text',
            text: username,
            color: '#ffffff',
            size: 'sm',
            margin: 'sm',
          },
        ],
        backgroundColor: '#667eea',
        paddingAll: '20px',
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          // ยอดเงินคงเหลือ
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              {
                type: 'text',
                text: 'ยอดคงเหลือ',
                size: 'sm',
                color: '#666666',
              },
              {
                type: 'text',
                text: `฿${balance.toLocaleString()}`,
                size: 'lg',
                weight: 'bold',
                color: '#28a745',
                align: 'end',
              },
            ],
          },

          // คะแนนและระดับ
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              {
                type: 'text',
                text: 'คะแนนสะสม',
                size: 'sm',
                color: '#666666',
              },
              {
                type: 'text',
                text: `${points.toLocaleString()} pts`,
                size: 'sm',
                weight: 'bold',
                color: '#fd7e14',
                align: 'end',
              },
            ],
            margin: 'md',
          },

          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              {
                type: 'text',
                text: 'ระดับสมาชิก',
                size: 'sm',
                color: '#666666',
              },
              {
                type: 'text',
                text: `👑 ${tier}`,
                size: 'sm',
                weight: 'bold',
                color: getTierColor(tier),
                align: 'end',
              },
            ],
            margin: 'sm',
          },

          // Separator
          {
            type: 'separator',
            margin: 'xl',
          },

          // รายการล่าสุด
          {
            type: 'text',
            text: '📊 รายการล่าสุด',
            size: 'sm',
            weight: 'bold',
            color: '#333333',
            margin: 'xl',
          },

          ...transactionContents,

          // สถิติการใช้งาน
          {
            type: 'separator',
            margin: 'xl',
          },

          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              {
                type: 'box',
                layout: 'vertical',
                contents: [
                  {
                    type: 'text',
                    text: '💰 ฝากทั้งหมด',
                    size: 'xs',
                    color: '#666666',
                  },
                  {
                    type: 'text',
                    text: `฿${total_deposits.toLocaleString()}`,
                    size: 'sm',
                    weight: 'bold',
                    color: '#28a745',
                  },
                ],
                flex: 1,
              },
              {
                type: 'box',
                layout: 'vertical',
                contents: [
                  {
                    type: 'text',
                    text: '💸 ถอนทั้งหมด',
                    size: 'xs',
                    color: '#666666',
                  },
                  {
                    type: 'text',
                    text: `฿${total_withdrawals.toLocaleString()}`,
                    size: 'sm',
                    weight: 'bold',
                    color: '#dc3545',
                  },
                ],
                flex: 1,
              },
            ],
            margin: 'md',
          },
        ],
        paddingAll: '20px',
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        contents: [
          {
            type: 'button',
            style: 'secondary',
            action: {
              type: 'postback',
              label: '🔄 รีเฟรช',
              data: 'action=refresh_balance',
            },
            height: 'sm',
            flex: 1,
          },
          {
            type: 'button',
            style: 'primary',
            action: {
              type: 'uri',
              label: '🌐 เข้าเล่น',
              uri: 'https://prima789.com',
            },
            height: 'sm',
            flex: 1,
            color: '#667eea',
          },
        ],
        paddingAll: '20px',
        spacing: 'sm',
      },
    },
  }
}

// Helper functions
function getTransactionIcon(type) {
  const icons = {
    deposit: '💰',
    withdraw: '💸',
    bet: '🎰',
    win: '🎉',
  }
  return icons[type] || '📊'
}

function getTransactionLabel(type) {
  const labels = {
    deposit: 'ฝากเงิน',
    withdraw: 'ถอนเงิน',
    bet: 'วางเดิมพัน',
    win: 'ชนะเดิมพัน',
  }
  return labels[type] || type
}

function getTransactionColor(type) {
  const colors = {
    deposit: '#28a745',
    withdraw: '#dc3545',
    bet: '#fd7e14',
    win: '#20c997',
  }
  return colors[type] || '#6c757d'
}

function getTierColor(tier) {
  const colors = {
    Diamond: '#17a2b8',
    Platinum: '#e83e8c',
    Gold: '#ffc107',
    Silver: '#6c757d',
    Bronze: '#795548',
  }
  return colors[tier] || '#6c757d'
}

// ส่ง LINE Message
async function sendLineMessage(lineUserId, message) {
  try {
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
    }
  } catch (error) {
    console.error('Send LINE message error:', error)
    throw error
  }
}

// ส่ง Balance Card
async function sendBalanceCard(lineUserId, cardMessage) {
  await sendLineMessage(lineUserId, cardMessage)
}
