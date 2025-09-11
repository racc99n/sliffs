/**
 * Rich Menu Image Generator
 * สร้างรูป Rich Menu ขนาด 2500x1686 pixels สำหรับ LINE Bot
 */

const { createCanvas, registerFont } = require('canvas')
const fs = require('fs')

function createRichMenuImage() {
  console.log('🖼️ Creating Rich Menu Image...')

  const width = 2500
  const height = 1686
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')

  // Background gradient
  const gradient = ctx.createLinearGradient(0, 0, width, height)
  gradient.addColorStop(0, '#667eea')
  gradient.addColorStop(1, '#764ba2')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)

  // Grid lines (dividing into 4 sections)
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 8
  ctx.beginPath()

  // Vertical line
  ctx.moveTo(width / 2, 0)
  ctx.lineTo(width / 2, height)

  // Horizontal line
  ctx.moveTo(0, height / 2)
  ctx.lineTo(width, height / 2)

  ctx.stroke()

  // Text style
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // Section 1: Top Left - Member Card (0,0 to 1250,843)
  const section1X = 625 // center of section
  const section1Y = 421 // center of section

  // Icon
  ctx.font = 'bold 200px Arial'
  ctx.fillText('💳', section1X, section1Y - 100)

  // Text
  ctx.font = 'bold 120px Arial'
  ctx.fillText('บัตรสมาชิก', section1X, section1Y + 100)

  ctx.font = 'bold 80px Arial'
  ctx.fillStyle = '#f0f0f0'
  ctx.fillText('Member Card', section1X, section1Y + 200)

  // Section 2: Top Right - Refresh (1250,0 to 2500,843)
  const section2X = 1875 // center of section
  const section2Y = 421 // center of section

  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 200px Arial'
  ctx.fillText('🔄', section2X, section2Y - 100)

  ctx.font = 'bold 120px Arial'
  ctx.fillText('รีเฟรชข้อมูล', section2X, section2Y + 100)

  ctx.font = 'bold 80px Arial'
  ctx.fillStyle = '#f0f0f0'
  ctx.fillText('Refresh Data', section2X, section2Y + 200)

  // Section 3: Bottom Left - Login (0,843 to 1250,1686)
  const section3X = 625 // center of section
  const section3Y = 1264 // center of section

  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 200px Arial'
  ctx.fillText('🌐', section3X, section3Y - 100)

  ctx.font = 'bold 120px Arial'
  ctx.fillText('เข้าสู่ระบบ', section3X, section3Y + 100)

  ctx.font = 'bold 80px Arial'
  ctx.fillStyle = '#f0f0f0'
  ctx.fillText('Login Prima789', section3X, section3Y + 200)

  // Section 4: Bottom Right - Help (1250,843 to 2500,1686)
  const section4X = 1875 // center of section
  const section4Y = 1264 // center of section

  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 200px Arial'
  ctx.fillText('❓', section4X, section4Y - 100)

  ctx.font = 'bold 120px Arial'
  ctx.fillText('ช่วยเหลือ', section4X, section4Y + 100)

  ctx.font = 'bold 80px Arial'
  ctx.fillStyle = '#f0f0f0'
  ctx.fillText('Help & Support', section4X, section4Y + 200)

  // Add Prima789 branding
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)'
  ctx.font = 'bold 60px Arial'
  ctx.textAlign = 'center'
  ctx.fillText('🎰 PRIMA789 MEMBER CARD', width / 2, 100)

  // Add subtle borders for better visual separation
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)'
  ctx.lineWidth = 4
  ctx.strokeRect(20, 20, width - 40, height - 40)

  // Save image
  const buffer = canvas.toBuffer('image/png')
  fs.writeFileSync('rich-menu.png', buffer)

  console.log('✅ Rich Menu image created: rich-menu.png')
  console.log(`📏 Size: ${width}x${height} pixels`)
  console.log('📂 File saved as: rich-menu.png')

  return buffer
}

// เรียกใช้งาน
if (require.main === module) {
  try {
    createRichMenuImage()
    console.log('\n🎉 Rich Menu image generated successfully!')
    console.log('📝 Next steps:')
    console.log('   1. Check the generated rich-menu.png file')
    console.log('   2. Run: node rich-menu-setup-with-image.js')
  } catch (error) {
    console.error('❌ Error creating Rich Menu image:', error.message)

    if (error.message.includes('canvas')) {
      console.log('\n💡 Solution: Install canvas library')
      console.log('   npm install canvas')
    }
  }
}

module.exports = { createRichMenuImage }
