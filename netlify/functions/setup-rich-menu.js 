/**
 * Setup Rich Menu for Prima789 LINE Bot
 * Run this script once to create the rich menu
 */

const LINE_CHANNEL_ACCESS_TOKEN = "YOUR_CHANNEL_ACCESS_TOKEN";

async function setupRichMenu() {
    try {
        console.log('Setting up Rich Menu for Prima789 LINE Bot...');

        // 1. Create Rich Menu
        const richMenuData = {
            size: {
                width: 2500,
                height: 1686
            },
            selected: false,
            name: "Prima789 Member Card Menu",
            chatBarText: "เมนู",
            areas: [
                {
                    bounds: {
                        x: 0,
                        y: 0,
                        width: 1250,
                        height: 843
                    },
                    action: {
                        type: "uri",
                        uri: `https://liff.line.me/${LINE_LIFF_ID_MEMBER_CARD}`
                    }
                },
                {
                    bounds: {
                        x: 1250,
                        y: 0,
                        width: 1250,
                        height: 843
                    },
                    action: {
                        type: "postback",
                        data: "action=refresh_data"
                    }
                },
                {
                    bounds: {
                        x: 0,
                        y: 843,
                        width: 1250,
                        height: 843
                    },
                    action: {
                        type: "uri",
                        uri: "https://prima789.com/login"
                    }
                },
                {
                    bounds: {
                        x: 1250,
                        y: 843,
                        width: 1250,
                        height: 843
                    },
                    action: {
                        type: "postback",
                        data: "action=help"
                    }
                }
            ]
        };

        // Create rich menu
        const createResponse = await fetch('https://api.line.me/v2/bot/richmenu', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
            },
            body: JSON.stringify(richMenuData)
        });

        if (!createResponse.ok) {
            throw new Error(`Failed to create rich menu: ${await createResponse.text()}`);
        }

        const { richMenuId } = await createResponse.json();
        console.log('Rich Menu created:', richMenuId);

        // 2. Upload Rich Menu Image
        // Note: คุณต้องมีไฟล์รูปภาพ rich-menu.png ขนาด 2500x1686px
        const imageBuffer = await createRichMenuImage();
        
        const uploadResponse = await fetch(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, {
            method: 'POST',
            headers: {
                'Content-Type': 'image/png',
                'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
            },
            body: imageBuffer
        });

        if (!uploadResponse.ok) {
            throw new Error(`Failed to upload image: ${await uploadResponse.text()}`);
        }

        console.log('Rich Menu image uploaded successfully');

        // 3. Set as default rich menu
        const setDefaultResponse = await fetch(`https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
            }
        });

        if (!setDefaultResponse.ok) {
            throw new Error(`Failed to set default: ${await setDefaultResponse.text()}`);
        }

        console.log('Rich Menu set as default successfully');
        console.log('Rich Menu ID:', richMenuId);

        return richMenuId;

    } catch (error) {
        console.error('Setup Rich Menu error:', error);
        throw error;
    }
}

// สร้างรูปภาพ Rich Menu (placeholder - ควรใช้รูปจริง)
async function createRichMenuImage() {
    // In real implementation, you should create a proper 2500x1686px image
    // For now, returning a placeholder
    
    const canvas = createCanvas(2500, 1686);
    const ctx = canvas.getContext('2d');
    
    // Background
    ctx.fillStyle = '#667eea';
    ctx.fillRect(0, 0, 2500, 1686);
    
    // Grid lines
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(1250, 0);
    ctx.lineTo(1250, 1686);
    ctx.moveTo(0, 843);
    ctx.lineTo(2500, 843);
    ctx.stroke();
    
    // Text labels
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 120px Arial';
    ctx.textAlign = 'center';
    
    // Top left: Member Card
    ctx.fillText('💳', 625, 300);
    ctx.font = 'bold 80px Arial';
    ctx.fillText('บัตรสมาชิก', 625, 500);
    
    // Top right: Refresh
    ctx.font = 'bold 120px Arial';
    ctx.fillText('🔄', 1875, 300);
    ctx.font = 'bold 80px Arial';
    ctx.fillText('รีเฟรช', 1875, 500);
    
    // Bottom left: Login
    ctx.font = 'bold 120px Arial';
    ctx.fillText('🌐', 625, 1150);
    ctx.font = 'bold 80px Arial';
    ctx.fillText('เข้าสู่ระบบ', 625, 1350);
    
    // Bottom right: Help
    ctx.font = 'bold 120px Arial';
    ctx.fillText('❓', 1875, 1150);
    ctx.font = 'bold 80px Arial';
    ctx.fillText('ช่วยเหลือ', 1875, 1350);
    
    return canvas.toBuffer('image/png');
}

// สำหรับ Node.js environment
function createCanvas(width, height) {
    // This is a placeholder - in real implementation use node-canvas or similar
    return {
        getContext: () => ({
            fillStyle: '',
            strokeStyle: '',
            lineWidth: 0,
            font: '',
            textAlign: '',
            fillRect: () => {},
            beginPath: () => {},
            moveTo: () => {},
            lineTo: () => {},
            stroke: () => {},
            fillText: () => {}
        }),
        toBuffer: () => Buffer.from('placeholder-image-data')
    };
}

// Run setup
if (require.main === module) {
    setupRichMenu()
        .then(richMenuId => {
            console.log('Setup completed successfully!');
            console.log('Rich Menu ID:', richMenuId);
        })
        .catch(error => {
            console.error('Setup failed:', error);
            process.exit(1);
        });
}

module.exports = { setupRichMenu };