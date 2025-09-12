// ===== netlify/functions/utils/database.js =====
const { Pool } = require('pg');

// Single database connection pool instance
let pool = null;

// Initialize database connection
const initializeDatabase = () => {
    if (!pool) {
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
            max: 10,
            min: 2,
            idleTimeoutMillis: 30000,
            acquireTimeoutMillis: 10000
        });

        pool.on('error', (err) => {
            console.error('❌ Database pool error:', err);
        });

        console.log('✅ Database pool initialized');
    }
    return pool;
};

const getDatabase = () => initializeDatabase();

const executeQuery = async (query, params = []) => {
    const db = getDatabase();
    
    try {
        console.log('🔍 Executing query:', query.substring(0, 100) + '...');
        const result = await db.query(query, params);
        console.log('✅ Query success, rows:', result.rowCount);
        return result;
    } catch (error) {
        console.error('❌ Query error:', error);
        throw error;
    }
};

const upsertLineUser = async (lineUserId, profile = {}) => {
    const query = `
        INSERT INTO line_users (
            line_user_id, display_name, status_message, picture_url, 
            last_sync, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, NOW(), NOW(), NOW())
        ON CONFLICT (line_user_id) 
        DO UPDATE SET 
            display_name = EXCLUDED.display_name,
            status_message = EXCLUDED.status_message,
            picture_url = EXCLUDED.picture_url,
            last_sync = NOW(),
            updated_at = NOW()
        RETURNING *`;
    
    const values = [
        lineUserId,
        profile.displayName || null,
        profile.statusMessage || null,
        profile.pictureUrl || null
    ];
    
    const result = await executeQuery(query, values);
    console.log('✅ Line user upserted:', lineUserId);
    return result.rows[0];
};

const checkUserLinking = async (lineUserId) => {
    const query = `
        SELECT 
            al.linking_id,
            al.prima789_account_id,
            al.linked_at,
            al.is_active,
            pa.username,
            pa.email,
            pa.balance,
            pa.status as account_status
        FROM account_linking al
        JOIN prima789_accounts pa ON al.prima789_account_id = pa.account_id
        WHERE al.line_user_id = $1 AND al.is_active = true
        ORDER BY al.linked_at DESC
        LIMIT 1`;
    
    const result = await executeQuery(query, [lineUserId]);
    const isLinked = result.rows.length > 0;
    
    console.log(`Account linking status for ${lineUserId}: ${isLinked}`);
    return {
        isLinked,
        linkData: result.rows[0] || null
    };
};

const getUserBalance = async (lineUserId) => {
    const query = `
        SELECT pa.balance
        FROM account_linking al
        JOIN prima789_accounts pa ON al.prima789_account_id = pa.account_id
        WHERE al.line_user_id = $1 AND al.is_active = true AND pa.status = 'active'
        LIMIT 1`;
    
    const result = await executeQuery(query, [lineUserId]);
    const balance = result.rows.length > 0 ? result.rows[0].balance : 0;
    
    console.log(`Balance for ${lineUserId}: ${balance}`);
    return parseFloat(balance) || 0;
};

const getRecentTransactions = async (lineUserId, limit = 10) => {
    const query = `
        SELECT t.*, pa.username
        FROM transactions t
        JOIN prima789_accounts pa ON t.prima789_account_id = pa.account_id
        JOIN account_linking al ON pa.account_id = al.prima789_account_id
        WHERE al.line_user_id = $1 AND al.is_active = true
        ORDER BY t.processed_at DESC
        LIMIT $2`;
    
    const result = await executeQuery(query, [lineUserId, limit]);
    console.log(`Recent transactions for ${lineUserId}: ${result.rows.length} found`);
    return result.rows;
};

const logSystemEvent = async (eventType, lineUserId = null, data = {}, level = 'info') => {
    const query = `
        INSERT INTO system_logs (
            event_type, line_user_id, level, message, data, source, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
        RETURNING log_id`;
    
    const values = [
        eventType,
        lineUserId,
        level,
        data.message || null,
        JSON.stringify(data),
        data.source || 'system'
    ];
    
    try {
        const result = await executeQuery(query, values);
        return result.rows[0].log_id;
    } catch (error) {
        console.error('Warning: Failed to log system event:', error);
        return null;
    }
};

const checkDatabaseHealth = async () => {
    try {
        const result = await executeQuery('SELECT NOW() as current_time, version() as db_version');
        return {
            status: 'healthy',
            timestamp: result.rows[0].current_time,
            version: result.rows[0].db_version,
            poolSize: pool ? pool.totalCount : 0
        };
    } catch (error) {
        return {
            status: 'unhealthy',
            error: error.message
        };
    }
};

module.exports = {
    getDatabase,
    executeQuery,
    upsertLineUser,
    checkUserLinking,
    getUserBalance,
    getRecentTransactions,
    logSystemEvent,
    checkDatabaseHealth
};