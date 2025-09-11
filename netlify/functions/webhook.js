import { NeonDB } from './utils/database.js'
import crypto from 'crypto'

export const handler = async (event, context) => {
  // Verify LINE signature
  const signature = event.headers['x-line-signature']
  const body = event.body

  if (!verifySignature(body, signature)) {
    console.error('Invalid LINE signature')
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'Unauthorized' }),
    }
  }

  try {
    const data = JSON.parse(body)
    console.log('Received webhook data:', JSON.stringify(data, null, 2))

    for (const event of data.events) {
      await handleEvent(event)
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ status: 'OK' }),
    }
  } catch (error) {
    console.error('Webhook error:', error)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal Server Error' }),
    }
  }
}

async function handleEvent(event) {
  const { type, replyToken, source } = event
  const userId = source?.userId

  if (!userId) {
    console.log('No user ID found in event')
    return
  }

  try {
    switch (type) {
      case 'message':
        await handleMessage(event, userId, replyToken)
        break
      case 'postback':
        await handlePostback(event, userId, replyToken)
        break
      case 'follow':
        await handleFollow(userId, replyToken)
        break
      case 'unfollow':
        await handleUnfollow(userId)
        break
      default:
        console.log(`Unhandled event type: ${type}`)
    }
  } catch (error) {
    console.error(`Error handling ${type} event:`, error)

    if (replyToken) {
      await replyMessage(replyToken, {
        type: 'text',
        text: '❌ เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง',
      })
    }
  }
}

async function handleMessage(event, userId, replyToken) {
  const { message } = event

  if (message.type !== 'text') {
    return
  }

  const text = message.text.toLowerCase().trim()
  const linkData = await NeonDB.getLinkedAccount(userId)

  if (!linkData) {
    await replyMessage(replyToken, {
      type: 'text',
      text: '❌ ยังไม่ได้เชื่อมโยงบัญชี\nกรุณาเข้าสู่ระบบที่ https://prima789.com/member#/ ก่อน',
    })
    return
  }

  if (text.includes('คะแนน') || text.includes('point')) {
    await handleCheckPoints(userId, replyToken, linkData)
  } else if (text.includes('ยอดเงิน') || text.includes('balance')) {
    await handleCheckBalance(userId, replyToken, linkData)
  } else {
    await replyMessage(replyToken, {
      type: 'text',
      text: `สวัสดี ${linkData.display_name} 👋\n\nใช้เมนูด้านล่างเพื่อ:\n💰 เช็คยอดเงิน\n💎 ดูคะแนนสะสม\n💳 เปิด Member Card`,
    })
  }
}

async function handlePostback(event, userId, replyToken) {
  const { postback } = event
  const data = postback.data

  const params = new URLSearchParams(data)
  const action = params.get('action')

  const linkData = await NeonDB.getLinkedAccount(userId)

  if (!linkData) {
    await replyMessage(replyToken, {
      type: 'text',
      text: '❌ ยังไม่ได้เชื่อมโยงบัญชี\nกรุณาเข้าสู่ระบบที่ https://prima789.com/member#/ ก่อน',
    })
    return
  }

  switch (action) {
    case 'check_balance':
      await handleCheckBalance(userId, replyToken, linkData)
      break
    case 'transaction_history':
      await handleTransactionHistory(userId, replyToken, linkData)
      break
    default:
      console.log(`Unhandled postback action: ${action}`)
  }
}

async function handleCheckBalance(userId, replyToken, linkData) {
  try {
    const memberData = await NeonDB.query(
      `
            SELECT * FROM member_data WHERE prima789_user_id = $1
        `,
      [linkData.prima789_user_id]
    )

    const data = memberData.rows[0] || { points: 0, tier: 'Bronze', balance: 0 }

    await replyMessage(replyToken, {
      type: 'text',
      text: `💰 ข้อมูลบัญชี\n\n💰 ยอดเงิน: ${(
        data.balance || 0
      ).toLocaleString()} บาท\n💎 คะแนนสะสม: ${(
        data.points || 0
      ).toLocaleString()} คะแนน\n🏆 ระดับสมาชิก: ${data.tier || 'Bronze'}`,
    })
  } catch (error) {
    console.error('Error checking balance:', error)
    await replyMessage(replyToken, {
      type: 'text',
      text: '❌ เกิดข้อผิดพลาดในการดึงข้อมูล',
    })
  }
}

async function handleCheckPoints(userId, replyToken, linkData) {
  try {
    const memberData = await NeonDB.query(
      `
            SELECT points, tier FROM member_data WHERE prima789_user_id = $1
        `,
      [linkData.prima789_user_id]
    )

    const data = memberData.rows[0] || { points: 0, tier: 'Bronze' }

    await replyMessage(replyToken, {
      type: 'text',
      text: `💎 คะแนนสะสม: ${(
        data.points || 0
      ).toLocaleString()} คะแนน\n🏆 ระดับสมาชิก: ${data.tier}`,
    })
  } catch (error) {
    console.error('Error checking points:', error)
    await replyMessage(replyToken, {
      type: 'text',
      text: '❌ เกิดข้อผิดพลาดในการดึงข้อมูลคะแนน',
    })
  }
}

async function handleTransactionHistory(userId, replyToken, linkData) {
  try {
    const transactions = await NeonDB.query(
      `
            SELECT * FROM transactions 
            WHERE prima789_user_id = $1 
            ORDER BY transaction_date DESC 
            LIMIT 5
        `,
      [linkData.prima789_user_id]
    )

    if (transactions.rows.length === 0) {
      await replyMessage(replyToken, {
        type: 'text',
        text: '📊 ยังไม่มีประวัติธุรกรรม',
      })
      return
    }

    let message = '📊 ประวัติธุรกรรม 5 รายการล่าสุด:\n\n'

    transactions.rows.forEach((tx, index) => {
      const emoji = tx.transaction_type === 'deposit' ? '💰' : '💸'
      const date = new Date(tx.transaction_date).toLocaleDateString('th-TH')
      message += `${index + 1}. ${emoji} ${
        tx.transaction_type === 'deposit' ? 'ฝาก' : 'ถอน'
      }: ${(tx.amount || 0).toLocaleString()} บาท\n`
      message += `   วันที่: ${date}\n\n`
    })

    await replyMessage(replyToken, {
      type: 'text',
      text: message,
    })
  } catch (error) {
    console.error('Error getting transaction history:', error)
    await replyMessage(replyToken, {
      type: 'text',
      text: '❌ เกิดข้อผิดพลาดในการดึงประวัติธุรกรรม',
    })
  }
}

async function handleFollow(userId, replyToken) {
  console.log(`New follower: ${userId}`)

  await replyMessage(replyToken, {
    type: 'text',
    text: '🎉 ยินดีต้อนรับสู่ Prima789!\n\nกรุณาเข้าสู่ระบบที่หน้าเว็บ Prima789 เพื่อเชื่อมโยงบัญชี:\nhttps://prima789.com/member#/',
  })
}

async function handleUnfollow(userId) {
  console.log(`User unfollowed: ${userId}`)
}

async function replyMessage(replyToken, message) {
  if (!replyToken) {
    console.error('No reply token provided')
    return
  }

  try {
    const response = await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        replyToken,
        messages: [message],
      }),
    })

    if (!response.ok) {
      throw new Error(`LINE API error: ${response.status}`)
    }

    console.log('Reply message sent successfully')
  } catch (error) {
    console.error('Error sending reply message:', error)
  }
}

function verifySignature(body, signature) {
  if (!process.env.LINE_CHANNEL_SECRET) {
    console.error('LINE_CHANNEL_SECRET not set')
    return false
  }

  const expectedSignature = crypto
    .createHmac('SHA256', process.env.LINE_CHANNEL_SECRET)
    .update(body)
    .digest('base64')

  return `sha256=${expectedSignature}` === signature
}
