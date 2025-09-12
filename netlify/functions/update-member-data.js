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
        'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
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

    if (event.httpMethod !== 'POST' && event.httpMethod !== 'PUT') {
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
        const { lineUserId, updateType, data } = requestData;

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

        if (!updateType || !data) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    success: false,
                    error: 'Update type and data are required'
                })
            };
        }

        console.log(`🔄 Updating member data for LINE user: ${lineUserId}, type: ${updateType}`);

        let updateResult = null;

        switch (updateType) {
            case 'balance':
                updateResult = await updateBalance(lineUserId, data);
                break;
            
            case 'profile':
                updateResult = await updateProfile(lineUserId, data);
                break;
            
            case 'tier':
                updateResult = await updateTier(lineUserId, data);
                break;
            
            case 'points':
                updateResult = await updatePoints(lineUserId, data);
                break;
            
            case 'transaction_stats':
                updateResult = await updateTransactionStats(lineUserId, data);
                break;
            
            case 'full_sync':
                updateResult = await fullSync(lineUserId, data);
                break;
            
            default:
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        success: false,
                        error: `Unsupported update type: ${updateType}`
                    })
                };
        }

        if (updateResult.success) {
            // Log successful update
            await logSystemEvent('INFO', 'update-member-data', 
                `Member data updated: ${updateType}`, 
                { updateType, data }, lineUserId);

            console.log(`✅ Member data updated successfully: ${updateType}`);

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    success: true,
                    data: updateResult.data,
                    message: `อัปเดตข้อมูล ${updateType} สำเร็จ`
                })
            };
        } else {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    success: false,
                    error: updateResult.error,
                    message: `ไม่สามารถอัปเดตข้อมูล ${updateType} ได้`
                })
            };
        }

    } catch (error) {
        console.error('Update member data error:', error);
        
        await logSystemEvent('ERROR', 'update-member-data', 
            'Failed to update member data', 
            { error: error.message }, requestData?.lineUserId);

        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                success: false,
                error: 'Internal server error',
                message: 'เกิดข้อผิดพลาดในการอัปเดตข้อมูล'
            })
        };
    }
};

async function updateBalance(lineUserId, data) {
    try {
        const { available, credit_limit, bet_credit } = data;

        // Get linked account
        const accountResult = await pool.query(`
            SELECT p.username 
            FROM account_links al
            JOIN prima789_accounts p ON al.prima789_username = p.username
            WHERE al.line_user_id = $1 AND al.is_active = TRUE
            LIMIT 1
        `, [lineUserId]);

        if (accountResult.rows.length === 0) {
            return { success: false, error: 'Account not found or not linked' };
        }

        const username = accountResult.rows[0].username;

        // Update balance
        const updateResult = await pool.query(`
            UPDATE prima789_accounts 
            SET 
                available = COALESCE($2, available),
                credit_limit = COALESCE($3, credit_limit),
                bet_credit = COALESCE($4, bet_credit),
                updated_at = NOW()
            WHERE username = $1
            RETURNING available, credit_limit, bet_credit
        `, [username, available, credit_limit, bet_credit]);

        return {
            success: true,
            data: {
                username: username,
                available: parseFloat(updateResult.rows[0].available),
                credit_limit: parseFloat(updateResult.rows[0].credit_limit),
                bet_credit: parseFloat(updateResult.rows[0].bet_credit)
            }
        };

    } catch (error) {
        console.error('Error updating balance:', error);
        return { success: false, error: error.message };
    }
}

async function updateProfile(lineUserId, data) {
    try {
        const { first_name, last_name, tel, email, bank_name } = data;

        // Get linked account
        const accountResult = await pool.query(`
            SELECT p.username 
            FROM account_links al
            JOIN prima789_accounts p ON al.prima789_username = p.username
            WHERE al.line_user_id = $1 AND al.is_active = TRUE
            LIMIT 1
        `, [lineUserId]);

        if (accountResult.rows.length === 0) {
            return { success: false, error: 'Account not found or not linked' };
        }

        const username = accountResult.rows[0].username;

        // Update profile
        const updateResult = await pool.query(`
            UPDATE prima789_accounts 
            SET 
                first_name = COALESCE($2, first_name),
                last_name = COALESCE($3, last_name),
                tel = COALESCE($4, tel),
                email = COALESCE($5, email),
                bank_name = COALESCE($6, bank_name),
                updated_at = NOW()
            WHERE username = $1
            RETURNING first_name, last_name, tel, email, bank_name
        `, [username, first_name, last_name, tel, email, bank_name]);

        return {
            success: true,
            data: {
                username: username,
                first_name: updateResult.rows[0].first_name,
                last_name: updateResult.rows[0].last_name,
                tel: updateResult.rows[0].tel,
                email: updateResult.rows[0].email,
                bank_name: updateResult.rows[0].bank_name
            }
        };

    } catch (error) {
        console.error('Error updating profile:', error);
        return { success: false, error: error.message };
    }
}

async function updateTier(lineUserId, data) {
    try {
        const { tier } = data;

        if (!tier) {
            return { success: false, error: 'Tier is required' };
        }

        // Validate tier
        const validTiers = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond'];
        if (!validTiers.includes(tier)) {
            return { success: false, error: 'Invalid tier' };
        }

        // Get linked account
        const accountResult = await pool.query(`
            SELECT p.username 
            FROM account_links al
            JOIN prima789_accounts p ON al.prima789_username = p.username
            WHERE al.line_user_id = $1 AND al.is_active = TRUE
            LIMIT 1
        `, [lineUserId]);

        if (accountResult.rows.length === 0) {
            return { success: false, error: 'Account not found or not linked' };
        }

        const username = accountResult.rows[0].username;

        // Update tier
        const updateResult = await pool.query(`
            UPDATE prima789_accounts 
            SET 
                tier = $2,
                updated_at = NOW()
            WHERE username = $1
            RETURNING tier, points
        `, [username, tier]);

        return {
            success: true,
            data: {
                username: username,
                tier: updateResult.rows[0].tier,
                points: parseInt(updateResult.rows[0].points)
            }
        };

    } catch (error) {
        console.error('Error updating tier:', error);
        return { success: false, error: error.message };
    }
}

async function updatePoints(lineUserId, data) {
    try {
        const { points, operation = 'set' } = data; // 'set', 'add', 'subtract'

        if (points === undefined || points === null) {
            return { success: false, error: 'Points value is required' };
        }

        // Get linked account
        const accountResult = await pool.query(`
            SELECT p.username, p.points 
            FROM account_links al
            JOIN prima789_accounts p ON al.prima789_username = p.username
            WHERE al.line_user_id = $1 AND al.is_active = TRUE
            LIMIT 1
        `, [lineUserId]);

        if (accountResult.rows.length === 0) {
            return { success: false, error: 'Account not found or not linked' };
        }

        const username = accountResult.rows[0].username;
        const currentPoints = parseInt(accountResult.rows[0].points) || 0;
        let newPoints;

        switch (operation) {
            case 'add':
                newPoints = currentPoints + parseInt(points);
                break;
            case 'subtract':
                newPoints = Math.max(0, currentPoints - parseInt(points));
                break;
            case 'set':
            default:
                newPoints = parseInt(points);
                break;
        }

        // Update points
        const updateResult = await pool.query(`
            UPDATE prima789_accounts 
            SET 
                points = $2,
                updated_at = NOW()
            WHERE username = $1
            RETURNING points, tier
        `, [username, newPoints]);

        return {
            success: true,
            data: {
                username: username,
                points: parseInt(updateResult.rows[0].points),
                tier: updateResult.rows[0].tier,
                operation: operation,
                previousPoints: currentPoints
            }
        };

    } catch (error) {
        console.error('Error updating points:', error);
        return { success: false, error: error.message };
    }
}

async function updateTransactionStats(lineUserId, data) {
    try {
        const { total_transactions } = data;

        // Get linked account
        const accountResult = await pool.query(`
            SELECT p.username 
            FROM account_links al
            JOIN prima789_accounts p ON al.prima789_username = p.username
            WHERE al.line_user_id = $1 AND al.is_active = TRUE
            LIMIT 1
        `, [lineUserId]);

        if (accountResult.rows.length === 0) {
            return { success: false, error: 'Account not found or not linked' };
        }

        const username = accountResult.rows[0].username;

        // Update transaction stats
        const updateResult = await pool.query(`
            UPDATE prima789_accounts 
            SET 
                total_transactions = COALESCE($2, total_transactions),
                updated_at = NOW()
            WHERE username = $1
            RETURNING total_transactions
        `, [username, total_transactions]);

        return {
            success: true,
            data: {
                username: username,
                total_transactions: parseInt(updateResult.rows[0].total_transactions)
            }
        };

    } catch (error) {
        console.error('Error updating transaction stats:', error);
        return { success: false, error: error.message };
    }
}

async function fullSync(lineUserId, data) {
    try {
        // Get linked account
        const accountResult = await pool.query(`
            SELECT p.username 
            FROM account_links al
            JOIN prima789_accounts p ON al.prima789_username = p.username
            WHERE al.line_user_id = $1 AND al.is_active = TRUE
            LIMIT 1
        `, [lineUserId]);

        if (accountResult.rows.length === 0) {
            return { success: false, error: 'Account not found or not linked' };
        }

        const username = accountResult.rows[0].username;

        // Full sync with all provided data
        const {
            available,
            credit_limit,
            bet_credit,
            tier,
            points,
            total_transactions,
            first_name,
            last_name,
            tel,
            email,
            bank_name,
            last_login
        } = data;

        const updateResult = await pool.query(`
            UPDATE prima789_accounts 
            SET 
                available = COALESCE($2, available),
                credit_limit = COALESCE($3, credit_limit),
                bet_credit = COALESCE($4, bet_credit),
                tier = COALESCE($5, tier),
                points = COALESCE($6, points),
                total_transactions = COALESCE($7, total_transactions),
                first_name = COALESCE($8, first_name),
                last_name = COALESCE($9, last_name),
                tel = COALESCE($10, tel),
                email = COALESCE($11, email),
                bank_name = COALESCE($12, bank_name),
                last_login = COALESCE($13, last_login),
                updated_at = NOW()
            WHERE username = $1
            RETURNING *
        `, [
            username,
            available,
            credit_limit,
            bet_credit,
            tier,
            points,
            total_transactions,
            first_name,
            last_name,
            tel,
            email,
            bank_name,
            last_login
        ]);

        return {
            success: true,
            data: formatAccountData(updateResult.rows[0])
        };

    } catch (error) {
        console.error('Error in full sync:', error);
        return { success: false, error: error.message };
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
        is_active: accountRow.is_active,
        updated_at: accountRow.updated_at
    };
}

async function logSystemEvent(level, source, message, data, userId) {
    try {
        await pool.query(`
            INSERT INTO system_logs (level, source, message, data, user_id, created_at)
            VALUES ($1, $2, $3, $4, $5, NOW())
        `, [level, source, message, JSON.stringify(data), userId]);
    } catch (error) {
        console.error('Error logging system event:', error);
    }
}