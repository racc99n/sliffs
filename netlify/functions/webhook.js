/**
 * LINE Bot Messaging API Webhook
 * Handles incoming messages from LINE users
 */

const crypto = require('crypto')
const { Pool } = require('pg')

// Environment variables
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN
const NETLIFY_URL = process.env.NETLIFY_URL || 'https://sliffs.netlify.app'

// Database connection
let pool = null

function initializeDatabase() {
  if (pool) return pool

  try {
    const databaseUrl =
      process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL

    if (databaseUrl) {
      pool = new Pool({
        connectionString: databaseUrl,
        ssl: databaseUrl.includes('localhost')
          ? false
          : { rejectUnauthorized: false },
        max: 3,
        min: 1,
        idleTimeoutMillis: 30000,
      })
      console.log('✅ Database pool initialized for LINE Bot')
    } else {
      console.warn('⚠️ Database not configured - running in demo mode')
    }

    return pool
  } catch (error) {
    console.error('❌ Database initialization failed:', error)
    return null
  }
}

// Verify LINE signature
function verifyLineSignature(body, signature) {
  if (!LINE_CHANNEL_SECRET || !signature) {
    console.warn('⚠️ LINE signature verification skipped (missing credentials)')
    return true // Allow in demo mode
  }

  try {
    const hash = crypto
      .createHmac('sha256', LINE_CHANNEL_SECRET)
      .update(body)
      .digest('base64')

    return hash === signature
  } catch (error) {
    console.error('❌ Signature verification error:', error)
    return false
  }
}

// Database functions
async function executeQuery(query, params = []) {
  const client = initializeDatabase()
  if (!client) return null

  try {
    const result = await client.query(query, params)
    return result
  } catch (error) {
    console.error('❌ Database query error:', error)
    return null
  }
}

async function upsertLineUser(userData) {
  try {
    const query = `
            INSERT INTO line_users (
                line_user_id, display_name, picture_url, 
                status_message, language, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT (line_user_id) 
            DO UPDATE SET
                display_name = EXCLUDED.display_name,
                picture_url = EXCLUDED.picture_url,
                status_message = EXCLUDED.status_message,
                updated_at = CURRENT_TIMESTAMP
            RETURNING id, line_user_id, is_linked;
        `

    const params = [
      userData.userId,
      userData.displayName || null,
      userData.pictureUrl || null,
      userData.statusMessage || null,
      userData.language || 'th',
    ]

    const result = await executeQuery(query, params)
    return result?.rows[0]
  } catch (error) {
    console.error('❌ Error upserting LINE user:', error)
    return null
  }
}

async function checkUserLinking(lineUserId) {
  try {
    const query = `
            SELECT 
                lu.id,
                lu.line_user_id,
                lu.display_name,
                lu.is_linked,
                al.prima789_username,
                pa.username,
                pa.available,
                pa.first_name,
                pa.last_name
            FROM line_users lu
            LEFT JOIN account_links al ON lu.line_user_id = al.line_user_id
            LEFT JOIN prima789_accounts pa ON al.prima789_username = pa.username
            WHERE lu.line_user_id = $1;
        `

    const result = await executeQuery(query, [lineUserId])
    return result?.rows[0]
  } catch (error) {
    console.error('❌ Error checking user linking:', error)
    return null
  }
}

async function getUserTransactions(lineUserId, limit = 5) {
  try {
    const query = `
            SELECT 
                t.transaction_type,
                t.amount,
                t.balance_before,
                t.balance_after,
                t.created_at,
                t.details
            FROM transactions t
            JOIN account_links al ON t.username = al.prima789_username
            WHERE al.line_user_id = $1
            ORDER BY t.created_at DESC
            LIMIT $2;
        `

    const result = await executeQuery(query, [lineUserId, limit])
    return result?.rows || []
  } catch (error) {
    console.error('❌ Error getting user transactions:', error)
    return []
  }
}

// LINE API functions
async function getLineUserProfile(userId) {
  if (!LINE_CHANNEL_ACCESS_TOKEN) {
    console.warn('⚠️ LINE Channel Access Token not configured')
    return null
  }

  try {
    const response = await fetch(
      `https://api.line.me/v2/bot/profile/${userId}`,
      {
        headers: {
          Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
        },
      }
    )

    if (!response.ok) {
      throw new Error(`LINE API error: ${response.status}`)
    }

    return await response.json()
  } catch (error) {
    console.error('❌ Error getting LINE user profile:', error)
    return null
  }
}

async function sendReplyMessage(replyToken, messages) {
  if (!LINE_CHANNEL_ACCESS_TOKEN) {
    console.warn(
      '⚠️ LINE Channel Access Token not configured - cannot send reply'
    )
    return false
  }

  try {
    const response = await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        replyToken: replyToken,
        messages: Array.isArray(messages) ? messages : [messages],
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`LINE API error: ${response.status} - ${error}`)
    }

    console.log('✅ Reply message sent successfully')
    return true
  } catch (error) {
    console.error('❌ Error sending reply message:', error)
    return false
  }
}

// Message handlers
async function handleTextMessage(event) {
  const userId = event.source.userId
  const message = event.message.text.trim()

  console.log(`💬 Text message from ${userId}: ${message}`)

  // Get user profile and update database
  const profile = await getLineUserProfile(userId)
  if (profile) {
    await upsertLineUser(profile)
  }

  // Check account linking status
  const linkStatus = await checkUserLinking(userId)

  // Handle different commands
  if (
    message.toLowerCase().includes('สวัสดี') ||
    message.toLowerCase().includes('hello')
  ) {
    await sendWelcomeMessage(event.replyToken, linkStatus)
  } else if (
    message.toLowerCase().includes('ยอดเงิน') ||
    message.toLowerCase().includes('balance')
  ) {
    await sendBalanceMessage(event.replyToken, linkStatus)
  } else if (
    message.toLowerCase().includes('ประวัติ') ||
    message.toLowerCase().includes('history')
  ) {
    await sendTransactionHistory(event.replyToken, userId)
  } else if (
    message.toLowerCase().includes('ช่วยเหลือ') ||
    message.toLowerCase().includes('help')
  ) {
    await sendHelpMessage(event.replyToken)
  } else if (
    message.toLowerCase().includes('เชื่อมต่อ') ||
    message.toLowerCase().includes('link')
  ) {
    await sendLinkingMessage(event.replyToken)
  } else {
    await sendDefaultMessage(event.replyToken, linkStatus)
  }
}

async function handlePostbackEvent(event) {
  const userId = event.source.userId
  const data = event.postback.data

  console.log(`🔗 Postback from ${userId}: ${data}`)

  if (data === 'action=help') {
    await sendHelpMessage(event.replyToken)
  } else if (data === 'action=link_account') {
    await sendLinkingMessage(event.replyToken)
  } else if (data === 'action=balance') {
    const linkStatus = await checkUserLinking(userId)
    await sendBalanceMessage(event.replyToken, linkStatus)
  } else if (data === 'action=history') {
    await sendTransactionHistory(event.replyToken, userId)
  }
}

// Message generators
async function sendWelcomeMessage(replyToken, linkStatus) {
  const isLinked = linkStatus && linkStatus.is_linked
  const userName = linkStatus?.display_name || 'สมาชิก'

  const message = {
    type: 'flex',
    altText: 'ยินดีต้อนรับสู่ Prima789!',
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '🎰 Prima789',
            weight: 'bold',
            size: 'xl',
            color: '#ffffff',
          },
          {
            type: 'text',
            text: `ยินดีต้อนรับ ${userName}!`,
            size: 'sm',
            color: '#ffffff',
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
          {
            type: 'text',
            text: isLinked
              ? '✅ บัญชีของคุณเชื่อมต่อแล้ว'
              : '🔗 เชื่อมต่อบัญชีเพื่อเริ่มใช้งาน',
            wrap: true,
            color: isLinked ? '#22c55e' : '#f59e0b',
            weight: 'bold',
          },
          {
            type: 'separator',
            margin: 'md',
          },
          {
            type: 'text',
            text: 'คำสั่งที่ใช้ได้:',
            weight: 'bold',
            margin: 'md',
          },
          {
            type: 'text',
            text: '• "ยอดเงิน" - ตรวจสอบยอดเงิน\n• "ประวัติ" - ดูประวัติการทำรายการ\n• "เชื่อมต่อ" - เชื่อมต่อบัญชี\n• "ช่วยเหลือ" - ความช่วยเหลือ',
            size: 'sm',
            color: '#666666',
            wrap: true,
            margin: 'sm',
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'button',
            style: 'primary',
            height: 'sm',
            action: {
              type: 'uri',
              label: isLinked ? '📱 เปิด Member Card' : '🔗 เชื่อมต่อบัญชี',
              uri: isLinked
                ? `${NETLIFY_URL}/liff-member-card.html`
                : `${NETLIFY_URL}/liff-account-linking.html`,
            },
          },
        ],
      },
    },
  }

  await sendReplyMessage(replyToken, message)
}

async function sendBalanceMessage(replyToken, linkStatus) {
  if (!linkStatus || !linkStatus.is_linked) {
    const message = {
      type: 'text',
      text: '❌ คุณยังไม่ได้เชื่อมต่อบัญชี Prima789\n\nกรุณาเชื่อมต่อบัญชีก่อนเพื่อดูยอดเงิน',
    }

    await sendReplyMessage(replyToken, message)
    return
  }

  const balance = parseFloat(linkStatus.available) || 0
  const formattedBalance = balance.toLocaleString('th-TH', {
    style: 'currency',
    currency: 'THB',
  })

  const message = {
    type: 'flex',
    altText: `ยอดเงินคงเหลือ: ${formattedBalance}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '💰 ยอดเงินคงเหลือ',
            weight: 'bold',
            size: 'lg',
            color: '#ffffff',
          },
        ],
        backgroundColor: '#22c55e',
        paddingAll: '15px',
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: formattedBalance,
            size: 'xxl',
            weight: 'bold',
            color: '#22c55e',
            align: 'center',
          },
          {
            type: 'separator',
            margin: 'md',
          },
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              {
                type: 'text',
                text: 'ชื่อบัญชี:',
                size: 'sm',
                color: '#666666',
                flex: 1,
              },
              {
                type: 'text',
                text:
                  `${linkStatus.first_name || ''} ${
                    linkStatus.last_name || ''
                  }`.trim() || linkStatus.username,
                size: 'sm',
                weight: 'bold',
                flex: 2,
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
                text: 'อัพเดตล่าสุด:',
                size: 'sm',
                color: '#666666',
                flex: 1,
              },
              {
                type: 'text',
                text: new Date().toLocaleDateString('th-TH'),
                size: 'sm',
                flex: 2,
                align: 'end',
              },
            ],
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'secondary',
            height: 'sm',
            action: {
              type: 'postback',
              label: '📊 ประวัติ',
              data: 'action=history',
            },
            flex: 1,
          },
          {
            type: 'button',
            style: 'primary',
            height: 'sm',
            action: {
              type: 'uri',
              label: '📱 Member Card',
              uri: `${NETLIFY_URL}/liff-member-card.html`,
            },
            flex: 2,
          },
        ],
      },
    },
  }

  await sendReplyMessage(replyToken, message)
}

async function sendTransactionHistory(replyToken, userId) {
  const transactions = await getUserTransactions(userId, 5)

  if (transactions.length === 0) {
    const message = {
      type: 'text',
      text: '📊 ไม่พบประวัติการทำรายการ\n\nหากคุณเพิ่งเชื่อมต่อบัญชี กรุณารอสักครู่แล้วลองใหม่อีกครั้ง',
    }

    await sendReplyMessage(replyToken, message)
    return
  }

  const transactionElements = transactions.map((tx) => ({
    type: 'box',
    layout: 'horizontal',
    contents: [
      {
        type: 'text',
        text: getTransactionIcon(tx.transaction_type),
        flex: 0,
        size: 'lg',
      },
      {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: getTransactionName(tx.transaction_type),
            weight: 'bold',
            size: 'sm',
          },
          {
            type: 'text',
            text: new Date(tx.created_at).toLocaleDateString('th-TH'),
            size: 'xs',
            color: '#666666',
          },
        ],
        flex: 2,
      },
      {
        type: 'text',
        text: tx.amount ? `₿${Math.abs(tx.amount).toLocaleString()}` : '-',
        align: 'end',
        weight: 'bold',
        color: tx.transaction_type === 'deposit' ? '#22c55e' : '#ef4444',
        flex: 1,
      },
    ],
    paddingAll: '8px',
  }))

  const message = {
    type: 'flex',
    altText: 'ประวัติการทำรายการ',
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '📊 ประวัติการทำรายการ',
            weight: 'bold',
            size: 'lg',
            color: '#ffffff',
          },
          {
            type: 'text',
            text: `${transactions.length} รายการล่าสุด`,
            size: 'sm',
            color: '#ffffff',
          },
        ],
        backgroundColor: '#667eea',
        paddingAll: '15px',
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: transactionElements,
        spacing: 'sm',
      },
    },
  }

  await sendReplyMessage(replyToken, message)
}

async function sendLinkingMessage(replyToken) {
  const message = {
    type: 'flex',
    altText: 'เชื่อมต่อบัญชี Prima789',
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '🔗 เชื่อมต่อบัญชี',
            weight: 'bold',
            size: 'lg',
            color: '#ffffff',
          },
        ],
        backgroundColor: '#f59e0b',
        paddingAll: '15px',
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: 'เชื่อมต่อบัญชี Prima789 กับ LINE เพื่อ:',
            weight: 'bold',
            wrap: true,
          },
          {
            type: 'text',
            text: '• ตรวจสอบยอดเงินแบบ Real-time\n• รับแจ้งเตือนการทำรายการ\n• ดูประวัติการเล่นทั้งหมด\n• จัดการบัญชีได้สะดวก',
            size: 'sm',
            color: '#666666',
            wrap: true,
            margin: 'md',
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'button',
            style: 'primary',
            height: 'sm',
            action: {
              type: 'uri',
              label: '🚀 เริ่มเชื่อมต่อเลย!',
              uri: `${NETLIFY_URL}/liff-account-linking.html`,
            },
          },
        ],
      },
    },
  }

  await sendReplyMessage(replyToken, message)
}

async function sendHelpMessage(replyToken) {
  const message = {
    type: 'flex',
    altText: 'ความช่วยเหลือ Prima789 Bot',
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '❓ ความช่วยเหลือ',
            weight: 'bold',
            size: 'lg',
            color: '#ffffff',
          },
        ],
        backgroundColor: '#6366f1',
        paddingAll: '15px',
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '📝 คำสั่งที่ใช้ได้:',
            weight: 'bold',
            size: 'md',
          },
          {
            type: 'text',
            text: '• พิมพ์ "ยอดเงิน" หรือ "balance"\n• พิมพ์ "ประวัติ" หรือ "history"\n• พิมพ์ "เชื่อมต่อ" หรือ "link"\n• พิมพ์ "สวัสดี" หรือ "hello"',
            size: 'sm',
            wrap: true,
            margin: 'md',
          },
          {
            type: 'separator',
            margin: 'md',
          },
          {
            type: 'text',
            text: '🔧 ฟีเจอร์หลัก:',
            weight: 'bold',
            size: 'md',
            margin: 'md',
          },
          {
            type: 'text',
            text: '• เชื่อมต่อบัญชี Prima789\n• ตรวจสอบยอดเงินแบบ Real-time\n• ดูประวัติการทำรายการ\n• รับการแจ้งเตือนอัตโนมัติ',
            size: 'sm',
            wrap: true,
            margin: 'sm',
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'secondary',
            height: 'sm',
            action: {
              type: 'postback',
              label: '🔗 เชื่อมต่อ',
              data: 'action=link_account',
            },
            flex: 1,
          },
          {
            type: 'button',
            style: 'primary',
            height: 'sm',
            action: {
              type: 'postback',
              label: '💰 ยอดเงิน',
              data: 'action=balance',
            },
            flex: 1,
          },
        ],
      },
    },
  }

  await sendReplyMessage(replyToken, message)
}

async function sendDefaultMessage(replyToken, linkStatus) {
  const isLinked = linkStatus && linkStatus.is_linked

  const message = {
    type: 'text',
    text: `🤖 สวัสดีครับ! ผมเป็น Prima789 Bot\n\n${
      isLinked ? '✅' : '🔗'
    } สถานะ: ${
      isLinked ? 'เชื่อมต่อแล้ว' : 'ยังไม่ได้เชื่อมต่อ'
    }\n\nลองพิมพ์คำสั่งเหล่านี้:\n• "ยอดเงิน" - ดูยอดเงิน\n• "ประวัติ" - ดูประวัติ\n• "เชื่อมต่อ" - เชื่อมต่อบัญชี\n• "ช่วยเหลือ" - ดูความช่วยเหลือ`,
  }

  await sendReplyMessage(replyToken, message)
}

// Utility functions
function getTransactionIcon(type) {
  const icons = {
    deposit: '💰',
    withdrawal: '💸',
    bet: '🎲',
    win: '🏆',
    bonus: '🎁',
    data_sync: '🔄',
    user_login: '🔐',
    heartbeat: '💓',
  }
  return icons[type] || '📄'
}

function getTransactionName(type) {
  const names = {
    deposit: 'ฝากเงิน',
    withdrawal: 'ถอนเงิน',
    bet: 'วางเดิมพัน',
    win: 'ชนะเดิมพัน',
    bonus: 'โบนัส',
    data_sync: 'ซิงค์ข้อมูล',
    user_login: 'เข้าสู่ระบบ',
    heartbeat: 'ตรวจสอบระบบ',
  }
  return names[type] || type
}

// Main webhook handler
exports.handler = async (event, context) => {
  console.log('🤖 LINE Bot Webhook - Start')
  console.log('📊 Request info:', {
    method: event.httpMethod,
    headers: event.headers ? Object.keys(event.headers) : 'none',
    bodyLength: event.body ? event.body.length : 0,
  })

  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, X-Line-Signature',
    'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
    'Content-Type': 'application/json',
  }

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ message: 'CORS OK' }),
    }
  }

  // Health check
  if (event.httpMethod === 'GET') {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        status: 'LINE Bot Webhook is running',
        timestamp: new Date().toISOString(),
        config: {
          line_configured: !!LINE_CHANNEL_ACCESS_TOKEN,
          database_configured: !!process.env.NETLIFY_DATABASE_URL,
          netlify_url: NETLIFY_URL,
        },
      }),
    }
  }

  // Only allow POST for webhook events
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Method not allowed',
      }),
    }
  }

  try {
    // Verify LINE signature
    const signature =
      event.headers['x-line-signature'] || event.headers['X-Line-Signature']
    const body = event.body

    if (!verifyLineSignature(body, signature)) {
      console.error('❌ Invalid LINE signature')
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Invalid signature',
        }),
      }
    }

    // Parse webhook events
    let webhookData
    try {
      webhookData = JSON.parse(body)
    } catch (parseError) {
      console.error('❌ JSON parse error:', parseError)
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Invalid JSON',
        }),
      }
    }

    console.log('📨 Webhook data:', JSON.stringify(webhookData, null, 2))

    // Initialize database
    initializeDatabase()

    // Process each event
    const events = webhookData.events || []
    console.log(`📬 Processing ${events.length} events`)

    for (const event of events) {
      console.log(`🎯 Event type: ${event.type}`)

      try {
        switch (event.type) {
          case 'message':
            if (event.message.type === 'text') {
              await handleTextMessage(event)
            }
            break

          case 'postback':
            await handlePostbackEvent(event)
            break

          case 'follow':
            console.log('👋 New follower:', event.source.userId)
            const profile = await getLineUserProfile(event.source.userId)
            if (profile) {
              await upsertLineUser(profile)
            }
            await sendWelcomeMessage(event.replyToken, null)
            break

          case 'unfollow':
            console.log('👋 User unfollowed:', event.source.userId)
            break

          default:
            console.log(`ℹ️ Unhandled event type: ${event.type}`)
        }
      } catch (eventError) {
        console.error(`❌ Error processing event ${event.type}:`, eventError)
      }
    }

    console.log('✅ LINE Bot Webhook completed successfully')

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Events processed successfully',
        processed_events: events.length,
        timestamp: new Date().toISOString(),
      }),
    }
  } catch (error) {
    console.error('❌ LINE Bot Webhook error:', error)
    console.error('Stack trace:', error.stack)

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Internal server error',
        timestamp: new Date().toISOString(),
      }),
    }
  }
}
