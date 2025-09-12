/**
 * Check Sync Status Function
 * Netlify Function: /.netlify/functions/check-sync-status
 *
 * ตรวจสอบสถานะการ sync ข้อมูลระหว่าง LINE และ Prima789
 */

const { Pool } = require('pg')

// Database configuration
let pool = null

function initializeDatabase() {
  if (pool) return pool

  try {
    const databaseUrl =
      process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL

    if (!databaseUrl) {
      throw new Error('Database URL not configured')
    }

    pool = new Pool({
      connectionString: databaseUrl,
      ssl: databaseUrl.includes('localhost')
        ? false
        : { rejectUnauthorized: false },
      max: 3,
      min: 1,
      idleTimeoutMillis: 30000,
    })

    console.log('✅ Database initialized for check-sync-status')
    return pool
  } catch (error) {
    console.error('❌ Database initialization failed:', error)
    throw error
  }
}

// Execute database query
async function executeQuery(query, params = []) {
  const client = initializeDatabase()

  try {
    console.log('🔍 Executing query:', query.substring(0, 100) + '...')
    const result = await client.query(query, params)
    console.log('✅ Query success, rows:', result.rowCount)
    return result
  } catch (error) {
    console.error('❌ Query error:', error)
    throw error
  }
}

// Get user sync status
async function getUserSyncStatus(lineUserId) {
  try {
    const query = `
            SELECT 
                -- LINE User Info
                lu.line_user_id,
                lu.display_name,
                lu.is_linked,
                lu.prima789_username,
                lu.created_at as line_user_created,
                lu.updated_at as line_user_updated,
                
                -- Account Link Info
                al.id as link_id,
                al.link_method,
                al.linked_at,
                al.is_active as link_active,
                al.updated_at as link_updated,
                
                -- Prima789 Account Info
                pa.id as account_id,
                pa.username as prima789_username,
                pa.available,
                pa.credit_limit,
                pa.bet_credit,
                pa.tier,
                pa.points,
                pa.last_login,
                pa.updated_at as account_updated,
                
                -- Recent Transaction Info
                (SELECT COUNT(*) 
                 FROM transactions t 
                 WHERE t.username = pa.username 
                 AND t.created_at > NOW() - INTERVAL '24 hours') as transactions_24h,
                 
                (SELECT MAX(created_at) 
                 FROM transactions t 
                 WHERE t.username = pa.username) as last_transaction_date,
                 
                -- Sync Health Indicators
                CASE 
                    WHEN pa.updated_at > NOW() - INTERVAL '5 minutes' THEN 'active'
                    WHEN pa.updated_at > NOW() - INTERVAL '1 hour' THEN 'recent'
                    WHEN pa.updated_at > NOW() - INTERVAL '24 hours' THEN 'stale'
                    ELSE 'inactive'
                END as sync_health,
                
                EXTRACT(EPOCH FROM (NOW() - pa.updated_at)) as seconds_since_update
                
            FROM line_users lu
            LEFT JOIN account_links al ON lu.line_user_id = al.line_user_id AND al.is_active = TRUE
            LEFT JOIN prima789_accounts pa ON al.prima789_username = pa.username
            WHERE lu.line_user_id = $1;
        `

    const result = await executeQuery(query, [lineUserId])

    if (result.rows.length === 0) {
      return null
    }

    return result.rows[0]
  } catch (error) {
    console.error('❌ Error getting user sync status:', error)
    throw error
  }
}

// Get overall sync statistics
async function getSyncStatistics() {
  try {
    const queries = [
      // User statistics
      `SELECT 
                COUNT(*) as total_users,
                COUNT(CASE WHEN is_linked = TRUE THEN 1 END) as linked_users,
                COUNT(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as new_users_24h
            FROM line_users`,

      // Account sync health
      `SELECT 
                COUNT(*) as total_accounts,
                COUNT(CASE WHEN updated_at > NOW() - INTERVAL '5 minutes' THEN 1 END) as active_accounts,
                COUNT(CASE WHEN updated_at > NOW() - INTERVAL '1 hour' THEN 1 END) as recent_accounts,
                COUNT(CASE WHEN updated_at > NOW() - INTERVAL '24 hours' THEN 1 END) as daily_active_accounts
            FROM prima789_accounts WHERE is_active = TRUE`,

      // Transaction activity
      `SELECT 
                COUNT(*) as total_transactions,
                COUNT(CASE WHEN created_at > NOW() - INTERVAL '1 hour' THEN 1 END) as transactions_1h,
                COUNT(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as transactions_24h,
                COUNT(DISTINCT username) as active_users_24h
            FROM transactions WHERE created_at > NOW() - INTERVAL '7 days'`,

      // System events
      `SELECT 
                COUNT(*) as total_events,
                COUNT(CASE WHEN level = 'ERROR' THEN 1 END) as error_events,
                COUNT(CASE WHEN created_at > NOW() - INTERVAL '1 hour' THEN 1 END) as events_1h
            FROM system_logs WHERE created_at > NOW() - INTERVAL '24 hours'`,
    ]

    const results = await Promise.all(
      queries.map((query) => executeQuery(query))
    )

    return {
      users: results[0].rows[0],
      accounts: results[1].rows[0],
      transactions: results[2].rows[0],
      system: results[3].rows[0],
    }
  } catch (error) {
    console.error('❌ Error getting sync statistics:', error)
    throw error
  }
}

// Get recent sync activities
async function getRecentSyncActivity(limit = 10) {
  try {
    const query = `
            SELECT 
                'transaction' as activity_type,
                t.transaction_type,
                t.username,
                t.amount,
                t.created_at,
                t.details,
                lu.display_name,
                NULL as link_method
            FROM transactions t
            LEFT JOIN account_links al ON t.username = al.prima789_username
            LEFT JOIN line_users lu ON al.line_user_id = lu.line_user_id
            WHERE t.created_at > NOW() - INTERVAL '24 hours'
            
            UNION ALL
            
            SELECT 
                'account_link' as activity_type,
                'account_linked' as transaction_type,
                al.prima789_username as username,
                0 as amount,
                al.linked_at as created_at,
                json_build_object('method', al.link_method) as details,
                lu.display_name,
                al.link_method
            FROM account_links al
            LEFT JOIN line_users lu ON al.line_user_id = lu.line_user_id
            WHERE al.linked_at > NOW() - INTERVAL '24 hours'
            AND al.is_active = TRUE
            
            ORDER BY created_at DESC
            LIMIT $1;
        `

    const result = await executeQuery(query, [limit])
    return result.rows
  } catch (error) {
    console.error('❌ Error getting recent sync activity:', error)
    throw error
  }
}

// Get sync issues/errors
async function getSyncIssues(limit = 20) {
  try {
    const query = `
            SELECT 
                level,
                source,
                message,
                details,
                created_at
            FROM system_logs 
            WHERE level IN ('ERROR', 'WARN')
            AND created_at > NOW() - INTERVAL '24 hours'
            ORDER BY created_at DESC
            LIMIT $1;
        `

    const result = await executeQuery(query, [limit])
    return result.rows
  } catch (error) {
    console.error('❌ Error getting sync issues:', error)
    throw error
  }
}

// Analyze sync performance
async function analyzeSyncPerformance() {
  try {
    const query = `
            WITH sync_metrics AS (
                SELECT 
                    pa.username,
                    pa.updated_at as last_sync,
                    COUNT(t.id) as transaction_count,
                    MAX(t.created_at) as last_transaction,
                    EXTRACT(EPOCH FROM (NOW() - pa.updated_at)) as sync_age_seconds
                FROM prima789_accounts pa
                LEFT JOIN transactions t ON pa.username = t.username 
                    AND t.created_at > NOW() - INTERVAL '24 hours'
                WHERE pa.is_active = TRUE
                GROUP BY pa.username, pa.updated_at
            )
            SELECT 
                COUNT(*) as total_accounts,
                AVG(sync_age_seconds) as avg_sync_age_seconds,
                COUNT(CASE WHEN sync_age_seconds < 300 THEN 1 END) as accounts_synced_5min,
                COUNT(CASE WHEN sync_age_seconds < 3600 THEN 1 END) as accounts_synced_1hour,
                COUNT(CASE WHEN sync_age_seconds >= 86400 THEN 1 END) as accounts_stale_24h,
                SUM(transaction_count) as total_transactions_24h,
                AVG(transaction_count) as avg_transactions_per_account
            FROM sync_metrics;
        `

    const result = await executeQuery(query)
    return result.rows[0]
  } catch (error) {
    console.error('❌ Error analyzing sync performance:', error)
    throw error
  }
}

// Main handler
exports.handler = async (event, context) => {
  console.log('📊 Check Sync Status - Start')
  console.log('📊 Request info:', {
    method: event.httpMethod,
    query: event.queryStringParameters,
  })

  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json',
  }

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' }
  }

  try {
    // Parse request parameters
    const params = event.queryStringParameters || {}
    const lineUserId = params.lineUserId || params.line_user_id
    const getStats = params.stats === 'true'
    const getActivity = params.activity === 'true'
    const getIssues = params.issues === 'true'
    const getPerformance = params.performance === 'true'
    const getOverall = params.overall === 'true'

    // Initialize database
    initializeDatabase()

    // Handle specific user sync status
    if (lineUserId) {
      console.log('👤 Checking sync status for user:', lineUserId)

      const userStatus = await getUserSyncStatus(lineUserId)

      if (!userStatus) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'User not found',
            message: 'LINE user not found in database',
            lineUserId: lineUserId,
          }),
        }
      }

      const isLinked = userStatus.is_linked && userStatus.link_active

      const responseData = {
        success: true,
        lineUserId: lineUserId,
        isLinked: isLinked,
        syncStatus: isLinked
          ? {
              health: userStatus.sync_health,
              lastSyncAge: Math.floor(userStatus.seconds_since_update || 0),
              lastSyncTime: userStatus.account_updated,
              lastTransactionTime: userStatus.last_transaction_date,
              transactions24h: parseInt(userStatus.transactions_24h) || 0,

              account: {
                username: userStatus.prima789_username,
                balance: parseFloat(userStatus.available) || 0,
                tier: userStatus.tier,
                points: parseInt(userStatus.points) || 0,
                lastLogin: userStatus.last_login,
              },

              link: {
                method: userStatus.link_method,
                linkedAt: userStatus.linked_at,
                isActive: userStatus.link_active,
              },
            }
          : null,
        timestamp: new Date().toISOString(),
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(responseData),
      }
    }

    // Handle different types of status requests
    let responseData = {
      success: true,
      timestamp: new Date().toISOString(),
    }

    if (getStats || getOverall) {
      console.log('📊 Getting sync statistics')
      responseData.statistics = await getSyncStatistics()
    }

    if (getActivity || getOverall) {
      console.log('🔄 Getting recent sync activity')
      responseData.recentActivity = await getRecentSyncActivity(15)
    }

    if (getIssues || getOverall) {
      console.log('⚠️ Getting sync issues')
      responseData.issues = await getSyncIssues(10)
    }

    if (getPerformance || getOverall) {
      console.log('📈 Analyzing sync performance')
      responseData.performance = await analyzeSyncPerformance()
    }

    // If no specific request, provide basic stats
    if (
      !getStats &&
      !getActivity &&
      !getIssues &&
      !getPerformance &&
      !getOverall
    ) {
      console.log('📋 Getting basic sync status')
      responseData.statistics = await getSyncStatistics()
      responseData.performance = await analyzeSyncPerformance()
    }

    console.log('✅ Sync status check completed')

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(responseData),
    }
  } catch (error) {
    console.error('❌ Check sync status error:', error)
    console.error('Stack trace:', error.stack)

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Internal server error',
        message: 'Failed to check sync status',
        timestamp: new Date().toISOString(),
      }),
    }
  }
}
