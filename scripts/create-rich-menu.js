// scripts/create-updated-rich-menu.js - Rich Menu สำหรับ Flow ใหม่
const LINE_CHANNEL_ACCESS_TOKEN = 'YOUR_CHANNEL_ACCESS_TOKEN'

// Rich Menu Configuration - Updated Flow
const richMenuData = {
  size: {
    width: 2500,
    height: 1686,
  },
  selected: true,
  name: 'Prima789 Member Menu V2',
  chatBarText: 'Prima789 เมนู',
  areas: [
    {
      // บนซ้าย: เข้าสู่ระบบ/สมัครสมาชิก -> ลิงก์ไปหน้าเว็บโดยตรง
      bounds: {
        x: 0,
        y: 0,
        width: 1250,
        height: 843,
      },
      action: {
        type: 'uri',
        uri: 'https://prima789.com/member#/',
      },
    },
    {
      // บนขวา: Member Card -> LIFF
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
      // ล่างซ้าย: เช็คยอดเงิน -> Postback
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
      // ล่างขวา: ประวัติธุรกรรม -> Postback
      bounds: {
        x: 1250,
        y: 843,
        width: 1250,
        height: 843,
      },
      action: {
        type: 'postback',
        data: 'action=transaction_history&limit=5',
      },
    },
  ],
}

// Rich Menu Design Specification V2
const richMenuDesignV2 = {
  size: '2500x1686 pixels',
  layout: '2x2 grid',
  areas: [
    {
      position: 'Top Left (0,0,1250,843)',
      label: 'เข้าสู่ระบบ/สมัครสมาชิก',
      icon: '🔐',
      background: '#06C755', // LINE Green
      action: 'Direct Link to https://prima789.com/member#/',
      description: 'เปิดหน้าเว็บ Prima789 ใน external browser',
    },
    {
      position: 'Top Right (1250,0,1250,843)',
      label: 'Member Card',
      icon: '💳',
      background: '#FFD700', // Gold
      action: 'LIFF Member Card',
      description: 'เปิด LIFF App แสดง Member Card',
    },
    {
      position: 'Bottom Left (0,843,1250,843)',
      label: 'เช็คยอดเงิน',
      icon: '💰',
      background: '#FF6B6B', // Red
      action: 'Postback: check_balance',
      description: 'แสดงยอดเงินและคะแนนสะสมผ่าน Bot Message',
    },
    {
      position: 'Bottom Right (1250,843,1250,843)',
      label: 'ประวัติธุรกรรม',
      icon: '📊',
      background: '#007bff', // Blue
      action: 'Postback: transaction_history',
      description: 'แสดงประวัติธุรกรรม 5 รายการล่าสุด',
    },
  ],
}

// ฟังก์ชันสร้าง Rich Menu แบบใหม่
async function createUpdatedRichMenu() {
  try {
    console.log('Creating updated Rich Menu...')

    // 1. ลบ Rich Menu เก่า (ถ้ามี)
    await deleteExistingRichMenus()

    // 2. สร้าง Rich Menu ใหม่
    const createResponse = await fetch('https://api.line.me/v2/bot/richmenu', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(richMenuData),
    })

    if (!createResponse.ok) {
      throw new Error(`Failed to create Rich Menu: ${createResponse.status}`)
    }

    const result = await createResponse.json()
    const richMenuId = result.richMenuId
    console.log('✅ Rich Menu Created:', richMenuId)

    // 3. Upload รูปภาพ Rich Menu
    // Note: ต้องมีไฟล์รูป rich-menu-v2.jpg ขนาด 2500x1686
    await uploadRichMenuImage(richMenuId)

    // 4. Set เป็น Default Rich Menu
    await setDefaultRichMenu(richMenuId)

    console.log('✅ Updated Rich Menu setup completed!')
    return richMenuId
  } catch (error) {
    console.error('❌ Error creating updated Rich Menu:', error)
    throw error
  }
}

async function deleteExistingRichMenus() {
  try {
    // Get list of existing Rich Menus
    const listResponse = await fetch(
      'https://api.line.me/v2/bot/richmenu/list',
      {
        headers: {
          Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
        },
      }
    )

    if (listResponse.ok) {
      const data = await listResponse.json()

      // Delete each existing Rich Menu
      for (const menu of data.richmenus) {
        await fetch(`https://api.line.me/v2/bot/richmenu/${menu.richMenuId}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
          },
        })
        console.log(`Deleted Rich Menu: ${menu.richMenuId}`)
      }
    }
  } catch (error) {
    console.log(
      'No existing Rich Menus to delete or error occurred:',
      error.message
    )
  }
}

async function uploadRichMenuImage(richMenuId) {
  // Note: ในการใช้งานจริง ต้องมีไฟล์รูป rich-menu-v2.jpg
  // ตัวอย่างการ upload (ต้องปรับให้เหมาะกับ environment)

  console.log(`📷 Please upload Rich Menu image for ID: ${richMenuId}`)
  console.log('Image specifications:')
  console.log('- Size: 2500x1686 pixels')
  console.log('- Format: JPEG')
  console.log('- Max file size: 1MB')
  console.log(
    `- Upload URL: https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`
  )

  // ตัวอย่าง code สำหรับ upload (ต้องมีไฟล์จริง)
  /*
    const formData = new FormData();
    const imageFile = new File([imageBuffer], 'rich-menu-v2.jpg', { type: 'image/jpeg' });
    formData.append('image', imageFile);

    const uploadResponse = await fetch(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
        },
        body: formData
    });

    if (!uploadResponse.ok) {
        throw new Error(`Failed to upload Rich Menu image: ${uploadResponse.status}`);
    }

    console.log('✅ Rich Menu image uploaded successfully');
    */
}

async function setDefaultRichMenu(richMenuId) {
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
    throw new Error(`Failed to set default Rich Menu: ${response.status}`)
  }

  console.log('✅ Rich Menu set as default for all users')
}

// Helper function สำหรับสร้างรูป Rich Menu programmatically
function generateRichMenuImageHTML() {
  return `
<!DOCTYPE html>
<html>
<head>
    <style>
        .richmenu {
            width: 2500px;
            height: 1686px;
            display: grid;
            grid-template-columns: 1fr 1fr;
            grid-template-rows: 1fr 1fr;
            font-family: 'Arial', sans-serif;
            font-weight: bold;
        }
        
        .area {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            color: white;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.5);
        }
        
        .area1 {
            background: linear-gradient(135deg, #06C755 0%, #00B900 100%);
        }
        
        .area2 {
            background: linear-gradient(135deg, #FFD700 0%, #FFA500 100%);
            color: #1a1a1a;
        }
        
        .area3 {
            background: linear-gradient(135deg, #FF6B6B 0%, #E55353 100%);
        }
        
        .area4 {
            background: linear-gradient(135deg, #007bff 0%, #0056b3 100%);
        }
        
        .icon {
            font-size: 120px;
            margin-bottom: 20px;
        }
        
        .label {
            font-size: 48px;
            text-align: center;
            line-height: 1.2;
        }
        
        .sublabel {
            font-size: 32px;
            margin-top: 10px;
            opacity: 0.8;
        }
    </style>
</head>
<body>
    <div class="richmenu">
        <div class="area area1">
            <div class="icon">🔐</div>
            <div class="label">เข้าสู่ระบบ<br>สมัครสมาชิก</div>
        </div>
        <div class="area area2">
            <div class="icon">💳</div>
            <div class="label">Member Card</div>
        </div>
        <div class="area area3">
            <div class="icon">💰</div>
            <div class="label">เช็คยอดเงิน</div>
        </div>
        <div class="area area4">
            <div class="icon">📊</div>
            <div class="label">ประวัติธุรกรรม</div>
        </div>
    </div>
</body>
</html>`
}

// Export functions
module.exports = {
  createUpdatedRichMenu,
  richMenuData,
  richMenuDesignV2,
  generateRichMenuImageHTML,
}
