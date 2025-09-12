/**
 * Link Prima789 Account Function
 * Netlify Function: /.netlify/functions/link-prima789-account
 *
 * เชื่อมต่อบัญชี LINE กับ Prima789
 */

const { Pool } = require('pg')
const crypto = require('crypto')

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
      max: 5,
      min: 1,
      idleTimeoutMillis: 30000,
    })

    console.log('✅ Database initialized for link-prima789-account')
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

// Execute transaction
async function executeTransaction(queries) {
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    const results = []
    for (const { query, params } of queries) {
      const result = await client.query(query, params)
      results.push(result)
    }

    await client.query('COMMIT')
    return results
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

// Search Prima789 account by credentials
async function searchPrima789Account(searchCriteria) {
  try {
    const { username, password, phone, displayName, autoDetect } =
      searchCriteria

    let whereClause = 'WHERE is_active = TRUE'
    let params = []
    let paramCount = 0

    if (username) {
      paramCount++
      whereClause += ` AND (username ILIKE $${paramCount} OR mm_user ILIKE $${paramCount})`
      params.push(username)
    }

    if (phone) {
      paramCount++
      whereClause += ` AND (tel = $${paramCount} OR acc_no = $${paramCount})`
      params.push(phone)
    }

    if (displayName && autoDetect) {
      paramCount++
      whereClause += ` AND (CONCAT(first_name, ' ', last_name) ILIKE $${paramCount} OR first_name ILIKE $${paramCount})`
      params.push(`%${displayName}%`)
    }

    const query = `
            SELECT 
                id,
                username,
                mm_user,
                first_name,
                last_name,
                acc_no,
                tel,
                email,
                bank_name,
                bank_id,
                available,
                credit_limit,
                bet_credit,
                tier,
                points,
                member_ref,
                register_time,
                last_login,
                created_at,
                updated_at,
                -- Check if already linked
                EXISTS(SELECT 1 FROM account_links WHERE prima789_username = username AND is_active = TRUE) as is_already_linked
            FROM prima789_accounts 
            ${whereClause}
            ORDER BY 
                CASE WHEN username = $1 THEN 1
                     WHEN mm_user = $1 THEN 2
                     ELSE 3 END,
                last_login DESC NULLS LAST,
                updated_at DESC
            LIMIT 10
        `

    // Add original username as first param for ordering
    const finalParams = username ? [username, ...params.slice()] : params
    const result = await executeQuery(query, finalParams)

    return result.rows
  } catch (error) {
    console.error('❌ Error searching Prima789 account:', error)
    throw error
  }
}

// Verify account credentials (simplified - in real scenario you'd check password hash)
async function verifyAccountCredentials(username, password) {
  try {
    // In a real scenario, you would verify the password hash
    // For now, we'll just check if the account exists and is active
    const query = `
            SELECT 
                id,
                username,
                mm_user,
                first_name,
                last_name,
                acc_no,
                tel,
                email,
                bank_name,
                available,
                credit_limit,
                bet_credit,
                tier,
                points,
                last_login,
                is_active
            FROM prima789_accounts 
            WHERE (username = $1 OR mm_user = $1) 
            AND is_active = TRUE
        `

    const result = await executeQuery(query, [username])

    if (result.rows.length === 0) {
      return { success: false, message: 'Account not found' }
    }

    const account = result.rows[0]

    // Check if already linked
    const linkQuery = `
            SELECT line_user_id 
            FROM account_links 
            WHERE prima789_username = $1 AND is_active = TRUE
        `

    const linkResult = await executeQuery(linkQuery, [account.username])

    if (linkResult.rows.length > 0) {
      return {
        success: false,
        message: 'Account is already linked to another LINE user',
        linkedToUser: linkResult.rows[0].line_user_id,
      }
    }

    return { success: true, account }
  } catch (error) {
    console.error('❌ Error verifying account credentials:', error)
    throw error
  }
}

// Create account link
async function createAccountLink(
  lineUserId,
  prima789Username,
  linkMethod = 'manual',
  userData = {}
) {
  try {
    const queries = [
      // Create or update account link
      {
        query: `
                    INSERT INTO account_links (
                        line_user_id, 
                        prima789_username, 
                        link_method, 
                        linked_at, 
                        is_active
                    ) VALUES ($1, $2, $3, CURRENT_TIMESTAMP, TRUE)
                    ON CONFLICT (line_user_id, prima789_username)
                    DO UPDATE SET
                        is_active = TRUE,
                        link_method = EXCLUDED.link_method,
                        linked_at = CURRENT_TIMESTAMP,
                        updated_at = CURRENT_TIMESTAMP
                    RETURNING *
                `,
        params: [lineUserId, prima789Username, linkMethod],
      },

      // Update LINE user as linked
      {
        query: `
                    UPDATE line_users 
                    SET 
                        is_linked = TRUE, 
                        prima789_username = $2,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE line_user_id = $1
                    RETURNING *
                `,
        params: [lineUserId, prima789Username],
      },

      // Log the linking event
      {
        query: `
                    INSERT INTO system_logs (
                        level, 
                        source, 
                        message, 
                        details, 
                        created_at
                    ) VALUES (
                        'INFO', 
                        'link-prima789-account', 
                        'Account successfully linked', 
                        $1, 
                        CURRENT_TIMESTAMP
                    )
                `,
        params: [
          JSON.stringify({
            line_user_id: lineUserId,
            prima789_username: prima789Username,
            link_method: linkMethod,
            user_data: userData,
          }),
        ],
      },
    ]

    const results = await executeTransaction(queries)

    const linkResult = results[0]
    const userResult = results[1]

    return {
      success: true,
      link: linkResult.rows[0],
      user: userResult.rows[0],
    }
  } catch (error) {
    console.error('❌ Error creating account link:', error)
    throw error
  }
}

// Upsert LINE user data
async function upsertLineUser(userData) {
  try {
    const query = `
            INSERT INTO line_users (
                line_user_id,
                display_name,
                picture_url,
                status_message,
                language,
                created_at,
                updated_at
            ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT (line_user_id) 
            DO UPDATE SET
                display_name = EXCLUDED.display_name,
                picture_url = EXCLUDED.picture_url,
                status_message = EXCLUDED.status_message,
                language = EXCLUDED.language,
                updated_at = CURRENT_TIMESTAMP
            RETURNING *
        `

    const params = [
      userData.userId,
      userData.displayName || null,
      userData.pictureUrl || null,
      userData.statusMessage || null,
      userData.language || 'th',
    ]

    const result = await executeQuery(query, params)
    return result.rows[0]
  } catch (error) {
    console.error('❌ Error upserting LINE user:', error)
    throw error
  }
}

// Main handler
exports.handler = async (event, context) => {
  console.log('🔗 Link Prima789 Account - Start')
  console.log('📊 Request info:', {
    method: event.httpMethod,
    bodyLength: event.body ? event.body.length : 0,
  })

  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  }

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' }
  }

  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Method not allowed',
        message: 'Only POST method is supported',
      }),
    }
  }

  try {
    // Parse request body
    if (!event.body) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Request body required',
          message: 'Please provide linking data in request body',
        }),
      }
    }

    const requestData = JSON.parse(event.body)
    console.log('📋 Linking request data:', {
      lineUserId: requestData.lineUserId,
      syncMethod: requestData.syncMethod,
      hasUsername: !!requestData.username,
      hasPassword: !!requestData.password,
    })

    // Validate required fields
    const { lineUserId, syncMethod } = requestData

    if (!lineUserId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Missing lineUserId',
          message: 'LINE User ID is required',
        }),
      }
    }

    if (!syncMethod || !['manual', 'auto'].includes(syncMethod)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Invalid syncMethod',
          message: 'syncMethod must be "manual" or "auto"',
        }),
      }
    }

    // Initialize database
    initializeDatabase()

    // Upsert LINE user data if provided
    if (requestData.userData) {
      await upsertLineUser(requestData.userData)
    }

    let accountFound = null
    let linkResult = null

    // Process based on sync method
    if (syncMethod === 'manual') {
      // Manual linking with username/password
      const { username, password } = requestData

      if (!username) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'Missing credentials',
            message: 'Username is required for manual linking',
          }),
        }
      }

      console.log('👤 Manual linking for user:', username)

      // Verify account credentials
      const verification = await verifyAccountCredentials(username, password)

      if (!verification.success) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            success: false,
            accountFound: false,
            error: 'Account verification failed',
            message: verification.message,
          }),
        }
      }

      accountFound = verification.account
    } else if (syncMethod === 'auto') {
      // Auto-detection based on user profile
      console.log('🔄 Auto-detection linking')

      const searchCriteria = {
        username: requestData.username,
        phone: requestData.phone || requestData.userData?.phone,
        displayName: requestData.userData?.displayName,
        autoDetect: true,
      }

      const accounts = await searchPrima789Account(searchCriteria)

      if (accounts.length === 0) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: false,
            accountFound: false,
            message: 'No matching Prima789 account found',
            suggestions: [
              'Try manual linking with username and password',
              'Contact support if you have an account',
            ],
          }),
        }
      }

      // Use the best matching account (first in ordered results)
      const bestMatch =
        accounts.find((acc) => !acc.is_already_linked) || accounts[0]

      if (bestMatch.is_already_linked) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            success: false,
            accountFound: true,
            error: 'Account already linked',
            message:
              'The matching account is already linked to another LINE user',
            account: {
              username: bestMatch.username,
              fullName: `${bestMatch.first_name || ''} ${
                bestMatch.last_name || ''
              }`.trim(),
            },
          }),
        }
      }

      accountFound = bestMatch
    }

    if (!accountFound) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'No account found',
          message: 'Unable to find or verify Prima789 account',
        }),
      }
    }

    console.log('✅ Account found:', accountFound.username)

    // Create the account link
    linkResult = await createAccountLink(
      lineUserId,
      accountFound.username,
      syncMethod,
      requestData.userData || {}
    )

    if (!linkResult.success) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Link creation failed',
          message: 'Failed to create account link',
        }),
      }
    }

    console.log('🎉 Account linking successful!')

    // Prepare response data
    const responseData = {
      success: true,
      accountFound: true,
      message: 'Account linked successfully',
      account: {
        username: accountFound.username,
        mm_user: accountFound.mm_user,
        fullName: `${accountFound.first_name || ''} ${
          accountFound.last_name || ''
        }`.trim(),
        firstName: accountFound.first_name,
        lastName: accountFound.last_name,
        accNo: accountFound.acc_no,
        tel: accountFound.tel,
        email: accountFound.email,
        bankName: accountFound.bank_name,
        available: parseFloat(accountFound.available) || 0,
        balance: parseFloat(accountFound.available) || 0,
        creditLimit: parseFloat(accountFound.credit_limit) || 0,
        betCredit: parseFloat(accountFound.bet_credit) || 0,
        tier: accountFound.tier || 'Bronze',
        points: parseInt(accountFound.points) || 0,
        lastLogin: accountFound.last_login,
      },
      link: {
        id: linkResult.link.id,
        method: linkResult.link.link_method,
        linkedAt: linkResult.link.linked_at,
      },
      timestamp: new Date().toISOString(),
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(responseData),
    }
  } catch (error) {
    console.error('❌ Link Prima789 account error:', error)
    console.error('Stack trace:', error.stack)

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Internal server error',
        message: 'Failed to process account linking',
        timestamp: new Date().toISOString(),
      }),
    }
  }
}
