import pkg from 'pg';
const { Pool } = pkg;

// CORS Headers
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};

export const handler = async (event, context) => {
    // Handle CORS
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: ''
        };
    }

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: false,
                message: 'Method not allowed'
            })
        };
    }

    try {
        const body = JSON.parse(event.body || '{}');
        const { lineUserId, prima789UserId, forceSync = false } = body;

        // Validate input
        if (!lineUserId && !prima789UserId) {
            return {
                statusCode: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: false,
                    message: 'lineUserId or prima789UserId is required'
                })
            };
        }

        // Database connection
        const pool = new Pool({
            connectionString: process.env.NETLIFY_DATABASE_URL,
            ssl: { rejectUnauthorized: false }
        });

        const client = await pool.connect();

        try {
            let accountRecord = null;

            // หา account record
            if (lineUserId) {
                const query = `
                    SELECT * FROM line_accounts 
                    WHERE line_user_id = $1 AND status = 'active'
                    ORDER BY linked_at DESC LIMIT 1
                `;
                const result = await client.query(query, [lineUserId]);
                accountRecord = result.rows[0];
            } else if (prima789UserId) {
                const query = `
                    SELECT * FROM line_accounts 
                    WHERE prima789_user_id = $1 AND status = 'active'
                    ORDER BY linked_at DESC LIMIT 1
                `;
                const result = await client.query(query, [prima789UserId]);
                accountRecord = result.rows[0];
            }

            if (!accountRecord) {
                return {
                    statusCode: 404,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        success: false,
                        message: 'Account linking not found'
                    })
                };
            }

            // ตรวจสอบว่าต้อง sync หรือไม่
            const lastSync = accountRecord.last_sync_at;
            const now = new Date();
            const syncInterval = 5 * 60 * 1000; // 5 minutes

            if (!forceSync && lastSync) {
                const timeSinceLastSync = now - new Date(lastSync);
                if (timeSinceLastSync < syncInterval) {
                    // ข้อมูลยังใหม่อยู่ ไม่ต้อง sync
                    const existingData = await client.query(`
                        SELECT * FROM prima789_data 
                        WHERE user_id = $1
                    `, [accountRecord.prima789_user_id]);

                    if (existingData.rows.length > 0) {
                        return {
                            statusCode: 200,
                            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                success: true,
                                cached: true,
                                data: existingData.rows[0],
                                message: 'Data is still fresh, using cached version'
                            })
                        };
                    }
                }
            }

            // ดึงข้อมูลจาก Prima789 (Simulation)
            // ในทางปฏิบัติจริง ควรมี API หรือ direct database connection ไปยัง Prima789
            const prima789Data = await fetchPrima789Data(accountRecord.prima789_username);

            if (!prima789Data.success) {
                // อัปเดต sync status เป็น failed
                await client.query(`
                    UPDATE line_accounts 
                    SET sync_status = 'failed', last_sync_at = NOW()
                    WHERE id = $1
                `, [accountRecord.id]);

                return {
                    statusCode: 500,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        success: false,
                        message: 'Failed to fetch data from Prima789',
                        error: prima789Data.error
                    })
                };
            }

            // อัปเดตข้อมูลในฐานข้อมูล
            const userData = prima789Data.data;

            // Upsert prima789_data
            const upsertQuery = `
                INSERT INTO prima789_data (
                    user_id, username, email, balance, points, tier,
                    total_deposits, total_withdrawals, games_played, 
                    last_login, created_at, updated_at
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW()
                )
                ON CONFLICT (user_id) 
                DO UPDATE SET
                    username = EXCLUDED.username,
                    email = EXCLUDED.email,
                    balance = EXCLUDED.balance,
                    points = EXCLUDED.points,
                    tier = EXCLUDED.tier,
                    total_deposits = EXCLUDED.total_deposits,
                    total_withdrawals = EXCLUDED.total_withdrawals,
                    games_played = EXCLUDED.games_played,
                    last_login = EXCLUDED.last_login,
                    updated_at = NOW()
                RETURNING *
            `;

            const upsertResult = await client.query(upsertQuery, [
                accountRecord.prima789_user_id,
                userData.username,
                userData.email,
                userData.balance,
                userData.points,
                userData.tier,
                userData.total_deposits || 0,
                userData.total_withdrawals || 0,
                userData.games_played || 0,
                userData.last_login,
                userData.created_at
            ]);

            // อัปเดต sync status
            await client.query(`
                UPDATE line_accounts 
                SET sync_status = 'success', last_sync_at = NOW()
                WHERE id = $1
            `, [accountRecord.id]);

            // Log sync activity
            await client.query(`
                INSERT INTO sync_logs (
                    line_user_id, prima789_user_id, sync_type, 
                    status, details, created_at
                ) VALUES ($1, $2, $3, $4, $5, NOW())
            `, [
                accountRecord.line_user_id,
                accountRecord.prima789_user_id,
                forceSync ? 'manual' : 'auto',
                'success',
                JSON.stringify({ userData })
            ]);

            return {
                statusCode: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: true,
                    cached: false,
                    data: upsertResult.rows[0],
                    syncedAt: now.toISOString(),
                    message: 'Data synced successfully'
                })
            };

        } finally {
            client.release();
            await pool.end();
        }

    } catch (error) {
        console.error('Sync user data error:', error);
        
        return {
            statusCode: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: false,
                error: 'Database error',
                message: 'Failed to sync user data',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            })
        };
    }
};

// Simulate fetching data from Prima789
async function fetchPrima789Data(username) {
    try {
        // TODO: Replace with actual Prima789 API call or database query
        // For now, we'll simulate with dummy data
        
        console.log('Fetching Prima789 data for username:', username);
        
        // Simulate API delay
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Simulate different user data based on username
        const mockUsers = {
            'demo_user': {
                username: 'demo_user',
                email: 'demo@example.com',
                balance: 15000,
                points: 250,
                tier: 'Gold',
                total_deposits: 50000,
                total_withdrawals: 35000,
                games_played: 150,
                last_login: new Date(),
                created_at: new Date('2024-01-15')
            },
            'test_user': {
                username: 'test_user',
                email: 'test@example.com',
                balance: 5000,
                points: 100,
                tier: 'Silver',
                total_deposits: 20000,
                total_withdrawals: 15000,
                games_played: 75,
                last_login: new Date(),
                created_at: new Date('2024-03-01')
            }
        };

        const userData = mockUsers[username] || {
            username: username,
            email: `${username}@prima789.com`,
            balance: Math.floor(Math.random() * 20000),
            points: Math.floor(Math.random() * 500),
            tier: ['Bronze', 'Silver', 'Gold', 'Platinum'][Math.floor(Math.random() * 4)],
            total_deposits: Math.floor(Math.random() * 100000),
            total_withdrawals: Math.floor(Math.random() * 80000),
            games_played: Math.floor(Math.random() * 200),
            last_login: new Date(),
            created_at: new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000) // Random date within past year
        };

        return {
            success: true,
            data: userData
        };

        /* 
        Real implementation example:
        
        const response = await fetch(`https://prima789.com/api/user/${username}`, {
            headers: {
                'Authorization': `Bearer ${process.env.PRIMA789_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Prima789 API error: ${response.status}`);
        }

        const data = await response.json();
        return {
            success: true,
            data: data
        };
        */

    } catch (error) {
        console.error('Prima789 data fetch error:', error);
        return {
            success: false,
            error: error.message
        };
    }
}