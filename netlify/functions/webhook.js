const {
  upsertLineUser,
  checkUserLinking,
  getUserTransactions,
  getPrima789Account,
  logSystemEvent,
} = require('./utils/database')

const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN
const crypto = require('crypto')

exports.handler = async (event, context) => {
  console.log('🤖 LINE Bot Webhook - Start')

  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, X-Line-Signature',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' }
  }

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
    const signature = event.headers['x-line-signature']
    const body = event.body

    if (!verifyLineSignature(body, signature)) {
      console.log('❌ Invalid LINE signature')
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Invalid signature',
        }),
      }
    }

    const webhookData = JSON.parse(body)
    console.log('📥 LINE Webhook received:', {
      destination: webhookData.destination,
      events: webhookData.events?.length || 0,
    })

    // Process each event
    const responses = []

    for (const event of webhookData.events || []) {
      try {
        const response = await processLineEvent(event)
        if (response) {
          responses.push(response)
        }
      } catch (error) {
        console.error('Error processing event:', error)
        await logSystemEvent(
          'ERROR',
          'webhook-process-event',
          `Error processing LINE event: ${error.message}`,
          { event_type: event.type, error: error.message }
        )
      }
    }

    console.log(
      `✅ LINE Webhook processed ${webhookData.events?.length || 0} events`
    )

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        processed_events: webhookData.events?.length || 0,
        responses: responses.length,
      }),
    }
  } catch (error) {
    console.error('❌ LINE Webhook Error:', error)

    await logSystemEvent(
      'ERROR',
      'webhook',
      `Webhook processing error: ${error.message}`,
      { error: error.message, stack: error.stack }
    )

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Internal server error',
      }),
    }
  }
}

// Verify LINE signature
function verifyLineSignature(body, signature) {
  if (!LINE_CHANNEL_SECRET || !signature) {
    console.log('Missing channel secret or signature')
    return false
  }

  const hash = crypto
    .createHmac('sha256', LINE_CHANNEL_SECRET)
    .update(body, 'utf8')
    .digest('base64')

  return signature === `sha256=${hash}`
}

// Process individual LINE event
async function processLineEvent(event) {
  console.log(
    `Processing ${event.type} event from user: ${event.source?.userId}`
  )

  switch (event.type) {
    case 'message':
      return await handleMessage(event)
    case 'postback':
      return await handlePostback(event)
    case 'follow':
      return await handleFollow(event)
    case 'unfollow':
      return await handleUnfollow(event)
    case 'join':
      return await handleJoin(event)
    case 'accountLink':
      return await handleAccountLink(event)
    default:
      console.log(`Unhandled event type: ${event.type}`)
      return null
  }
}

// Handle text messages
async function handleMessage(event) {
  if (event.message.type !== 'text') {
    return null
  }

  const userId = event.source.userId
  const messageText = event.message.text.toLowerCase().trim()

  console.log(`📝 Message from ${userId}: ${messageText}`)

  // Get user profile and sync
  const userProfile = await getLineUserProfile(userId)
  if (userProfile) {
    await upsertLineUser(userProfile)
  }

  let replyMessage = null

  // Command handling
  if (
    messageText.includes('บัตร') ||
    messageText.includes('member') ||
    messageText.includes('card')
  ) {
    replyMessage = await handleMemberCardCommand(userId)
  } else if (
    messageText.includes('ยอด') ||
    messageText.includes('เงิน') ||
    messageText.includes('balance')
  ) {
    replyMessage = await handleBalanceCommand(userId)
  } else if (
    messageText.includes('ประวัติ') ||
    messageText.includes('history') ||
    messageText.includes('transaction')
  ) {
    replyMessage = await handleHistoryCommand(userId)
  } else if (
    messageText.includes('เชื่อมโยง') ||
    messageText.includes('link') ||
    messageText.includes('เชื่อม')
  ) {
    replyMessage = await handleLinkCommand(userId)
  } else if (
    messageText.includes('ช่วย') ||
    messageText.includes('help') ||
    messageText.includes('คำสั่ง')
  ) {
    replyMessage = getHelpMessage()
  } else if (
    messageText.includes('สวัสดี') ||
    messageText.includes('hello') ||
    messageText.includes('hi')
  ) {
    replyMessage = await getWelcomeMessage(userId)
  } else {
    // Default response
    replyMessage = {
      type: 'text',
      text: '🤖 สวัสดีครับ! ผมเป็น Prima789 Member Card Bot\n\nพิมพ์ "ช่วยเหลือ" เพื่อดูคำสั่งที่ใช้ได้\nหรือใช้เมนูด้านล่างเลย!',
    }
  }

  if (replyMessage) {
    await sendReplyMessage(event.replyToken, replyMessage)
    return replyMessage
  }

  return null
}

// Handle postback events (from Rich Menu or buttons)
async function handlePostback(event) {
  const userId = event.source.userId
  const postbackData = event.postback.data

  console.log(`🔘 Postback from ${userId}: ${postbackData}`)

  const params = new URLSearchParams(postbackData)
  const action = params.get('action')

  let replyMessage = null

  switch (action) {
    case 'check_balance':
      replyMessage = await handleBalanceCommand(userId)
      break
    case 'transaction_history':
      const limit = parseInt(params.get('limit')) || 5
      replyMessage = await handleHistoryCommand(userId, limit)
      break
    case 'open_member_card':
      replyMessage = await handleMemberCardCommand(userId)
      break
    case 'account_linking':
      replyMessage = await handleLinkCommand(userId)
      break
    case 'help':
      replyMessage = getHelpMessage()
      break
    case 'refresh_data':
      replyMessage = await handleRefreshCommand(userId)
      break
    default:
      replyMessage = {
        type: 'text',
        text: '🤖 ขออภัยครับ ไม่เข้าใจคำสั่งนี้\nพิมพ์ "ช่วยเหลือ" เพื่อดูคำสั่งที่ใช้ได้',
      }
  }

  if (replyMessage) {
    await sendReplyMessage(event.replyToken, replyMessage)
    return replyMessage
  }

  return null
}

// Handle follow event (user adds bot as friend)
async function handleFollow(event) {
  const userId = event.source.userId
  console.log(`👋 New follower: ${userId}`)

  // Get and sync user profile
  const userProfile = await getLineUserProfile(userId)
  if (userProfile) {
    await upsertLineUser(userProfile)

    await logSystemEvent(
      'INFO',
      'webhook-follow',
      `New follower: ${userProfile.displayName}`,
      { user_profile: userProfile },
      userId
    )
  }

  const welcomeMessage = await getWelcomeMessage(userId)
  await sendReplyMessage(event.replyToken, welcomeMessage)

  return welcomeMessage
}

// Handle unfollow event
async function handleUnfollow(event) {
  const userId = event.source.userId
  console.log(`👋 User unfollowed: ${userId}`)

  await logSystemEvent(
    'INFO',
    'webhook-unfollow',
    `User unfollowed: ${userId}`,
    { user_id: userId },
    userId
  )

  return null
}

// Handle join event (bot added to group/room)
async function handleJoin(event) {
  console.log('🎉 Bot added to group/room')

  const groupWelcomeMessage = {
    type: 'text',
    text: '🎰 สวัสดีครับ! ผมเป็น Prima789 Member Card Bot\n\nใช้คำสั่งหรือเมนูเพื่อจัดการบัตรสมาชิกของคุณ\nพิมพ์ "ช่วยเหลือ" เพื่อดูคำสั่งทั้งหมด',
  }

  await sendReplyMessage(event.replyToken, groupWelcomeMessage)
  return groupWelcomeMessage
}

// Handle account link event
async function handleAccountLink(event) {
  const userId = event.source.userId
  const linkToken = event.link.linkToken

  console.log(`🔗 Account link event from ${userId}, token: ${linkToken}`)

  // This would be used for LINE Login integration
  // For now, we'll just send a message
  const linkMessage = {
    type: 'text',
    text: '🔗 Account linking detected!\nPlease use the Member Card menu to complete linking with Prima789.',
  }

  await sendReplyMessage(event.replyToken, linkMessage)
  return linkMessage
}

// Command handlers
async function handleMemberCardCommand(userId) {
  const linkingInfo = await checkUserLinking(userId)

  if (!linkingInfo || !linkingInfo.is_linked) {
    return {
      type: 'template',
      altText: 'เชื่อมโยงบัญชี Prima789',
      template: {
        type: 'buttons',
        text: '💳 Member Card\n\nบัญชีของคุณยังไม่ได้เชื่อมโยงกับ Prima789\nกรุณาเชื่อมโยงบัญชีก่อนใช้งาน',
        actions: [
          {
            type: 'uri',
            label: '🔗 เชื่อมโยงบัญชี',
            uri: `${process.env.NETLIFY_URL}/liff-account-linking.html`,
          },
          {
            type: 'uri',
            label: '🌐 สมัครสมาชิก',
            uri: 'https://prima789.com/register',
          },
        ],
      },
    }
  }

  return {
    type: 'template',
    altText: 'Prima789 Member Card',
    template: {
      type: 'buttons',
      text: `💳 Member Card\n\nสวัสดี ${linkingInfo.display_name}\nบัญชี: ${
        linkingInfo.prima789_username
      }\nยอดเงิน: ฿${parseFloat(linkingInfo.balance || 0).toLocaleString()}`,
      actions: [
        {
          type: 'uri',
          label: '📱 เปิด Member Card',
          uri: `${process.env.NETLIFY_URL}/liff-member-card.html`,
        },
        {
          type: 'postback',
          label: '🔄 รีเฟรชยอดเงิน',
          data: 'action=refresh_data',
        },
      ],
    },
  }
}

async function handleBalanceCommand(userId) {
  const linkingInfo = await checkUserLinking(userId)

  if (!linkingInfo || !linkingInfo.is_linked) {
    return {
      type: 'text',
      text: '❌ บัญชียังไม่ได้เชื่อมโยง\nกรุณาเชื่อมโยงบัญชี Prima789 ก่อนตรวจสอบยอดเงิน\n\nใช้เมนู "เชื่อมโยงบัญชี" เพื่อเริ่มต้น',
    }
  }

  const account = await getPrima789Account(linkingInfo.prima789_username)

  if (!account) {
    return {
      type: 'text',
      text: '❌ ไม่พบข้อมูลบัญชี Prima789\nกรุณาลองใหม่อีกครั้ง หรือติดต่อฝ่ายสนับสนุน',
    }
  }

  const balance = parseFloat(account.available) || 0
  const creditLimit = parseFloat(account.credit_limit) || 0
  const points = parseInt(account.points) || 0

  return {
    type: 'template',
    altText: `💰 ยอดเงินคงเหลือ: ฿${balance.toLocaleString()}`,
    template: {
      type: 'buttons',
      text:
        `💰 ยอดเงินคงเหลือ\n\n` +
        `🏦 ยอดเงิน: ฿${balance.toLocaleString()}\n` +
        `💳 วงเงินเครดิต: ฿${creditLimit.toLocaleString()}\n` +
        `⭐ คะแนนสะสม: ${points.toLocaleString()} แต้ม\n` +
        `🏅 ระดับสมาชิก: ${account.tier}`,
      actions: [
        {
          type: 'uri',
          label: '📱 เปิด Member Card',
          uri: `${process.env.NETLIFY_URL}/liff-member-card.html`,
        },
        {
          type: 'postback',
          label: '📊 ดูประวัติธุรกรรม',
          data: 'action=transaction_history&limit=5',
        },
      ],
    },
  }
}

async function handleHistoryCommand(userId, limit = 5) {
  const linkingInfo = await checkUserLinking(userId)

  if (!linkingInfo || !linkingInfo.is_linked) {
    return {
      type: 'text',
      text: '❌ บัญชียังไม่ได้เชื่อมโยง\nกรุณาเชื่อมโยงบัญชี Prima789 ก่อนดูประวัติ',
    }
  }

  const transactions = await getUserTransactions(userId, limit)

  if (transactions.length === 0) {
    return {
      type: 'text',
      text: '📊 ประวัติธุรกรรม\n\nยังไม่มีธุรกรรมในระบบ\nเมื่อมีการทำธุรกรรมใน Prima789 จะแสดงที่นี่',
    }
  }

  let historyText = '📊 ประวัติธุรกรรม (5 รายการล่าสุด)\n\n'

  for (const tx of transactions) {
    const date = new Date(tx.created_at).toLocaleDateString('th-TH', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })

    const icon = getTransactionIcon(tx.transaction_type)
    const amount = Math.abs(parseFloat(tx.amount) || 0)
    const sign = ['withdraw', 'bet'].includes(tx.transaction_type) ? '-' : '+'

    historyText += `${icon} ${getTransactionName(tx.transaction_type)}\n`
    historyText += `   ${sign}฿${amount.toLocaleString()} | ${date}\n\n`
  }

  return {
    type: 'template',
    altText: historyText,
    template: {
      type: 'buttons',
      text:
        historyText.substring(0, 400) + (historyText.length > 400 ? '...' : ''),
      actions: [
        {
          type: 'uri',
          label: '📱 ดูรายละเอียดเพิ่มเติม',
          uri: `${process.env.NETLIFY_URL}/liff-member-card.html`,
        },
        {
          type: 'postback',
          label: '💰 เช็คยอดเงิน',
          data: 'action=check_balance',
        },
      ],
    },
  }
}

async function handleLinkCommand(userId) {
  return {
    type: 'template',
    altText: 'เชื่อมโยงบัญชี Prima789',
    template: {
      type: 'buttons',
      text: '🔗 เชื่อมโยงบัญชี Prima789\n\nเชื่อมโยงบัญชี Prima789 เพื่อใช้งาน Member Card และรับแจ้งเตือนธุรกรรมแบบ Real-time',
      actions: [
        {
          type: 'uri',
          label: '🔗 เชื่อมโยงบัญชี',
          uri: `${process.env.NETLIFY_URL}/liff-account-linking.html`,
        },
        {
          type: 'uri',
          label: '🌐 สมัครสมาชิก',
          uri: 'https://prima789.com/register',
        },
      ],
    },
  }
}

async function handleRefreshCommand(userId) {
  const linkingInfo = await checkUserLinking(userId)

  if (!linkingInfo || !linkingInfo.is_linked) {
    return {
      type: 'text',
      text: '❌ บัญชียังไม่ได้เชื่อมโยง\nไม่สามารถรีเฟรชข้อมูลได้',
    }
  }

  return {
    type: 'text',
    text: '🔄 กำลังรีเฟรชข้อมูล...\n\nใช้ Member Card เพื่อดูข้อมูลล่าสุด\nหรือเข้าสู่ระบบ Prima789.com เพื่ออัปเดตข้อมูลแบบ Real-time',
  }
}

// Helper functions
function getHelpMessage() {
  return {
    type: 'text',
    text:
      '🤖 คำสั่งที่ใช้ได้:\n\n' +
      '💳 "บัตรสมาชิก" - เปิด Member Card\n' +
      '💰 "ยอดเงิน" - เช็คยอดเงินคงเหลือ\n' +
      '📊 "ประวัติ" - ดูประวัติธุรกรรม\n' +
      '🔗 "เชื่อมโยง" - เชื่อมโยงบัญชี Prima789\n' +
      '🔄 "รีเฟรช" - อัปเดตข้อมูลล่าสุด\n' +
      '❓ "ช่วยเหลือ" - แสดงคำสั่งนี้\n\n' +
      '📱 หรือใช้เมนูด้านล่างได้เลย!',
  }
}

async function getWelcomeMessage(userId) {
  const linkingInfo = await checkUserLinking(userId)

  if (linkingInfo && linkingInfo.is_linked) {
    return {
      type: 'template',
      altText: 'ยินดีต้อนรับสู่ Prima789 Member Card',
      template: {
        type: 'buttons',
        text: `🎰 ยินดีต้อนรับสู่ Prima789\n\nสวัสดี ${
          linkingInfo.display_name
        }!\nบัญชีของคุณเชื่อมโยงแล้ว\n\nยอดเงิน: ฿${parseFloat(
          linkingInfo.balance || 0
        ).toLocaleString()}`,
        actions: [
          {
            type: 'uri',
            label: '📱 เปิด Member Card',
            uri: `${process.env.NETLIFY_URL}/liff-member-card.html`,
          },
          {
            type: 'postback',
            label: '💰 เช็คยอดเงิน',
            data: 'action=check_balance',
          },
        ],
      },
    }
  } else {
    return {
      type: 'template',
      altText: 'ยินดีต้อนรับสู่ Prima789 Member Card',
      template: {
        type: 'buttons',
        text: '🎰 ยินดีต้อนรับสู่ Prima789\n\nผมเป็น Member Card Bot ที่จะช่วยให้คุณจัดการบัญชี Prima789 ผ่าน LINE ได้สะดวก\n\nเริ่มต้นด้วยการเชื่อมโยงบัญชีกันเลย!',
        actions: [
          {
            type: 'uri',
            label: '🔗 เชื่อมโยงบัญชี',
            uri: `${process.env.NETLIFY_URL}/liff-account-linking.html`,
          },
          {
            type: 'postback',
            label: '❓ ช่วยเหลือ',
            data: 'action=help',
          },
        ],
      },
    }
  }
}

function getTransactionIcon(type) {
  const icons = {
    deposit: '💰',
    withdraw: '💸',
    bet: '🎲',
    win: '🏆',
    bonus: '🎁',
    data_sync: '🔄',
    account_link: '🔗',
    user_login: '🔐',
  }
  return icons[type] || '📄'
}

function getTransactionName(type) {
  const names = {
    deposit: 'ฝากเงิน',
    withdraw: 'ถอนเงิน',
    bet: 'วางเดิมพัน',
    win: 'ชนะเดิมพัน',
    bonus: 'โบนัส',
    data_sync: 'ซิงค์ข้อมูล',
    account_link: 'เชื่อมโยงบัญชี',
    user_login: 'เข้าสู่ระบบ',
  }
  return names[type] || type
}

// Get LINE user profile
async function getLineUserProfile(userId) {
  if (!LINE_CHANNEL_ACCESS_TOKEN) {
    console.log('LINE Channel Access Token not configured')
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
    console.error('Error getting LINE user profile:', error)
    return null
  }
}

// Send reply message
async function sendReplyMessage(replyToken, message) {
  if (!LINE_CHANNEL_ACCESS_TOKEN) {
    console.log('LINE Channel Access Token not configured')
    return
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
        messages: [message],
      }),
    })

    if (!response.ok) {
      throw new Error(`LINE API error: ${response.status}`)
    }

    console.log('✅ Reply message sent successfully')
  } catch (error) {
    console.error('Error sending reply message:', error)
  }
}
