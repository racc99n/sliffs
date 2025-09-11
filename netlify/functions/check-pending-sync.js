const { Pool } = require('pg')

exports.handler = async (event, context) => {
  console.log('🔍 Check Pending Sync - Start')

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' }),
    }
  }

  let pool
  let client

  try {
    const { prima789_user_id, username, user_data, balance } = JSON.parse(
      event.body
    )

    if (!prima789_user_id && !username) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: 'Missing prima789_user_id or username',
        }),
      }
    }

    console.log(
      `🔍 Checking pending sync for Prima789 user: ${
        prima789_user_id || username
      }`
    )

    // Database connection
    pool = new Pool({
      connectionString: process.env.NETLIFY_DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    })

    client = await pool.connect()

    // Check for pending sync sessions
    const syncResult = await client.query(`
            SELECT 
                sync_id,
                line_user_id,
                user_profile,
                created_at
            FROM sync_sessions 
            WHERE status = 'pending' 
            AND expires_at > CURRENT_TIMESTAMP
            ORDER BY created_at ASC
            LIMIT 1
        `)

    if (syncResult.rows.length === 0) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          syncFound: false,
        }),
      }
    }

    const syncSession = syncResult.rows[0]
    console.log(`✅ Found pending sync session: ${syncSession.sync_id}`)

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        syncFound: true,
        syncData: {
          sync_id: syncSession.sync_id,
          line_user_id: syncSession.line_user_id,
          user_profile: JSON.parse(syncSession.user_profile),
          created_at: syncSession.created_at,
        },
      }),
    }
  } catch (error) {
    console.error('❌ Check pending sync error:', error)

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: 'Failed to check pending sync',
      }),
    }
  } finally {
    if (client) client.release()
    if (pool) await pool.end()
  }
}
