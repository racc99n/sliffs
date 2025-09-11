import crypto from 'crypto';
import pkg from 'pg';
const { Pool } = pkg;

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;

export const handler = async (event, context) => {
    try {
        console.log('Received LINE webhook event:', JSON.stringify(event, null, 2));

        // Verify LINE signature
        const signature = event.headers['x-line-signature'];
        const body = event.body;

        if (!verifySignature(body, signature)) {
            console.error('Invalid LINE signature');
            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'Invalid signature' })
            };
        }

        const data = JSON.parse(body);
        const { events } = data;

        if (!events || events.length === 0) {
            return {
                statusCode: 200,
                body: JSON.stringify({ message: 'No events to process' })
            };
        }

        // Process each event
        for (const lineEvent of events) {
            await processEvent(lineEvent);
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Events processed successfully' })
        };

    } catch (error) {
        console.error('Webhook error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Internal server error' })
        };
    }
};

// Verify LINE signature
function verifySignature(body, signature) {
    if (!signature || !LINE_CHANNEL_SECRET) {
        return false;
    }

    const expectedSignature = crypto
        .createHmac('SHA256', LINE_CHANNEL_SECRET)
        .update(body)
        .digest('base64');

    return `sha256=${expectedSignature}` === signature;
}

// Process LINE event
async function processEvent(event) {
    const { type, source, replyToken } = event;
    const userId = source.userId;

    console.log(`Processing event: ${type} from user: ${userId}`);

    try {
        switch (type) {
            case 'follow':
                await handleFollowEvent(userId, replyToken);
                break;

            case 'unfollow':
                await handleUnfollowEvent(userId);
                break;

            case 'message':
                await handleMessageEvent(event);
                break;

            case 'postback':
                await handlePostbackEvent(event);
                break;

            default:
                console.log(`Unhandled event type: ${type}`);
        }
    } catch (error) {
        console.error(`Error processing ${type} event:`, error);
    }
}

// Handle follow event
async function handleFollowEvent(userId, replyToken) {
    try {
        console.log(`User ${userId} followed the bot`);

        // ส่งข้อความต้อนรับ
        const welcomeMessage = {
            type: 'flex',
            altText: 'ยินดีต้อนรับสู่ Prima789 Member Card',
            contents: {
                type: 'bubble',
                header: {
                    type: 'box',
                    layout: 'vertical',
                    contents: [
                        {
                            type: 'text',
                            text: '🎰 ยินดีต้อนรับ',
                            weight: 'bold',
                            size: 'xl',
                            color: '#ffffff'
                        },
                        {
                            type: 'text',
                            text: 'Prima789 Member Card',
                            size: 'sm',
                            color: '#ffffff',
                            margin: 'sm'
                        }
                    ],
                    backgroundColor: '#FF6B6B',
                    paddingAll: '20px'
                },
                body: {
                    type: 'box',
                    layout: 'vertical',
                    contents: [
                        {
                            type: 'text',
                            text: 'เริ่มต้นใช้งานบัตรสมาชิกดิจิทัล',
                            wrap: true,
                            color: '#333333',
                            size: 'md',
                            margin: 'lg'
                        },
                        {
                            type: 'text',
                            text: '1. เชื่อมโยงบัญชีของคุณ\n2. ดูยอดเงินและคะแนนแบบ Real-time\n3. รับข้อมูลล่าสุดอัตโนมัติ',
                            wrap: true,
                            color: '#666666',
                            size: 'sm',
                            margin: 'lg'
                        }
                    ]
                },
                footer: {
                    type: 'box',
                    layout: 'vertical',
                    spacing: 'sm',
                    contents: [
                        {
                            type: 'button',
                            style: 'primary',
                            height: 'sm',
                            action: {
                                type: 'postback',
                                label: '🔗 เชื่อมโยงบัญชี',
                                data: 'action=link_account'
                            },
                            color: '#FF6B6B'
                        },
                        {
                            type: 'button',
                            style: 'secondary',
                            height: 'sm',
                            action: {
                                type: 'postback',
                                label: '💳 ดูบัตรสมาชิก',
                                data: 'action=view_card'
                            }
                        }
                    ],
                    flex: 0
                }
            }
        };

        await replyMessage(replyToken, [welcomeMessage]);

        // บันทึกใน database
        await saveUserActivity(userId, 'follow', { welcomeSent: true });

    } catch (error) {
        console.error('Follow event error:', error);
    }
}

// Handle unfollow event
async function handleUnfollowEvent(userId) {
    try {
        console.log(`User ${userId} unfollowed the bot`);
        
        // อัปเดตสถานะใน database
        await saveUserActivity(userId, 'unfollow', {});

    } catch (error) {
        console.error('Unfollow event error:', error);
    }
}

// Handle message event
async function handleMessageEvent(event) {
    const { message, source, replyToken } = event;
    const userId = source.userId;
    const messageText = message.text?.toLowerCase() || '';

    console.log(`Message from ${userId}: ${messageText}`);

    try {
        // ตอบกลับตามคำสั่งต่าง ๆ
        if (messageText.includes('บัตร') || messageText.includes('card')) {
            await sendMemberCardMenu(replyToken);
        } else if (messageText.includes('เชื่อม') || messageText.includes('link')) {
            await sendAccountLinkingMenu(replyToken);
        } else if (messageText.includes('ยอด') || messageText.includes('balance')) {
            await sendQuickBalance(userId, replyToken);
        } else if (messageText.includes('help') || messageText.includes('ช่วย')) {
            await sendHelpMenu(replyToken);
        } else {
            // Default response
            await sendDefaultResponse(replyToken);
        }

        // บันทึกการสนทนา
        await saveUserActivity(userId, 'message', { messageText });

    } catch (error) {
        console.error('Message event error:', error);
    }
}

// Handle postback event
async function handlePostbackEvent(event) {
    const { postback, source, replyToken } = event;
    const userId = source.userId;
    const data = postback.data;

    console.log(`Postback from ${userId}: ${data}`);

    try {
        const params = new URLSearchParams(data);
        const action = params.get('action');

        switch (action) {
            case 'link_account':
                await handleLinkAccount(userId, replyToken);
                break;

            case 'view_card':
                await handleViewCard(userId, replyToken);
                break;

            case 'refresh_data':
                await handleRefreshData(userId, replyToken);
                break;

            case 'help':
                await sendHelpMenu(replyToken);
                break;

            default:
                console.log(`Unhandled postback action: ${action}`);
        }

        // บันทึก postback activity
        await saveUserActivity(userId, 'postback', { action, data });

    } catch (error) {
        console.error('Postback event error:', error);
    }
}

// Send member card menu
async function sendMemberCardMenu(replyToken) {
    const message = {
        type: 'flex',
        altText: 'Prima789 Member Card Menu',
        contents: {
            type: 'bubble',
            body: {
                type: 'box',
                layout: 'vertical',
                contents: [
                    {
                        type: 'text',
                        text: '💳 บัตรสมาชิก Prima789',
                        weight: 'bold',
                        size: 'xl',
                        color: '#333333'
                    },
                    {
                        type: 'text',
                        text: 'เลือกการดำเนินการ',
                        size: 'sm',
                        color: '#666666',
                        margin: 'lg'
                    }
                ]
            },
            footer: {
                type: 'box',
                layout: 'vertical',
                spacing: 'sm',
                contents: [
                    {
                        type: 'button',
                        style: 'primary',
                        action: {
                            type: 'postback',
                            label: '👀 ดูบัตรสมาชิก',
                            data: 'action=view_card'
                        }
                    },
                    {
                        type: 'button',
                        style: 'secondary',
                        action: {
                            type: 'postback',
                            label: '🔄 รีเฟรชข้อมูล',
                            data: 'action=refresh_data'
                        }
                    }
                ]
            }
        }
    };

    await replyMessage(replyToken, [message]);
}

// Handle link account
async function handleLinkAccount(userId, replyToken) {
    const message = {
        type: 'flex',
        altText: 'เชื่อมโยงบัญชี Prima789',
        contents: {
            type: 'bubble',
            body: {
                type: 'box',
                layout: 'vertical',
                contents: [
                    {
                        type: 'text',
                        text: '🔗 เชื่อมโยงบัญชี',
                        weight: 'bold',
                        size: 'xl',
                        color: '#333333'
                    },
                    {
                        type: 'text',
                        text: 'เพื่อใช้งานบัตรสมาชิกดิจิทัล กรุณาเข้าสู่ระบบผ่านเว็บไซต์ Prima789.com',
                        wrap: true,
                        size: 'sm',
                        color: '#666666',
                        margin: 'lg'
                    },
                    {
                        type: 'text',
                        text: 'ระบบจะเชื่อมโยงบัญชี LINE ของคุณอัตโนมัติ',
                        wrap: true,
                        size: 'xs',
                        color: '#999999',
                        margin: 'md'
                    }
                ]
            },
            footer: {
                type: 'box',
                layout: 'vertical',
                spacing: 'sm',
                contents: [
                    {
                        type: 'button',
                        style: 'primary',
                        action: {
                            type: 'uri',
                            label: '🌐 ไปที่ Prima789.com',
                            uri: 'https://prima789.com/login'
                        }
                    }
                ]
            }
        }
    };

    await replyMessage(replyToken, [message]);
}

// Handle view card
async function handleViewCard(userId, replyToken) {
    try {
        // ตรวจสอบสถานะการเชื่อมโยง
        const linkStatus = await checkAccountLinking(userId);

        if (!linkStatus.isLinked) {
            await sendNotLinkedMessage(replyToken);
            return;
        }

        // ส่ง LIFF URL
        const message = {
            type: 'flex',
            altText: 'Prima789 Member Card',
            contents: {
                type: 'bubble',
                body: {
                    type: 'box',
                    layout: 'vertical',
                    contents: [
                        {
                            type: 'text',
                            text: '💳 บัตรสมาชิกของคุณ',
                            weight: 'bold',
                            size: 'xl',
                            color: '#333333'
                        },
                        {
                            type: 'text',
                            text: `ยอดเงิน: ฿${linkStatus.data?.balance?.toLocaleString() || '0'}`,
                            size: 'md',
                            color: '#4CAF50',
                            margin: 'lg',
                            weight: 'bold'
                        },
                        {
                            type: 'text',
                            text: `คะแนน: ${linkStatus.data?.points?.toLocaleString() || '0'} pts`,
                            size: 'sm',
                            color: '#FF9800',
                            margin: 'sm'
                        }
                    ]
                },
                footer: {
                    type: 'box',
                    layout: 'vertical',
                    spacing: 'sm',
                    contents: [
                        {
                            type: 'button',
                            style: 'primary',
                            action: {
                                type: 'uri',
                                label: '📱 เปิดบัตรสมาชิก',
                                uri: `https://liff.line.me/${process.env.LINE_LIFF_ID_MEMBER_CARD || 'YOUR_LIFF_ID'}`
                            }
                        }
                    ]
                }
            }
        };

        await replyMessage(replyToken, [message]);

    } catch (error) {
        console.error('View card error:', error);
        await sendErrorMessage(replyToken);
    }
}

// Handle refresh data
async function handleRefreshData(userId, replyToken) {
    try {
        // เรียก sync API
        const syncResult = await syncUserData(userId);

        if (syncResult.success) {
            const message = {
                type: 'text',
                text: `✅ อัปเดตข้อมูลสำเร็จ!\n\nยอดเงิน: ฿${syncResult.data?.balance?.toLocaleString() || '0'}\nคะแนน: ${syncResult.data?.points?.toLocaleString() || '0'} pts\nอัปเดตเมื่อ: ${new Date().toLocaleString('th-TH')}`
            };
            await replyMessage(replyToken, [message]);
        } else {
            await sendErrorMessage(replyToken);
        }

    } catch (error) {
        console.error('Refresh data error:', error);
        await sendErrorMessage(replyToken);
    }
}

// Send not linked message
async function sendNotLinkedMessage(replyToken) {
    const message = {
        type: 'text',
        text: '❌ บัญชีของคุณยังไม่ได้เชื่อมโยง\n\nกรุณาเข้าสู่ระบบผ่าน Prima789.com เพื่อเชื่อมโยงบัญชี LINE ของคุณ'
    };
    await replyMessage(replyToken, [message]);
}

// Send help menu
async function sendHelpMenu(replyToken) {
    const message = {
        type: 'text',
        text: '📋 คำสั่งที่ใช้ได้:\n\n💳 "บัตร" - ดูบัตรสมาชิก\n🔗 "เชื่อมโยง" - เชื่อมโยงบัญชี\n💰 "ยอด" - ดูยอดเงินด่วน\n❓ "help" - ดูคำสั่งทั้งหมด\n\nหรือใช้เมนูด้านล่างได้เลย'
    };
    await replyMessage(replyToken, [message]);
}

// Send default response
async function sendDefaultResponse(replyToken) {
    const message = {
        type: 'text',
        text: 'สวัสดีครับ! 👋\n\nพิมพ์ "help" เพื่อดูคำสั่งทั้งหมด\nหรือใช้เมนูด้านล่างได้เลย'
    };
    await replyMessage(replyToken, [message]);
}

// Send error message
async function sendErrorMessage(replyToken) {
    const message = {
        type: 'text',
        text: '❌ เกิดข้อผิดพลาด\n\nกรุณาลองใหม่อีกครั้ง หรือติดต่อเจ้าหน้าที่'
    };
    await replyMessage(replyToken, [message]);
}

// Send quick balance
async function sendQuickBalance(userId, replyToken) {
    try {
        const linkStatus = await checkAccountLinking(userId);

        if (!linkStatus.isLinked) {
            await sendNotLinkedMessage(replyToken);
            return;
        }

        const data = linkStatus.data;
        const message = {
            type: 'text',
            text: `💰 ยอดเงินคงเหลือ: ฿${data?.balance?.toLocaleString() || '0'}\n🎯 คะแนนสะสม: ${data?.points?.toLocaleString() || '0'} pts\n👑 ระดับ: ${data?.tier || 'Bronze'}\n\n⏰ อัปเดตล่าสุด: ${new Date().toLocaleString('th-TH')}`
        };
        await replyMessage(replyToken, [message]);

    } catch (error) {
        console.error('Quick balance error:', error);
        await sendErrorMessage(replyToken);
    }
}

// Reply message to LINE
async function replyMessage(replyToken, messages) {
    try {
        const response = await fetch('https://api.line.me/v2/bot/message/reply', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
            },
            body: JSON.stringify({
                replyToken,
                messages
            })
        });

        if (!response.ok) {
            const error = await response.text();
            console.error('LINE API error:', error);
        }

    } catch (error) {
        console.error('Reply message error:', error);
    }
}

// Helper functions
async function checkAccountLinking(userId) {
    try {
        const response = await fetch(`${process.env.NETLIFY_URL}/.netlify/functions/check-account-linking?lineUserId=${userId}`);
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Check linking error:', error);
        return { success: false, isLinked: false };
    }
}

async function syncUserData(userId) {
    try {
        const response = await fetch(`${process.env.NETLIFY_URL}/.netlify/functions/sync-user-data`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lineUserId: userId, forceSync: true })
        });
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Sync user data error:', error);
        return { success: false };
    }
}

async function saveUserActivity(userId, activityType, details) {
    try {
        const pool = new Pool({
            connectionString: process.env.NETLIFY_DATABASE_URL,
            ssl: { rejectUnauthorized: false }
        });

        const client = await pool.connect();
        
        await client.query(`
            INSERT INTO sync_logs (line_user_id, sync_type, status, details, created_at)
            VALUES ($1, $2, $3, $4, NOW())
        `, [userId, activityType, 'success', JSON.stringify(details)]);

        client.release();
        await pool.end();
        
    } catch (error) {
        console.error('Save activity error:', error);
    }
}