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

    if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
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
        let lineUserId, prima789Username, limit, offset, transactionType, dateFrom, dateTo;

        if (event.httpMethod === 'GET') {
            // Extract from query parameters
            const params = event.queryStringParameters || {};
            lineUserId = params.lineUserId;
            prima789Username = params.prima789Username;
            limit = parseInt(params.limit) || 10;
            offset = parseInt(params.offset) || 0;
            transactionType = params.type;
            dateFrom = params.dateFrom;
            dateTo = params.dateTo;
        } else {
            // Extract from POST body
            const requestData = JSON.parse(event.body);
            lineUserId = requestData.lineUserId;
            prima789Username = requestData.prima789Username;
            limit = parseInt(requestData.limit) || 10;
            offset = parseInt(requestData.offset) || 0;
            transactionType = requestData.type;
            dateFrom = requestData.dateFrom;
            dateTo = requestData.dateTo;
        }

        if (!lineUserId && !prima789Username) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    success: false,
                    error: 'Either LINE User ID or Prima789 username is required'
                })
            };
        }

        console.log(`📊 Getting transactions for: ${lineUserId || prima789Username}`);

        // Validate limit
        if (limit > 100) limit = 100;
        if (limit < 1) limit = 10;

        // Get account information first
        let accountInfo = null;
        if (lineUserId) {
            accountInfo = await getAccountByLineUserId(lineUserId);
        } else if (prima789Username) {
            accountInfo = await getAccountByUsername(prima789Username);
        }

        if (!accountInfo) {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({
                    success: false,
                    error: 'Account not found or not linked'
                })
            };
        }

        // Build query for transactions
        const transactions = await getTransactions({
            lineUserId: accountInfo.line_user_id,
            prima789Username: accountInfo.username,
            limit,
            offset,
            transactionType,
            dateFrom,
            dateTo
        });

        // Get total count for pagination
        const totalCount = await getTransactionsCount({
            lineUserId: accountInfo.line_user_id,
            prima789Username: accountInfo.username,
            transactionType,
            dateFrom,
            dateTo
        });

        console.log(`✅ Retrieved ${transactions.length} transactions`);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                data: {
                    transactions: transactions,
                    pagination: {
                        total: totalCount,
                        limit: limit,
                        offset: offset,
                        hasMore: offset + limit < totalCount
                    },
                    account: {
                        username: accountInfo.username,
                        display_name: accountInfo.display_name
                    }
                }
            })
        };

    } catch (error) {
        console.error('Get transactions error:', error);
        
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                success: false,
                error: 'Internal server error',
                message: 'ไม่สามารถดึงข้อมูลธุรกรรมได้'
            })
        };
    }
};

async function getAccountByLineUserId(lineUserId) {
    try {
        const result = await pool.query(`
            SELECT 
                p.username,
                p.first_name,
                p.last_name,
                p.available,
                p.tier,
                p.points,
                l.line_user_id,
                COALESCE(p.first_name || ' ' || p.last_name, p.first_name, p.username) as display_name
            FROM account_links al
            JOIN prima789_accounts p ON al.prima789_username = p.username
            JOIN line_users l ON al.line_user_id = l.line_user_id
            WHERE al.line_user_id = $1 
            AND al.is_active = TRUE
            AND p.is_active = TRUE
            LIMIT 1
        `, [lineUserId]);

        return result.rows.length > 0 ? result.rows[0] : null;
    } catch (error) {
        console.error('Error getting account by LINE user ID:', error);
        throw error;
    }
}

async function getAccountByUsername(username) {
    try {
        const result = await pool.query(`
            SELECT 
                p.username,
                p.first_name,
                p.last_name,
                p.available,
                p.tier,
                p.points,
                al.line_user_id,
                COALESCE(p.first_name || ' ' || p.last_name, p.first_name, p.username) as display_name
            FROM prima789_accounts p
            LEFT JOIN account_links al ON p.username = al.prima789_username AND al.is_active = TRUE
            WHERE p.username = $1 
            AND p.is_active = TRUE
            LIMIT 1
        `, [username]);

        return result.rows.length > 0 ? result.rows[0] : null;
    } catch (error) {
        console.error('Error getting account by username:', error);
        throw error;
    }
}

async function getTransactions({ lineUserId, prima789Username, limit, offset, transactionType, dateFrom, dateTo }) {
    try {
        let whereConditions = [];
        let queryParams = [];
        let paramIndex = 1;

        // Base conditions
        if (lineUserId) {
            whereConditions.push(`line_user_id = $${paramIndex++}`);
            queryParams.push(lineUserId);
        }
        
        if (prima789Username) {
            whereConditions.push(`prima789_username = $${paramIndex++}`);
            queryParams.push(prima789Username);
        }

        // Filter by transaction type
        if (transactionType) {
            whereConditions.push(`transaction_type = $${paramIndex++}`);
            queryParams.push(transactionType);
        }

        // Date range filters
        if (dateFrom) {
            whereConditions.push(`created_at >= $${paramIndex++}`);
            queryParams.push(dateFrom);
        }

        if (dateTo) {
            whereConditions.push(`created_at <= $${paramIndex++}`);
            queryParams.push(dateTo);
        }

        // Add limit and offset
        queryParams.push(limit, offset);

        const whereClause = whereConditions.length > 0 ? 
            `WHERE ${whereConditions.join(' AND ')}` : '';

        const query = `
            SELECT 
                transaction_id,
                line_user_id,
                prima789_username,
                transaction_type,
                amount,
                balance_before,
                balance_after,
                description,
                source,
                details,
                processed_at,
                created_at
            FROM transactions 
            ${whereClause}
            ORDER BY created_at DESC
            LIMIT $${paramIndex++} OFFSET $${paramIndex++}
        `;

        const result = await pool.query(query, queryParams);

        return result.rows.map(row => ({
            transaction_id: row.transaction_id,
            transaction_type: row.transaction_type,
            amount: parseFloat(row.amount || 0),
            balance_before: parseFloat(row.balance_before || 0),
            balance_after: parseFloat(row.balance_after || 0),
            description: row.description,
            source: row.source,
            details: row.details,
            timestamp: row.processed_at || row.created_at,
            created_at: row.created_at
        }));

    } catch (error) {
        console.error('Error getting transactions:', error);
        throw error;
    }
}

async function getTransactionsCount({ lineUserId, prima789Username, transactionType, dateFrom, dateTo }) {
    try {
        let whereConditions = [];
        let queryParams = [];
        let paramIndex = 1;

        // Base conditions
        if (lineUserId) {
            whereConditions.push(`line_user_id = $${paramIndex++}`);
            queryParams.push(lineUserId);
        }
        
        if (prima789Username) {
            whereConditions.push(`prima789_username = $${paramIndex++}`);
            queryParams.push(prima789Username);
        }

        // Filter by transaction type
        if (transactionType) {
            whereConditions.push(`transaction_type = $${paramIndex++}`);
            queryParams.push(transactionType);
        }

        // Date range filters
        if (dateFrom) {
            whereConditions.push(`created_at >= $${paramIndex++}`);
            queryParams.push(dateFrom);
        }

        if (dateTo) {
            whereConditions.push(`created_at <= $${paramIndex++}`);
            queryParams.push(dateTo);
        }

        const whereClause = whereConditions.length > 0 ? 
            `WHERE ${whereConditions.join(' AND ')}` : '';

        const query = `SELECT COUNT(*) FROM transactions ${whereClause}`;

        const result = await pool.query(query, queryParams);
        return parseInt(result.rows[0].count);

    } catch (error) {
        console.error('Error getting transactions count:', error);
        throw error;
    }
}