import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
    connectionString: process.env.NETLIFY_DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

export const handler = async (event, context) => {
    try {
        const headers = {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
        };

        if (event.httpMethod === 'OPTIONS') {
            return { statusCode: 200, headers, body: '' };
        }

        let requestData = {};
        if (event.httpMethod === 'GET') {
            requestData = event.queryStringParameters || {};
        } else if (event.httpMethod === 'POST') {
            try {
                requestData = JSON.parse(event.body || '{}');
            } catch (parseError) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ 
                        success: false, 
                        error: 'Invalid JSON in request body' 
                    })
                };
            }
        }

        const { username, lineUserId } = requestData;
        
        if (!username && !lineUserId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    success: false, 
                    error: 'Username or lineUserId is required' 
                })
            };
        }

        // Database query
        let query, params;
        if (lineUserId) {
            query = `
                SELECT la.*, md.points, md.tier, md.balance, md.updated_at
                FROM line_accounts la
                LEFT JOIN member_data md ON la.prima789_user_id = md.prima789_user_id
                WHERE la.line_user_id = $1 AND la.is_active = true
                ORDER BY la.linked_at DESC
                LIMIT 1;
            `;
            params = [lineUserId];
        } else {
            query = `
                SELECT la.*, md.points, md.tier, md.balance, md.updated_at
                FROM line_accounts la
                LEFT JOIN member_data md ON la.prima789_user_id = md.prima789_user_id
                WHERE la.prima789_user_id = $1 AND la.is_active = true
                ORDER BY la.linked_at DESC
                LIMIT 1;
            `;
            params = [username];
        }

        const client = await pool.connect();
        const result = await client.query(query, params);
        client.release();

        const isLinked = result.rows.length > 0;
        const linkData = result.rows[0] || null;

        // Format response data
        let responseData = null;
        if (linkData) {
            responseData = {
                prima789_user_id: linkData.prima789_user_id,
                line_user_id: linkData.line_user_id,
                display_name: linkData.display_name,
                phone_number: linkData.phone_number,
                points: linkData.points || 0,
                tier: linkData.tier || 'Bronze',
                balance: parseFloat(linkData.balance || 0),
                linked_at: linkData.linked_at,
                updated_at: linkData.updated_at,
                is_active: linkData.is_active
            };
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                isLinked,
                data: responseData,
                message: isLinked ? 'Account is linked' : 'Account not linked'
            })
        };

    } catch (error) {
        console.error('Error in check-username-linking:', error);
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({ 
                success: false, 
                error: 'Database error',
                details: error.message
            })
        };
    }
};
