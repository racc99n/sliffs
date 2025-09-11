/**
 * Setup Rich Menu with Real Image for Prima789 LINE Bot
 * วิธีใช้: node rich-menu-setup-with-image.js
 */

const fs = require('fs')
const { createRichMenuImage } = require('./rich-menu-image-generator')

const LINE_CHANNEL_ACCESS_TOKEN =
  'QvDn0J5R9vwGDhLg33EB8b6TuULZP7oUF+29oRsjio3ZZHXDuEuzgHqbqp33z0xsrVQDtkMrHCWcFRLvrd9cVjMTUvVSCrLESKqe/vg59DJDpGoVq6NEzY9+mygvaQOjPBTwc12vErmLL49NKE4wUQdB04t89/1O/w1cDnyilFU=' // ใส่ token ที่ได้จาก LINE Developers
const LIFF_ID_MEMBER_CARD = '2008090006-ZV6r9v5J' // ใส่ LIFF ID ที่ได้จากการสร้าง LIFF App

async function setupRichMenuWithImage() {
  try {
    console.log('🎯 Setting up Rich Menu for Prima789 LINE Bot...')

    // 1. Create or check Rich Menu image
    let imageBuffer
    if (fs.existsSync('rich-menu.png')) {
      console.log('📷 Found existing rich-menu.png')
      imageBuffer = fs.readFileSync('rich-menu.png')
    } else {
      console.log('🖼️ Creating new Rich Menu image...')
      imageBuffer = createRichMenuImage()
    }

    // 2. Create Rich Menu Structure
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
            width: 1250,
            height: 843,
          },
          action: {
            type: 'uri',
            uri: `https://liff.line.me/${LIFF_ID_MEMBER_CARD}`,
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
            type: 'postback',
            data: 'action=refresh_data',
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
            type: 'uri',
            uri: 'https://prima789.com/login',
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
            data: 'action=help',
          },
        },
      ],
    }

    // 3. Create Rich Menu
    console.log('📋 Creating Rich Menu...')
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
      throw new Error(`Failed to create rich menu: ${error}`)
    }

    const { richMenuId } = await createResponse.json()
    console.log('✅ Rich Menu created:', richMenuId)

    // 4. Upload Rich Menu Image
    console.log('🖼️ Uploading Rich Menu Image...')
    console.log(`📏 Image size: ${imageBuffer.length} bytes`)

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
      console.error('Upload error response:', error)
      throw new Error(`Failed to upload image: ${error}`)
    }

    console.log('✅ Rich Menu image uploaded successfully')

    // 5. Set as Default Rich Menu
    console.log('⚙️ Setting as default Rich Menu...')
    const setDefaultResponse = await fetch(
      `https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
        },
      }
    )

    if (!setDefaultResponse.ok) {
      const error = await setDefaultResponse.text()
      throw new Error(`Failed to set default: ${error}`)
    }

    console.log('✅ Rich Menu set as default')
    console.log('\n🎉 Rich Menu Setup Complete!')
    console.log(`📝 Rich Menu ID: ${richMenuId}`)
    console.log('\n📱 Menu Actions:')
    console.log('   💳 บัตรสมาชิก (บนซ้าย): เปิด LIFF Member Card')
    console.log('   🔄 รีเฟรชข้อมูล (บนขวา): อัปเดตข้อมูลล่าสุด')
    console.log('   🌐 เข้าสู่ระบบ (ล่างซ้าย): ไปยัง Prima789.com')
    console.log('   ❓ ช่วยเหลือ (ล่างขวา): แสดงคำสั่งช่วยเหลือ')

    // 6. Test Rich Menu
    console.log('\n🧪 Testing Rich Menu...')
    const listResponse = await fetch(
      'https://api.line.me/v2/bot/richmenu/list',
      {
        headers: {
          Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
        },
      }
    )

    if (listResponse.ok) {
      const richMenus = await listResponse.json()
      console.log(`✅ Total Rich Menus: ${richMenus.richmenus.length}`)

      const currentMenu = richMenus.richmenus.find(
        (menu) => menu.richMenuId === richMenuId
      )
      if (currentMenu) {
        console.log('✅ Current Rich Menu confirmed')
      }
    }

    return richMenuId
  } catch (error) {
    console.error('❌ Setup Rich Menu error:', error.message)

    // Additional debugging info
    if (error.message.includes('upload')) {
      console.log('\n🔍 Debug Info:')
      console.log('   - Check if rich-menu.png exists and is valid')
      console.log('   - Image must be exactly 2500x1686 pixels')
      console.log('   - File size should be < 1MB')
      console.log('   - Format must be PNG')

      if (fs.existsSync('rich-menu.png')) {
        const stats = fs.statSync('rich-menu.png')
        console.log(`   - Current file size: ${stats.size} bytes`)
      }
    }

    throw error
  }
}

// Helper function to validate image
function validateImage() {
  if (!fs.existsSync('rich-menu.png')) {
    console.log('❌ rich-menu.png not found')
    return false
  }

  const stats = fs.statSync('rich-menu.png')
  console.log(`📏 File size: ${stats.size} bytes`)

  if (stats.size > 3024 * 3024) {
    // 1MB
    console.log('⚠️ Warning: File size > 1MB, might be too large')
  }

  return true
}

// Check if script is run directly
if (require.main === module) {
  if (LINE_CHANNEL_ACCESS_TOKEN === 'YOUR_CHANNEL_ACCESS_TOKEN') {
    console.error('❌ Error: Please set LINE_CHANNEL_ACCESS_TOKEN')
    console.log(
      '   Get it from: LINE Developers Console → Your Channel → Messaging API'
    )
    process.exit(1)
  }

  if (LIFF_ID_MEMBER_CARD === 'YOUR_LIFF_ID') {
    console.error('❌ Error: Please set LIFF_ID_MEMBER_CARD')
    console.log('   Get it from: LINE Developers Console → Your Channel → LIFF')
    process.exit(1)
  }

  // Validate image before proceeding
  console.log('🔍 Validating Rich Menu image...')
  validateImage()

  setupRichMenuWithImage()
    .then((richMenuId) => {
      console.log('\n🎉 Setup completed successfully!')
      console.log(`Rich Menu ID: ${richMenuId}`)
      console.log('\n📱 Test your LINE Bot now!')
      console.log('   1. Add your bot as friend')
      console.log('   2. Check if Rich Menu appears at bottom')
      console.log('   3. Test each menu button')
    })
    .catch((error) => {
      console.error('\n❌ Setup failed:', error.message)
      process.exit(1)
    })
}

module.exports = { setupRichMenuWithImage }
