const crypto = require('crypto')
const { Pool } = require('pg')

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET

exports.handler = async (event, context) => {
  console.log('🤖 LINE Bot Webhook - Start')
  console.log('HTTP Method:', event.httpMethod)
  console.log('Headers:', event.headers)

  // Handle CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers':
          'Content-Type, Authorization, X-Line-Signature',
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

  try {
    // Verify LINE signature
    const signature =
      event.headers['x-line-signature'] || event.headers['X-Line-Signature']
    if (!verifySignature(event.body, signature)) {
      console.error('❌ Invalid LINE signature')
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Unauthorized' }),
      }
    }

    const body = JSON.parse(event.body)
    console.log('📥 Webhook body:', JSON.stringify(body, null, 2))

    // Process events
    for (const webhookEvent of body.events) {
      await handleLineEvent(webhookEvent)
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true }),
    }
  } catch (error) {
    console.error('❌ Webhook error:', error)
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Internal server error' }),
    }
  }
}

// Verify LINE signature
function verifySignature(body, signature) {
  if (!signature || !LINE_CHANNEL_SECRET) {
    return false
  }

  const hash = crypto
    .createHmac('sha256', LINE_CHANNEL_SECRET)
    .update(body)
    .digest('base64')

  return signature === `sha256=${hash}`
}

// Handle LINE events
async function handleLineEvent(event) {
  const { type, source, replyToken } = event
  const userId = source.userId

  console.log(`📱 Event type: ${type}, User: ${userId}`)

  try {
    switch (type) {
      case 'message':
        await handleMessage(event)
        break
      case 'postback':
        await handlePostback(event)
        break
      case 'follow':
        await handleFollow(event)
        break
      case 'unfollow':
        await handleUnfollow(event)
        break
      default:
        console.log(`ℹ️ Unhandled event type: ${type}`)
    }

    // Log user activity
    await logUserActivity(userId, type, {
      event_data: event,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error(`❌ Error handling ${type} event:`, error)
  }
}

// Handle message events
async function handleMessage(event) {
  const { replyToken, message, source } = event
  const userId = source.userId
  const messageText = message.text?.toLowerCase() || ''

  console.log(`💬 Message from ${userId}: ${messageText}`)

  // Check if user account is linked
  const linkStatus = await checkAccountLinking(userId)

  if (messageText.includes('help') || messageText.includes('ช่วย')) {
    await sendHelpMessage(replyToken)
  } else if (messageText.includes('balance') || messageText.includes('ยอด')) {
    await handleBalanceInquiry(userId, replyToken)
  } else if (messageText.includes('link') || messageText.includes('เชื่อม')) {
    await sendAccountLinkingInfo(replyToken)
  } else if (messageText.includes('card') || messageText.includes('การ์ด')) {
    if (linkStatus.isLinked) {
      await sendMemberCardLink(replyToken)
    } else {
      await sendNotLinkedMessage(replyToken)
    }
  } else {
    // Default greeting with account status
    await sendGreeting(replyToken, linkStatus)
  }
}

// Handle postback events
async function handlePostback(event) {
  const { replyToken, postback, source } = event
  const userId = source.userId
  const data = postback.data

  console.log(`🔄 Postback from ${userId}: ${data}`)

  try {
    const params = parsePostbackData(data)
    const action = params.action

    switch (action) {
      case 'open_member_card':
        await sendMemberCardLink(replyToken)
        break
      case 'refresh_balance':
        await handleBalanceInquiry(userId, replyToken, 'refresh')
        break
      case 'view_history':
        await sendTransactionHistory(userId, replyToken)
        break
      case 'account_linking':
        await sendAccountLinkingLink(replyToken)
        break
      case 'check_balance':
        await handleBalanceInquiry(userId, replyToken)
        break
      case 'contact_support':
        await sendSupportInfo(replyToken)
        break
      case 'promotions':
        await sendPromotions(replyToken)
        break
      default:
        console.log(`ℹ️ Unhandled postback action: ${action}`)
    }
  } catch (error) {
    console.error('❌ Error handling postback:', error)
    await sendErrorMessage(replyToken)
  }
}

// Handle follow events
async function handleFollow(event) {
  const { replyToken, source } = event
  const userId = source.userId

  console.log(`👋 New follower: ${userId}`)

  // Send welcome message
  await sendWelcomeMessage(replyToken)

  // Log follow event
  await logUserActivity(userId, 'follow', {
    source: 'line_bot',
    timestamp: new Date().toISOString(),
  })
}

// Handle unfollow events
async function handleUnfollow(event) {
  const { source } = event
  const userId = source.userId

  console.log(`👋 User unfollowed: ${userId}`)

  // Log unfollow event
  await logUserActivity(userId, 'unfollow', {
    source: 'line_bot',
    timestamp: new Date().toISOString(),
  })
}

// Send welcome message
async function sendWelcomeMessage(replyToken) {
  const message = {
    type: 'flex',
    altText: '🎉 ยินดีต้อนรับสู่ Prima789!',
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
            text: '🎉 ยินดีต้อนรับ!',
            color: '#ffffff',
            size: 'xl',
            weight: 'bold',
            align: 'center',
          },
          {
            type: 'text',
            text: 'สู่ Prima789 LINE Official Account',
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
            type: 'text',
            text: '🚀 เริ่มต้นใช้งาน',
            weight: 'bold',
            size: 'lg',
            margin: 'sm',
          },
          {
            type: 'text',
            text: 'เพื่อใช้งาน Member Card และรับการแจ้งเตือน กรุณาเชื่อมโยงบัญชี Prima789 ของคุณก่อน',
            size: 'sm',
            color: '#666666',
            wrap: true,
          },
          {
            type: 'separator',
            margin: 'lg',
          },
          {
            type: 'text',
            text: '✨ สิทธิประโยชน์ที่คุณจะได้รับ:',
            weight: 'bold',
            margin: 'lg',
          },
          {
            type: 'text',
            text: '• 💳 Member Card แบบ Digital\n• 🔔 แจ้งเตือนธุรกรรมแบบ Real-time\n• 📊 ตรวจสอบยอดเงินผ่าน LINE\n• 🎁 รับโปรโมชั่นพิเศษ',
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
              label: '🔗 เชื่อมโยงบัญชี',
              data: 'action=account_linking',
            },
          },
          {
            type: 'button',
            style: 'secondary',
            action: {
              type: 'postback',
              label: '❓ ช่วยเหลือ',
              data: 'action=help',
            },
          },
        ],
      },
    },
  }

  await replyMessage(replyToken, [message])
}

// Send help message
async function sendHelpMessage(replyToken) {
  const message = {
    type: 'flex',
    altText: '❓ วิธีใช้งาน Prima789 LINE Bot',
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#1a1a2e',
        paddingAll: '20px',
        contents: [
          {
            type: 'text',
            text: '❓ วิธีใช้งาน',
            color: '#ffffff',
            size: 'xl',
            weight: 'bold',
            align: 'center',
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
            type: 'text',
            text: '📱 คำสั่งที่ใช้ได้',
            weight: 'bold',
            size: 'lg',
          },
          {
            type: 'text',
            text: '• พิมพ์ "ยอดเงิน" หรือ "balance" - ดูยอดเงินคงเหลือ\n• พิมพ์ "การ์ด" หรือ "card" - เปิด Member Card\n• พิมพ์ "เชื่อม" หรือ "link" - เชื่อมโยงบัญชี\n• พิมพ์ "ช่วย" หรือ "help" - ดูวิธีใช้งาน',
            size: 'sm',
            color: '#666666',
            wrap: true,
          },
          {
            type: 'separator',
            margin: 'lg',
          },
          {
            type: 'text',
            text: '🎯 เมนูด่วน',
            weight: 'bold',
            margin: 'lg',
          },
          {
            type: 'text',
            text: 'ใช้เมนูด้านล่างหน้าจอเพื่อเข้าถึงฟังก์ชันต่างๆ ได้อย่างรวดเร็ว',
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

  await replyMessage(replyToken, [message])
}

// Handle balance inquiry
async function handleBalanceInquiry(
  userId,
  replyToken,
  requestType = 'balance'
) {
  try {
    console.log(`💰 Balance inquiry from ${userId}, type: ${requestType}`)

    // Check if account is linked
    const linkStatus = await checkAccountLinking(userId)

    if (!linkStatus.isLinked) {
      await sendNotLinkedMessage(replyToken)
      return
    }

    // Request balance inquiry
    const response = await fetch(
      `${process.env.NETLIFY_URL}/.netlify/functions/balance-inquiry`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lineUserId: userId,
          requestType: requestType,
        }),
      }
    )

    const result = await response.json()

    if (result.success) {
      // Balance card will be sent by balance-inquiry function
      const confirmMessage =
        requestType === 'refresh'
          ? 'อัปเดตข้อมูลสำเร็จแล้ว'
          : 'ส่งข้อมูลยอดเงินให้คุณแล้ว'

      await replyMessage(replyToken, [
        {
          type: 'text',
          text: `✅ ${confirmMessage}\n\nข้อมูลล่าสุด:\n💰 ยอดเงิน: ฿${(
            result.data?.balance || 0
          ).toLocaleString()}\n🎯 คะแนน: ${(
            result.data?.points || 0
          ).toLocaleString()} pts`,
        },
      ])
    } else {
      await sendErrorMessage(replyToken)
    }
  } catch (error) {
    console.error('Balance inquiry error:', error)
    await sendErrorMessage(replyToken)
  }
}

// Send account linking info
async function sendAccountLinkingInfo(replyToken) {
  const message = {
    type: 'flex',
    altText: '🔗 การเชื่อมโยงบัญชี',
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        paddingAll: '20px',
        contents: [
          {
            type: 'text',
            text: '🔗 เชื่อมโยงบัญชี Prima789',
            weight: 'bold',
            size: 'lg',
          },
          {
            type: 'text',
            text: 'เชื่อมโยงบัญชี Prima789 ของคุณเพื่อใช้งาน Member Card และรับการแจ้งเตือนผ่าน LINE',
            size: 'sm',
            color: '#666666',
            wrap: true,
          },
          {
            type: 'separator',
            margin: 'lg',
          },
          {
            type: 'text',
            text: '📋 วิธีการเชื่อมโยง:',
            weight: 'bold',
            margin: 'lg',
          },
          {
            type: 'text',
            text: '1. กดปุ่ม "เชื่อมโยงบัญชี" ด้านล่าง\n2. เลือกวิธีการเชื่อมโยง\n3. ทำตามขั้นตอนในหน้าต่าง\n4. รอการยืนยันจากระบบ',
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
              label: '🔗 เชื่อมโยงบัญชี',
              data: 'action=account_linking',
            },
          },
        ],
      },
    },
  }

  await replyMessage(replyToken, [message])
}

// Send account linking link
async function sendAccountLinkingLink(replyToken) {
  const liffUrl = `${process.env.NETLIFY_URL}/liff-account-linking.html`

  const message = {
    type: 'template',
    altText: '🔗 เชื่อมโยงบัญชี Prima789',
    template: {
      type: 'buttons',
      title: '🔗 เชื่อมโยงบัญชี',
      text: 'กดปุ่มด้านล่างเพื่อเริ่มเชื่อมโยงบัญชี Prima789',
      actions: [
        {
          type: 'uri',
          label: 'เริ่มเชื่อมโยง',
          uri: liffUrl,
        },
      ],
    },
  }

  await replyMessage(replyToken, [message])
}

// Send member card link
async function sendMemberCardLink(replyToken) {
  const liffUrl = `${process.env.NETLIFY_URL}/liff-member-card.html`

  const message = {
    type: 'template',
    altText: '💳 Prima789 Member Card',
    template: {
      type: 'buttons',
      title: '💳 Member Card',
      text: 'เปิด Member Card เพื่อดูข้อมูลบัญชีและธุรกรรม',
      actions: [
        {
          type: 'uri',
          label: 'เปิด Member Card',
          uri: liffUrl,
        },
      ],
    },
  }

  await replyMessage(replyToken, [message])
}

// Send not linked message
async function sendNotLinkedMessage(replyToken) {
  const message = {
    type: 'flex',
    altText: '❌ บัญชียังไม่ได้เชื่อมโยง',
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        paddingAll: '20px',
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
            text: 'กรุณาเชื่อมโยงบัญชี Prima789 ของคุณก่อนใช้งานฟีเจอร์นี้',
            wrap: true,
            color: '#666666',
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
              label: '🔗 เชื่อมโยงบัญชี',
              data: 'action=account_linking',
            },
          },
        ],
      },
    },
  }

  await replyMessage(replyToken, [message])
}

// Send error message
async function sendErrorMessage(replyToken) {
  const message = {
    type: 'text',
    text: '❌ เกิดข้อผิดพลาด\n\nกรุณาลองใหม่อีกครั้ง หรือติดต่อเจ้าหน้าที่',
  }
  await replyMessage(replyToken, [message])
}

// Send greeting based on account status
async function sendGreeting(replyToken, linkStatus) {
  if (linkStatus.isLinked) {
    const userData = linkStatus.data
    const message = {
      type: 'flex',
      altText: `สวัสดี ${userData.display_name || userData.username}!`,
      contents: {
        type: 'bubble',
        body: {
          type: 'box',
          layout: 'vertical',
          spacing: 'md',
          paddingAll: '20px',
          contents: [
            {
              type: 'text',
              text: `👋 สวัสดี ${userData.display_name || userData.username}!`,
              weight: 'bold',
              size: 'lg',
            },
            {
              type: 'text',
              text: `💰 ยอดเงินคงเหลือ: ฿${(
                userData.balance || 0
              ).toLocaleString()}\n🎯 คะแนนสะสม: ${(
                userData.points || 0
              ).toLocaleString()} pts\n👑 ระดับ: ${userData.tier || 'Bronze'}`,
              size: 'sm',
              color: '#666666',
            },
          ],
        },
        footer: {
          type: 'box',
          layout: 'horizontal',
          spacing: 'sm',
          paddingAll: '20px',
          contents: [
            {
              type: 'button',
              style: 'primary',
              action: {
                type: 'postback',
                label: '💳 Member Card',
                data: 'action=open_member_card',
              },
              flex: 1,
            },
            {
              type: 'button',
              style: 'secondary',
              action: {
                type: 'postback',
                label: '🔄 อัปเดต',
                data: 'action=refresh_balance',
              },
              flex: 1,
            },
          ],
        },
      },
    }
    await replyMessage(replyToken, [message])
  } else {
    await sendAccountLinkingInfo(replyToken)
  }
}

// Send transaction history
async function sendTransactionHistory(userId, replyToken) {
  try {
    const linkStatus = await checkAccountLinking(userId)

    if (!linkStatus.isLinked) {
      await sendNotLinkedMessage(replyToken)
      return
    }

    const transactions = linkStatus.data.recent_transactions || []

    if (transactions.length === 0) {
      await replyMessage(replyToken, [
        {
          type: 'text',
          text: '📊 ยังไม่มีประวัติธุรกรรม',
        },
      ])
      return
    }

    const transactionText = transactions
      .slice(0, 5)
      .map((tx, index) => {
        const amount = parseFloat(tx.amount) || 0
        const date = new Date(tx.timestamp || tx.created_at).toLocaleDateString(
          'th-TH'
        )
        const type = getTransactionTypeText(tx.transaction_type)
        const amountText =
          amount >= 0
            ? `+฿${amount.toLocaleString()}`
            : `-฿${Math.abs(amount).toLocaleString()}`

        return `${index + 1}. ${type}\n   ${date} | ${amountText}`
      })
      .join('\n\n')

    const message = {
      type: 'text',
      text: `📊 ประวัติธุรกรรม 5 รายการล่าสุด\n\n${transactionText}\n\n💡 เปิด Member Card เพื่อดูรายละเอียดเพิ่มเติม`,
    }

    await replyMessage(replyToken, [message])
  } catch (error) {
    console.error('Transaction history error:', error)
    await sendErrorMessage(replyToken)
  }
}

// Send support info
async function sendSupportInfo(replyToken) {
  const message = {
    type: 'flex',
    altText: '📞 ติดต่อเจ้าหน้าที่',
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        paddingAll: '20px',
        contents: [
          {
            type: 'text',
            text: '📞 ติดต่อเจ้าหน้าที่',
            weight: 'bold',
            size: 'lg',
          },
          {
            type: 'text',
            text: '🕐 เวลาทำการ: 24 ชั่วโมง ทุกวัน\n📧 อีเมล: support@prima789.com\n📱 LINE: @prima789support',
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
              type: 'uri',
              label: '💬 แชทกับเจ้าหน้าที่',
              uri: 'https://prima789.com/support',
            },
          },
        ],
      },
    },
  }

  await replyMessage(replyToken, [message])
}

// Send promotions
async function sendPromotions(replyToken) {
  const message = {
    type: 'text',
    text: '🎁 โปรโมชั่นพิเศษ\n\nติดตามโปรโมชั่นล่าสุดได้ที่ Prima789.com\nหรือตรวจสอบผ่าน Member Card ของคุณ',
  }

  await replyMessage(replyToken, [message])
}

// Utility functions
function parsePostbackData(data) {
  const params = {}
  data.split('&').forEach((param) => {
    const [key, value] = param.split('=')
    params[key] = value
  })
  return params
}

function getTransactionTypeText(type) {
  switch (type) {
    case 'deposit':
      return '💰 ฝากเงิน'
    case 'withdraw':
      return '💸 ถอนเงิน'
    case 'bet':
      return '🎲 วางเดิมพัน'
    case 'win':
      return '🏆 ชนะเดิมพัน'
    case 'bonus':
      return '🎁 โบนัส'
    default:
      return '📄 ธุรกรรม'
  }
}

// Reply message to LINE
async function replyMessage(replyToken, messages) {
  if (!LINE_CHANNEL_ACCESS_TOKEN || !replyToken) {
    console.error('❌ Missing LINE_CHANNEL_ACCESS_TOKEN or replyToken')
    return false
  }

  try {
    const response = await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        replyToken,
        messages,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      console.error('❌ LINE API error:', error)
      return false
    }

    console.log('✅ Message sent successfully')
    return true
  } catch (error) {
    console.error('❌ Reply message error:', error)
    return false
  }
}

// Check account linking status
async function checkAccountLinking(userId) {
  try {
    const response = await fetch(
      `${process.env.NETLIFY_URL}/.netlify/functions/check-account-linking?lineUserId=${userId}`
    )
    const data = await response.json()
    return data
  } catch (error) {
    console.error('Check linking error:', error)
    return { success: false, isLinked: false }
  }
}

// Log user activity
async function logUserActivity(userId, activityType, activityData) {
  try {
    const pool = new Pool({
      connectionString: process.env.NETLIFY_DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    })

    const client = await pool.connect()

    await client.query(
      `
            INSERT INTO user_activities (
                line_user_id, activity_type, activity_data, created_at
            ) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
        `,
      [userId, activityType, JSON.stringify(activityData)]
    )

    client.release()
    await pool.end()
  } catch (error) {
    console.error('Error logging user activity:', error)
  }
}
