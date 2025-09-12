const { Pool } = require('pg');

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
        const { lineUserId, syncMethod, username, displayName, searchType } = requestData;

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

        console.log(`🔍 Searching Prima789 account for LINE user: ${lineUserId}, method: ${syncMethod}`);

        let searchResult = null;

        // Different search strategies based on sync method
        if (syncMethod === 'manual' && username) {
            // Manual username search
            searchResult = await searchByUsername(username);
        } else if (syncMethod === 'auto' || searchType === 'auto') {
            // Auto search by display name or phone
            searchResult = await searchByDisplayName(displayName);
        } else {
            // Default search strategy
            searchResult = await searchByDisplayName(displayName);
        }

        if (searchResult) {
            console.log(`✅ Account found: ${searchResult.username}`);
            
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    success: true,
                    data: {
                        accountFound: true,
                        account: searchResult,
                        message: 'พบบัญชี Prima789 ที่ตรงกัน'
                    }
                })
            };
        } else {
            console.log(`❌ No account found for: ${displayName || username}`);
            
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    success: true,
                    data: {
                        accountFound: false,
                        account: null,
                        message: 'ไม่พบบัญชี Prima789 ที่ตรงกัน กรุณาลองวิธีการอื่น'
                    }
                })
            };
        }

    } catch (error) {
        console.error('Search account error:', error);
        
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                success: false,
                error: 'Internal server error',
                message: 'เกิดข้อผิดพลาดในการค้นหาบัญชี'
            })
        };
    }
};

async function searchByUsername(username) {
    try {
        const result = await pool.query(`
            SELECT 
                username,
                mm_user,
                first_name,
                last_name,
                available,
                credit_limit,
                bet_credit,
                tier,
                points,
                total_transactions,
                tel,
                email,
                bank_name,
                register_time,
                last_login,
                is_active
            FROM prima789_accounts 
            WHERE username ILIKE $1 
            AND is_active = TRUE
            LIMIT 1
        `, [`%${username}%`]);

        if (result.rows.length > 0) {
            return formatAccountData(result.rows[0]);
        }
        
        return null;
    } catch (error) {
        console.error('Username search error:', error);
        throw error;
    }
}

async function searchByDisplayName(displayName) {
    if (!displayName) return null;
    
    try {
        // Try exact match first
        let result = await pool.query(`
            SELECT 
                username,
                mm_user,
                first_name,
                last_name,
                available,
                credit_limit,
                bet_credit,
                tier,
                points,
                total_transactions,
                tel,
                email,
                bank_name,
                register_time,
                last_login,
                is_active
            FROM prima789_accounts 
            WHERE (
                CONCAT(first_name, ' ', last_name) ILIKE $1 
                OR first_name ILIKE $1
                OR last_name ILIKE $1
            )
            AND is_active = TRUE
            ORDER BY last_login DESC
            LIMIT 1
        `, [displayName]);

        if (result.rows.length > 0) {
            return formatAccountData(result.rows[0]);
        }

        // Try fuzzy search
        const nameParts = displayName.split(' ').filter(part => part.length > 1);
        
        if (nameParts.length > 0) {
            const searchPattern = nameParts.map(part => `%${part}%`).join(' ');
            
            result = await pool.query(`
                SELECT 
                    username,
                    mm_user,
                    first_name,
                    last_name,
                    available,
                    credit_limit,
                    bet_credit,
                    tier,
                    points,
                    total_transactions,
                    tel,
                    email,
                    bank_name,
                    register_time,
                    last_login,
                    is_active
                FROM prima789_accounts 
                WHERE (
                    first_name ILIKE ANY($1) 
                    OR last_name ILIKE ANY($1)
                )
                AND is_active = TRUE
                ORDER BY last_login DESC
                LIMIT 1
            `, [nameParts.map(part => `%${part}%`)]);

            if (result.rows.length > 0) {
                return formatAccountData(result.rows[0]);
            }
        }
        
        return null;
    } catch (error) {
        console.error('Display name search error:', error);
        throw error;
    }
}

function formatAccountData(accountRow) {
    return {
        username: accountRow.username,
        mm_user: accountRow.mm_user,
        first_name: accountRow.first_name,
        last_name: accountRow.last_name,
        display_name: accountRow.first_name && accountRow.last_name ? 
            `${accountRow.first_name} ${accountRow.last_name}` : 
            accountRow.first_name || accountRow.username,
        available: parseFloat(accountRow.available || 0),
        credit_limit: parseFloat(accountRow.credit_limit || 0),
        bet_credit: parseFloat(accountRow.bet_credit || 0),
        tier: accountRow.tier || 'Bronze',
        points: parseInt(accountRow.points || 0),
        total_transactions: parseInt(accountRow.total_transactions || 0),
        tel: accountRow.tel,
        email: accountRow.email,
        bank_name: accountRow.bank_name,
        register_time: accountRow.register_time,
        last_login: accountRow.last_login,
        is_active: accountRow.is_active
    };
}