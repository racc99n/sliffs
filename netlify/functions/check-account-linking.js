/**
 * Check Account Linking Function
 * Netlify Function: /.netlify/functions/check-account-linking
 *
 * ตรวจสอบสถานะการเชื่อมต่อบัญชี LINE กับ Prima789
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

    console.log('✅ Database initialized for check-account-linking')
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

// Check user linking status
async function checkUserLinking(lineUserId) {
  try {
    const query = `
            SELECT 
                lu.id as line_user_id,
                lu.line_user_id,
                lu.display_name,
                lu.picture_url,
                lu.is_linked,
                lu.prima789_username,
                al.id as link_id,
                al.link_method,
                al.linked_at,
                al.is_active as link_active,
                pa.id as account_id,
                pa.username,
                pa.mm_user,
                pa.first_name,
                pa.last_name,
                pa.acc_no,
                pa.bank_name,
                pa.available,
                pa.credit_limit,
                pa.bet_credit,
                pa.tier,
                pa.points,
                pa.last_login,
                pa.updated_at as account_updated
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
    console.error('❌ Error checking user linking:', error)
    throw error
  }
}

// Get linking statistics
async function getLinkingStats() {
  try {
    const query = `
            SELECT 
                COUNT(*) as total_users,
                COUNT(CASE WHEN is_linked = TRUE THEN 1 END) as linked_users,
                COUNT(CASE WHEN is_linked = FALSE THEN 1 END) as unlinked_users,
                COUNT(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as new_users_24h
            FROM line_users;
        `

    const result = await executeQuery(query)
    return result.rows[0]
  } catch (error) {
    console.error('❌ Error getting linking stats:', error)
    return null
  }
}

// Check if Prima789 username is available
async function checkPrima789Username(username) {
  try {
    const query = `
            SELECT 
                username,
                mm_user,
                first_name,
                last_name,
                is_active,
                EXISTS(SELECT 1 FROM account_links WHERE prima789_username = $1 AND is_active = TRUE) as is_linked
            FROM prima789_accounts 
            WHERE username = $1 OR mm_user = $1;
        `

    const result = await executeQuery(query, [username])

    if (result.rows.length === 0) {
      return { exists: false, available: true }
    }

    const account = result.rows[0]
    return {
      exists: true,
      available: !account.is_linked,
      account: account,
    }
  } catch (error) {
    console.error('❌ Error checking Prima789 username:', error)
    throw error
  }
}

// Main handler
exports.handler = async (event, context) => {
  console.log('🔍 Check Account Linking - Start')
  console.log('📊 Request info:', {
    method: event.httpMethod,
    query: event.queryStringParameters,
    bodyLength: event.body ? event.body.length : 0,
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
    let lineUserId = null
    let checkUsername = null
    let getStats = false

    // Parse request parameters
    if (event.httpMethod === 'GET') {
      const params = event.queryStringParameters || {}
      lineUserId = params.lineUserId || params.line_user_id
      checkUsername = params.checkUsername || params.username
      getStats = params.stats === 'true'
    } else if (event.httpMethod === 'POST') {
      if (!event.body) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'Request body required',
          }),
        }
      }

      const requestData = JSON.parse(event.body)
      lineUserId = requestData.lineUserId || requestData.line_user_id
      checkUsername = requestData.checkUsername || requestData.username
      getStats = requestData.getStats || requestData.stats
    }

    // Initialize database
    initializeDatabase()

    // Handle different request types
    if (getStats) {
      console.log('📊 Getting linking statistics')
      const stats = await getLinkingStats()

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          data: stats,
          timestamp: new Date().toISOString(),
        }),
      }
    }

    if (checkUsername) {
      console.log('🔍 Checking Prima789 username:', checkUsername)
      const usernameCheck = await checkPrima789Username(checkUsername)

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          username: checkUsername,
          data: usernameCheck,
          timestamp: new Date().toISOString(),
        }),
      }
    }

    if (lineUserId) {
      console.log('👤 Checking user linking:', lineUserId)
      const linkingData = await checkUserLinking(lineUserId)

      if (!linkingData) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            isLinked: false,
            lineUserId: lineUserId,
            message: 'User not found or not linked',
            data: null,
            timestamp: new Date().toISOString(),
          }),
        }
      }

      const isLinked = linkingData.is_linked && linkingData.link_active

      const responseData = {
        success: true,
        isLinked: isLinked,
        lineUserId: lineUserId,
        data: isLinked
          ? {
              // LINE user data
              displayName: linkingData.display_name,
              pictureUrl: linkingData.picture_url,

              // Prima789 account data
              username: linkingData.username,
              mm_user: linkingData.mm_user,
              fullName: `${linkingData.first_name || ''} ${
                linkingData.last_name || ''
              }`.trim(),
              firstName: linkingData.first_name,
              lastName: linkingData.last_name,
              accNo: linkingData.acc_no,
              bankName: linkingData.bank_name,
              available: parseFloat(linkingData.available) || 0,
              balance: parseFloat(linkingData.available) || 0,
              creditLimit: parseFloat(linkingData.credit_limit) || 0,
              betCredit: parseFloat(linkingData.bet_credit) || 0,
              tier: linkingData.tier || 'Bronze',
              points: parseInt(linkingData.points) || 0,

              // Link metadata
              linkMethod: linkingData.link_method,
              linkedAt: linkingData.linked_at,
              lastLogin: linkingData.last_login,
              lastUpdated: linkingData.account_updated,
            }
          : null,
        timestamp: new Date().toISOString(),
      }

      console.log('✅ User linking check completed:', {
        isLinked: isLinked,
        username: linkingData.username,
      })

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(responseData),
      }
    }

    // No specific request - return usage info
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Missing required parameter',
        message: 'Please provide lineUserId, checkUsername, or stats=true',
        usage: {
          check_linking: '?lineUserId=USER_ID',
          check_username: '?checkUsername=USERNAME',
          get_stats: '?stats=true',
        },
      }),
    }
  } catch (error) {
    console.error('❌ Check account linking error:', error)
    console.error('Stack trace:', error.stack)

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Internal server error',
        message: 'Failed to check account linking',
        timestamp: new Date().toISOString(),
      }),
    }
  }
}
