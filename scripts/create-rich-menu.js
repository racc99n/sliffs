// scripts/create-rich-menu.js - สร้าง Rich Menu ผ่าน LINE API
const LINE_CHANNEL_ACCESS_TOKEN = 'YOUR_CHANNEL_ACCESS_TOKEN'

const richMenuData = {
  size: {
    width: 2500,
    height: 1686,
  },
  selected: true,
  name: 'Prima789 Member Menu',
  chatBarText: 'Prima789 Menu',
  areas: [
    {
      bounds: {
        x: 0,
        y: 0,
        width: 1250,
        height: 843,
      },
      action: {
        type: 'uri',
        uri: 'https://sliffs.netlify.app/liff-account-linking',
      },
    },
    {
      bounds: {
        x: 1250,
        y: 0,
        width: 1250,
        height: 843,
      },
      action: {
        type: 'uri',
        uri: 'https://sliffs.netlify.app/liff-member-card',
      },
    },
    {
      bounds: {
        x: 0,
        y: 843,
        width: 1250,
        height: 843,
      },
      action: {
        type: 'postback',
        data: 'action=check_balance',
      },
    },
    {
      bounds: {
        x: 1250,
        y: 843,
        width: 1250,
        height: 843,
      },
      action: {
        type: 'postback',
        data: 'action=transaction_history',
      },
    },
  ],
}

// ฟังก์ชันสร้าง Rich Menu
async function createRichMenu() {
  try {
    // 1. สร้าง Rich Menu
    const response = await fetch('https://api.line.me/v2/bot/richmenu', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(richMenuData),
    })

    const result = await response.json()
    console.log('Rich Menu Created:', result)

    const richMenuId = result.richMenuId

    // 2. Upload รูปภาพ Rich Menu (ต้องมีไฟล์ rica-menu.jpg)
    const imageForm = new FormData()
    const imageFile = new File(
      [
        /* image data */
      ],
      'rich-menu.jpg',
      { type: 'image/jpeg' }
    )
    imageForm.append('image', imageFile)

    await fetch(
      `https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
        },
        body: imageForm,
      }
    )

    console.log('Rich Menu Image Uploaded')

    // 3. Set เป็น Default Rich Menu
    await fetch(`https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
      },
    })

    console.log('Rich Menu Set as Default')

    return richMenuId
  } catch (error) {
    console.error('Error creating Rich Menu:', error)
  }
}

// Rich Menu Design Specification
const richMenuDesign = {
  size: '2500x1686 pixels',
  layout: '2x2 grid',
  areas: [
    {
      position: 'Top Left (0,0,1250,843)',
      label: 'เชื่อมโยงบัญชี',
      icon: '🔗',
      background: '#06C755',
      action: 'LIFF Account Linking',
    },
    {
      position: 'Top Right (1250,0,1250,843)',
      label: 'Member Card',
      icon: '💳',
      background: '#FFD700',
      action: 'LIFF Member Card',
    },
    {
      position: 'Bottom Left (0,843,1250,843)',
      label: 'เช็คยอดเงิน',
      icon: '💰',
      background: '#FF6B6B',
      action: 'Postback: check_balance',
    },
    {
      position: 'Bottom Right (1250,843,1250,843)',
      label: 'ประวัติธุรกรรม',
      icon: '📊',
      background: '#007bff',
      action: 'Postback: transaction_history',
    },
  ],
}

// Updated Webhook Handler สำหรับ Rich Menu Actions
// netlify/functions/webhook.js - Updated
import { NeonDB } from './utils/database.js'
import crypto from 'crypto'

export const handler = async (event, context) => {
  // Verify LINE signature
  const signature = event.headers['x-line-signature']
  const body = event.body

  if (!verifySignature(body, signature)) {
    return { statusCode: 401, body: 'Unauthorized' }
  }

  try {
    const data = JSON.parse(body)

    for (const ev of data.events) {
      await handleEvent(ev)
    }

    return { statusCode: 200, body: 'OK' }
  } catch (error) {
    console.error('Webhook error:', error)
    return { statusCode: 500, body: 'Internal Server Error' }
  }
}

async function handleEvent(event) {
  const { type, replyToken, source, postback, message } = event
  const userId = source.userId

  try {
    if (type === 'postback') {
      await handlePostback(userId, postback.data, replyToken)
    } else if (type === 'message' && message.type === 'text') {
      await handleTextMessage(userId, message.text, replyToken)
    } else if (type === 'follow') {
      await handleFollowEvent(userId, replyToken)
    }
  } catch (error) {
    console.error('Error handling event:', error)
  }
}

async function handlePostback(userId, data, replyToken) {
  const params = new URLSearchParams(data)
  const action = params.get('action')

  switch (action) {
    case 'check_balance':
      await handleCheckBalance(userId, replyToken)
      break
    case 'transaction_history':
      await handleTransactionHistory(userId, replyToken)
      break
    default:
      console.log('Unknown postback action:', action)
  }
}

async function handleCheckBalance(userId, replyToken) {
  try {
    // ตรวจสอบการเชื่อมโยง
    const linkData = await NeonDB.getLinkedAccount(userId)

    if (!linkData) {
      await replyMessage(replyToken, {
        type: 'text',
        text: '❌ ยังไม่ได้เชื่อมโยงบัญชี\nกรุณาเชื่อมโยงบัญชีก่อนใช้งาน',
      })
      return
    }

    // ดึงข้อมูลยอดเงินและคะแนน
    const memberData = await NeonDB.query(
      `
            SELECT * FROM member_data WHERE prima789_user_id = $1
        `,
      [linkData.prima789_user_id]
    )

    const data = memberData.rows[0] || { points: 0, tier: 'Bronze' }

    await replyMessage(replyToken, {
      type: 'flex',
      altText: 'ข้อมูลยอดเงินและคะแนน',
      contents: {
        type: 'bubble',
        header: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: '💰 ข้อมูลบัญชี',
              weight: 'bold',
              size: 'lg',
              color: '#06C755',
            },
          ],
        },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'box',
              layout: 'horizontal',
              contents: [
                {
                  type: 'text',
                  text: '💎 คะแนนสะสม',
                  flex: 1,
                },
                {
                  type: 'text',
                  text: `${data.points?.toLocaleString() || 0} คะแนน`,
                  flex: 1,
                  align: 'end',
                  weight: 'bold',
                },
              ],
            },
            {
              type: 'separator',
              margin: 'md',
            },
            {
              type: 'box',
              layout: 'horizontal',
              margin: 'md',
              contents: [
                {
                  type: 'text',
                  text: '🏆 ระดับสมาชิก',
                  flex: 1,
                },
                {
                  type: 'text',
                  text: data.tier || 'Bronze',
                  flex: 1,
                  align: 'end',
                  weight: 'bold',
                  color:
                    data.tier === 'Gold'
                      ? '#FFD700'
                      : data.tier === 'Silver'
                      ? '#C0C0C0'
                      : '#CD7F32',
                },
              ],
            },
          ],
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'button',
              action: {
                type: 'uri',
                label: 'ดูประวัติธุรกรรม',
                uri: `${process.env.NETLIFY_URL}/liff-transaction-history`,
              },
              style: 'primary',
              color: '#06C755',
            },
          ],
        },
      },
    })
  } catch (error) {
    console.error('Error checking balance:', error)
    await replyMessage(replyToken, {
      type: 'text',
      text: '❌ เกิดข้อผิดพลาดในการดึงข้อมูล',
    })
  }
}

async function handleTransactionHistory(userId, replyToken) {
  try {
    const linkData = await NeonDB.getLinkedAccount(userId)

    if (!linkData) {
      await replyMessage(replyToken, {
        type: 'text',
        text: '❌ ยังไม่ได้เชื่อมโยงบัญชี',
      })
      return
    }

    // ดึงธุรกรรมล่าสุด 5 รายการ
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

    const flexContents = {
      type: 'carousel',
      contents: transactions.rows.map((tx) => ({
        type: 'bubble',
        size: 'micro',
        header: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text:
                tx.transaction_type === 'deposit'
                  ? '💰 ฝาก'
                  : tx.transaction_type === 'withdraw'
                  ? '💸 ถอน'
                  : '🎯 อื่นๆ',
              weight: 'bold',
              color: tx.transaction_type === 'deposit' ? '#06C755' : '#FF6B6B',
            },
          ],
        },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: `${tx.amount?.toLocaleString()} บาท`,
              weight: 'bold',
              size: 'lg',
            },
            {
              type: 'text',
              text: new Date(tx.transaction_date).toLocaleDateString('th-TH'),
              size: 'sm',
              color: '#999999',
            },
          ],
        },
      })),
    }

    await replyMessage(replyToken, {
      type: 'flex',
      altText: 'ประวัติธุรกรรม',
      contents: flexContents,
    })
  } catch (error) {
    console.error('Error getting transaction history:', error)
    await replyMessage(replyToken, {
      type: 'text',
      text: '❌ เกิดข้อผิดพลาดในการดึงประวัติ',
    })
  }
}

async function handleFollowEvent(userId, replyToken) {
  await replyMessage(replyToken, {
    type: 'flex',
    altText: 'ยินดีต้อนรับสู่ Prima789',
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '🎉 ยินดีต้อนรับ',
            weight: 'bold',
            size: 'xl',
            color: '#06C755',
          },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: 'ขอบคุณที่เพิ่มเพื่อน Prima789',
            wrap: true,
          },
          {
            type: 'text',
            text: 'เชื่อมโยงบัญชีเพื่อใช้งาน Member Card',
            wrap: true,
            margin: 'md',
            size: 'sm',
            color: '#666666',
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'button',
            action: {
              type: 'uri',
              label: 'เชื่อมโยงบัญชี',
              uri: `${process.env.NETLIFY_URL}/liff-account-linking`,
            },
            style: 'primary',
            color: '#06C755',
          },
        ],
      },
    },
  })
}

async function replyMessage(replyToken, message) {
  await fetch('https://api.line.me/v2/bot/message/reply', {
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
}

function verifySignature(body, signature) {
  const expectedSignature = crypto
    .createHmac('SHA256', process.env.LINE_CHANNEL_SECRET)
    .update(body)
    .digest('base64')

  return `sha256=${expectedSignature}` === signature
}
