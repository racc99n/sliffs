// ===== netlify/functions/prima789-line-sync.js =====
const { Pool } = require('pg')

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,
  max: 10,
  min: 2,
  idleTimeoutMillis: 30000,
})

exports.handler = async (event, context) => {
  console.log('🔄 Prima789 LINE Sync - Start')

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' }
  }

  try {
    const data = JSON.parse(event.body || '{}')
    const { lineUserId, userProfile, syncType = 'full' } = data

    if (!lineUserId) {
      throw new Error('LINE User ID is required')
    }

    console.log(`Syncing user: ${lineUserId}, profile:`, userProfile)

    // 1. Upsert LINE User
    await upsertLineUser(lineUserId, userProfile)

    // 2. Check for existing Prima789 account link
    const linkingResult = await checkAccountLinking(lineUserId)

    // 3. Sync user profile data
    const syncResult = await performFullSync(
      lineUserId,
      userProfile,
      linkingResult
    )

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Sync operation completed',
        data: syncResult,
        timestamp: new Date().toISOString(),
      }),
    }
  } catch (error) {
    console.error('❌ Sync Error:', error)
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Sync failed',
        message: error.message,
        timestamp: new Date().toISOString(),
      }),
    }
  }
}

// Helper Functions
async function upsertLineUser(lineUserId, profile) {
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
        RETURNING *`

  const values = [
    lineUserId,
    profile?.displayName || null,
    profile?.statusMessage || null,
    profile?.pictureUrl || null,
  ]

  const result = await pool.query(query, values)
  console.log('✅ Line user upserted:', result.rows[0].line_user_id)
  return result.rows[0]
}

async function checkAccountLinking(lineUserId) {
  const query = `
        SELECT al.*, pa.username, pa.balance 
        FROM account_linking al
        LEFT JOIN prima789_accounts pa ON al.prima789_account_id = pa.account_id
        WHERE al.line_user_id = $1 AND al.is_active = true
        ORDER BY al.created_at DESC LIMIT 1`

  const result = await pool.query(query, [lineUserId])
  const isLinked = result.rows.length > 0

  console.log(`Account linking status for ${lineUserId}: ${isLinked}`)
  return {
    isLinked,
    linkData: result.rows[0] || null,
  }
}

async function performFullSync(lineUserId, profile, linkingResult) {
  const result = {
    lineUser: null,
    accountLinking: linkingResult,
    prima789Account: null,
    transactions: null,
  }

  try {
    // Update line user sync timestamp
    await pool.query(
      'UPDATE line_users SET last_sync = NOW() WHERE line_user_id = $1',
      [lineUserId]
    )

    // If account is linked, sync Prima789 data
    if (linkingResult.isLinked && linkingResult.linkData) {
      const prima789AccountId = linkingResult.linkData.prima789_account_id

      // Get latest Prima789 account info
      const accountQuery = `
                SELECT * FROM prima789_accounts 
                WHERE account_id = $1`
      const accountResult = await pool.query(accountQuery, [prima789AccountId])
      result.prima789Account = accountResult.rows[0]

      // Get recent transactions (last 10)
      const transQuery = `
                SELECT * FROM transactions 
                WHERE prima789_account_id = $1 
                ORDER BY created_at DESC LIMIT 10`
      const transResult = await pool.query(transQuery, [prima789AccountId])
      result.transactions = transResult.rows
    }

    // Log sync event
    await logSyncEvent(lineUserId, 'full_sync', result)

    return result
  } catch (error) {
    console.error('❌ Full sync error:', error)
    await logSyncEvent(lineUserId, 'full_sync_error', { error: error.message })
    throw error
  }
}

async function logSyncEvent(lineUserId, eventType, data) {
  try {
    const query = `
            INSERT INTO system_logs (
                event_type, line_user_id, data, created_at
            ) VALUES ($1, $2, $3, NOW())`

    await pool.query(query, [eventType, lineUserId, JSON.stringify(data)])
  } catch (error) {
    console.error('Warning: Failed to log sync event:', error)
  }
}

// ===== netlify/functions/check-account-linking.js =====
const { Pool } = require('pg')

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,
})

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' }
  }

  try {
    const { lineUserId } = JSON.parse(event.body || '{}')

    if (!lineUserId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'LINE User ID is required',
        }),
      }
    }

    // Check if account is linked
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
            LIMIT 1`

    const result = await pool.query(query, [lineUserId])
    const isLinked = result.rows.length > 0
    const linkData = result.rows[0] || null

    console.log(`Account linking check for ${lineUserId}: ${isLinked}`)

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        isLinked,
        lineUserId,
        data: linkData,
        timestamp: new Date().toISOString(),
      }),
    }
  } catch (error) {
    console.error('❌ Check account linking error:', error)
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Failed to check account linking',
        message: error.message,
      }),
    }
  }
}

// ===== netlify/functions/sync-user-data.js =====
const { Pool } = require('pg')

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,
})

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' }
  }

  try {
    const {
      lineUserId,
      userProfile,
      prima789Data,
      syncType = 'profile',
    } = JSON.parse(event.body || '{}')

    if (!lineUserId) {
      throw new Error('LINE User ID is required')
    }

    let result = { updated: [] }

    // Sync user profile
    if (syncType === 'profile' || syncType === 'full') {
      if (userProfile) {
        await syncUserProfile(lineUserId, userProfile)
        result.updated.push('profile')
      }
    }

    // Sync Prima789 data
    if (syncType === 'prima789' || syncType === 'full') {
      if (prima789Data) {
        await syncPrima789Data(lineUserId, prima789Data)
        result.updated.push('prima789')
      }
    }

    // Update sync timestamp
    await pool.query(
      'UPDATE line_users SET last_sync = NOW(), updated_at = NOW() WHERE line_user_id = $1',
      [lineUserId]
    )

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'User data synced successfully',
        data: result,
        timestamp: new Date().toISOString(),
      }),
    }
  } catch (error) {
    console.error('❌ Sync user data error:', error)
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Failed to sync user data',
        message: error.message,
      }),
    }
  }
}

async function syncUserProfile(lineUserId, profile) {
  const query = `
        UPDATE line_users SET 
            display_name = $2,
            status_message = $3,
            picture_url = $4,
            updated_at = NOW()
        WHERE line_user_id = $1`

  await pool.query(query, [
    lineUserId,
    profile.displayName,
    profile.statusMessage,
    profile.pictureUrl,
  ])

  console.log(`✅ Profile synced for user: ${lineUserId}`)
}

async function syncPrima789Data(lineUserId, prima789Data) {
  // Get linked account
  const linkQuery = `
        SELECT prima789_account_id FROM account_linking 
        WHERE line_user_id = $1 AND is_active = true`

  const linkResult = await pool.query(linkQuery, [lineUserId])

  if (linkResult.rows.length === 0) {
    console.log(`⚠️ No Prima789 account linked for user: ${lineUserId}`)
    return
  }

  const accountId = linkResult.rows[0].prima789_account_id

  // Update account data
  const updateQuery = `
        UPDATE prima789_accounts SET 
            balance = $2,
            last_login = $3,
            updated_at = NOW()
        WHERE account_id = $1`

  await pool.query(updateQuery, [
    accountId,
    prima789Data.balance || 0,
    prima789Data.lastLogin ? new Date(prima789Data.lastLogin) : new Date(),
  ])

  console.log(`✅ Prima789 data synced for account: ${accountId}`)
}
