const { Pool } = require('pg')

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN

exports.handler = async (event, context) => {
  console.log('🎨 Setup Rich Menu - Start')

  // Handle CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      },
      body: '',
    }
  }

  try {
    const { action } = event.queryStringParameters || {}

    switch (action) {
      case 'create':
        return await createRichMenu()
      case 'list':
        return await listRichMenus()
      case 'delete':
        const { richMenuId } = event.queryStringParameters || {}
        return await deleteRichMenu(richMenuId)
      case 'set-default':
        const { menuId } = event.queryStringParameters || {}
        return await setDefaultRichMenu(menuId)
      default:
        return await createRichMenu()
    }
  } catch (error) {
    console.error('❌ Rich Menu setup error:', error)
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: 'Failed to setup Rich Menu',
        details: error.message,
      }),
    }
  }
}

// Create Rich Menu
async function createRichMenu() {
  try {
    console.log('🎨 Creating Rich Menu for Prima789...')

    // Rich Menu configuration
    const richMenuData = {
      size: {
        width: 2500,
        height: 1686,
      },
      selected: false,
      name: 'Prima789 Member Card Menu',
      chatBarText: 'เมนู',
      areas: [
        {
          bounds: {
            x: 0,
            y: 0,
            width: 833,
            height: 843,
          },
          action: {
            type: 'postback',
            data: 'action=open_member_card',
          },
        },
        {
          bounds: {
            x: 833,
            y: 0,
            width: 833,
            height: 843,
          },
          action: {
            type: 'postback',
            data: 'action=check_balance',
          },
        },
        {
          bounds: {
            x: 1666,
            y: 0,
            width: 834,
            height: 843,
          },
          action: {
            type: 'postback',
            data: 'action=account_linking',
          },
        },
        {
          bounds: {
            x: 0,
            y: 843,
            width: 833,
            height: 843,
          },
          action: {
            type: 'postback',
            data: 'action=view_history',
          },
        },
        {
          bounds: {
            x: 833,
            y: 843,
            width: 833,
            height: 843,
          },
          action: {
            type: 'postback',
            data: 'action=promotions',
          },
        },
        {
          bounds: {
            x: 1666,
            y: 843,
            width: 834,
            height: 843,
          },
          action: {
            type: 'postback',
            data: 'action=contact_support',
          },
        },
      ],
    }

    // Create Rich Menu
    const createResponse = await fetch('https://api.line.me/v2/bot/richmenu', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify(richMenuData),
    })

    if (!createResponse.ok) {
      const error = await createResponse.text()
      throw new Error(`Failed to create Rich Menu: ${error}`)
    }

    const richMenuResult = await createResponse.json()
    const richMenuId = richMenuResult.richMenuId

    console.log(`✅ Rich Menu created with ID: ${richMenuId}`)

    // Upload Rich Menu image
    const imageUrl = await uploadRichMenuImage(richMenuId)

    // Set as default Rich Menu
    await setDefaultRichMenu(richMenuId)

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        message: 'Rich Menu created successfully',
        data: {
          richMenuId: richMenuId,
          imageUrl: imageUrl,
          isDefault: true,
        },
      }),
    }
  } catch (error) {
    console.error('❌ Error creating Rich Menu:', error)
    throw error
  }
}

// Upload Rich Menu image
async function uploadRichMenuImage(richMenuId) {
  try {
    console.log(`🖼️ Uploading Rich Menu image for: ${richMenuId}`)

    // Generate Rich Menu image (you can replace this with actual image upload)
    const imageBuffer = await generateRichMenuImage()

    const uploadResponse = await fetch(
      `https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'image/png',
          Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
        },
        body: imageBuffer,
      }
    )

    if (!uploadResponse.ok) {
      const error = await uploadResponse.text()
      throw new Error(`Failed to upload Rich Menu image: ${error}`)
    }

    console.log('✅ Rich Menu image uploaded successfully')
    return `Rich Menu image uploaded for ${richMenuId}`
  } catch (error) {
    console.error('❌ Error uploading Rich Menu image:', error)
    throw error
  }
}

// Generate Rich Menu image (placeholder - you should create actual image)
async function generateRichMenuImage() {
  try {
    // This is a placeholder - in real implementation, you would:
    // 1. Create an actual 2500x1686 image with your design
    // 2. Use Canvas API or external image
    // 3. Return the image buffer

    console.log('🎨 Generating Rich Menu image...')

    // For now, return a simple placeholder
    // You should replace this with actual image creation or file upload
    const Canvas = require('canvas')
    const canvas = Canvas.createCanvas(2500, 1686)
    const ctx = canvas.getContext('2d')

    // Background
    ctx.fillStyle = '#1a1a2e'
    ctx.fillRect(0, 0, 2500, 1686)

    // Grid lines
    ctx.strokeStyle = '#333'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(833, 0)
    ctx.lineTo(833, 1686)
    ctx.moveTo(1666, 0)
    ctx.lineTo(1666, 1686)
    ctx.moveTo(0, 843)
    ctx.lineTo(2500, 843)
    ctx.stroke()

    // Menu items
    const menuItems = [
      { x: 416, y: 421, text: '💳\nMember Card' },
      { x: 1249, y: 421, text: '💰\nCheck Balance' },
      { x: 2083, y: 421, text: '🔗\nLink Account' },
      { x: 416, y: 1264, text: '📊\nHistory' },
      { x: 1249, y: 1264, text: '🎁\nPromotions' },
      { x: 2083, y: 1264, text: '📞\nSupport' },
    ]

    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 80px Arial'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    menuItems.forEach((item) => {
      const lines = item.text.split('\n')
      lines.forEach((line, index) => {
        ctx.fillText(line, item.x, item.y + index * 100)
      })
    })

    return canvas.toBuffer('image/png')
  } catch (error) {
    console.error('❌ Error generating Rich Menu image:', error)
    // Return empty buffer as fallback
    return Buffer.alloc(0)
  }
}

// List Rich Menus
async function listRichMenus() {
  try {
    const response = await fetch('https://api.line.me/v2/bot/richmenu/list', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
      },
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Failed to list Rich Menus: ${error}`)
    }

    const result = await response.json()

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        data: result.richmenus || [],
      }),
    }
  } catch (error) {
    console.error('❌ Error listing Rich Menus:', error)
    throw error
  }
}

// Delete Rich Menu
async function deleteRichMenu(richMenuId) {
  try {
    if (!richMenuId) {
      throw new Error('Rich Menu ID is required')
    }

    const response = await fetch(
      `https://api.line.me/v2/bot/richmenu/${richMenuId}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
        },
      }
    )

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Failed to delete Rich Menu: ${error}`)
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        message: `Rich Menu ${richMenuId} deleted successfully`,
      }),
    }
  } catch (error) {
    console.error('❌ Error deleting Rich Menu:', error)
    throw error
  }
}

// Set default Rich Menu
async function setDefaultRichMenu(richMenuId) {
  try {
    if (!richMenuId) {
      throw new Error('Rich Menu ID is required')
    }

    const response = await fetch(
      `https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
        },
      }
    )

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Failed to set default Rich Menu: ${error}`)
    }

    console.log(`✅ Rich Menu ${richMenuId} set as default`)

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        message: `Rich Menu ${richMenuId} set as default`,
      }),
    }
  } catch (error) {
    console.error('❌ Error setting default Rich Menu:', error)
    throw error
  }
}
