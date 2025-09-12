const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool({
    connectionString: process.env.NETLIFY_DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

exports.handler = async (event, context) => {
    // Set CORS headers
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Content-Type': 'application/json'
    };

    // Handle preflight
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers,
            body: ''
        };
    }

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({
                success: false,
                error: 'Method not allowed'
            })
        };
    }

    try {
        const requestData = JSON.parse(event.body);
        const { lineUserId, userProfile } = requestData;

        if (!lineUserId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    success: false,
                    error: 'LINE User ID is required'
                })
            };
        }

        console.log(`🔌 Registering socket sync for LINE user: ${lineUserId}`);

        // Generate unique sync ID
        const syncId = generateSyncId();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        // Store sync session in database
        await pool.query(`
            INSERT INTO socket_sync_sessions (
                sync_id,
                line_user_id,
                status,
                expires_at,
                created_at
            ) VALUES ($1, $2, $3, $4, NOW())
            ON CONFLICT (sync_id) 
            DO UPDATE SET 
                line_user_id = EXCLUDED.line_user_id,
                status = EXCLUDED.status,
                expires_at = EXCLUDED.expires_at,
                created_at = NOW()
        `, [syncId, lineUserId, 'waiting', expiresAt]);

        // Update LINE user profile if provided
        if (userProfile) {
            await upsertLineUser(lineUserId, userProfile);
        }

        // Log sync registration
        await logSystemEvent('INFO', 'register-socket-sync', 
            `Socket sync registered for LINE user: ${lineUserId}`, 
            { syncId, expiresAt }, lineUserId);

        console.log(`✅ Socket sync registered with ID: ${syncId}`);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                data: {
                    syncId: syncId,
                    expiresAt: expiresAt.toISOString(),
                    instructions: {
                        th: 'กรุณาเข้าสู่ระบบ Prima789.com ในบราวเซอร์ ระบบจะเชื่อมโยงอัตโนมัติ',
                        en: 'Please login to Prima789.com in your browser. The system will link automatically.'
                    },
                    loginUrl: 'https://prima789.com/login'
                }
            })
        };

    } catch (error) {
        console.error('Register socket sync error:', error);
        
        await logSystemEvent('ERROR', 'register-socket-sync', 
            'Failed to register socket sync', 
            { error: error.message }, requestData?.lineUserId);

        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                success: false,
                error: 'Internal server error',
                message: 'ไม่สามารถเตรียมระบบ Socket Sync ได้'
            })
        };
    }
};

function generateSyncId() {
    const timestamp = Date.now().toString(36);
    const random = crypto.randomBytes(8).toString('hex');
    return `sync_${timestamp}_${random}`;
}

async function upsertLineUser(lineUserId, userProfile) {
    try {
        await pool.query(`
            INSERT INTO line_users (
                line_user_id,
                display_name,
                picture_url,
                status_message,
                language,
                updated_at
            ) VALUES ($1, $2, $3, $4, $5, NOW())
            ON CONFLICT (line_user_id) 
            DO UPDATE SET 
                display_name = EXCLUDED.display_name,
                picture_url = EXCLUDED.picture_url,
                status_message = EXCLUDED.status_message,
                language = EXCLUDED.language,
                updated_at = NOW()
        `, [
            lineUserId,
            userProfile.displayName,
            userProfile.pictureUrl,
            userProfile.statusMessage,
            userProfile.language || 'th'
        ]);

        console.log(`✅ LINE user profile updated: ${lineUserId}`);
    } catch (error) {
        console.error('Error updating LINE user profile:', error);
        // Don't throw - this is not critical for sync registration
    }
}

async function logSystemEvent(level, source, message, data, userId) {
    try {
        await pool.query(`
            INSERT INTO system_logs (level, source, message, data, user_id, created_at)
            VALUES ($1, $2, $3, $4, $5, NOW())
        `, [level, source, message, JSON.stringify(data), userId]);
    } catch (error) {
        console.error('Error logging system event:', error);
        // Don't throw - logging failures shouldn't break the main flow
    }
}