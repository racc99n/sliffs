// ===== netlify/functions/link-prima789-account.js =====
const { getClient } = require('./utils/database')

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' }
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ message: 'Method Not Allowed' }),
    }
  }

  const client = await getClient()
  try {
    const { lineUserId, lineProfile, prima789Data } = JSON.parse(event.body)

    if (!lineUserId || !prima789Data || !prima789Data.username) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ message: 'Missing required data' }),
      }
    }

    await client.query('BEGIN')

    // Step 1: Upsert line_users table
    const upsertLineUserSql = `
            INSERT INTO line_users (line_user_id, display_name, picture_url, status_message, is_linked, prima789_username)
            VALUES ($1, $2, $3, $4, TRUE, $5)
            ON CONFLICT (line_user_id) 
            DO UPDATE SET 
                display_name = EXCLUDED.display_name,
                picture_url = EXCLUDED.picture_url,
                status_message = EXCLUDED.status_message,
                is_linked = TRUE,
                prima789_username = EXCLUDED.prima789_username,
                updated_at = CURRENT_TIMESTAMP;
        `
    await client.query(upsertLineUserSql, [
      lineUserId,
      lineProfile.displayName,
      lineProfile.pictureUrl,
      lineProfile.statusMessage,
      prima789Data.username,
    ])

    // Step 2: Upsert prima789_accounts table
    const upsertPrimaSql = `
            INSERT INTO prima789_accounts (username, mm_user, first_name, last_name, tel, available, last_login)
            VALUES ($1, $2, $3, $4, $5, $6, NOW())
            ON CONFLICT (username)
            DO UPDATE SET
                mm_user = EXCLUDED.mm_user,
                first_name = EXCLUDED.first_name,
                last_name = EXCLUDED.last_name,
                tel = EXCLUDED.tel,
                available = EXCLUDED.available,
                last_login = NOW(),
                updated_at = CURRENT_TIMESTAMP;
        `
    await client.query(upsertPrimaSql, [
      prima789Data.username,
      prima789Data.username, // Assuming mm_user is same as username
      prima789Data.first_name || 'N/A',
      prima789Data.last_name || 'N/A',
      prima789Data.tel || 'N/A',
      prima789Data.balance || 0,
    ])

    // Step 3: Insert into account_links table
    const insertLinkSql = `
            INSERT INTO account_links (line_user_id, prima789_username, link_method, is_active)
            VALUES ($1, $2, 'manual', TRUE)
            ON CONFLICT (line_user_id, prima789_username)
            DO UPDATE SET is_active = TRUE;
        `
    await client.query(insertLinkSql, [lineUserId, prima789Data.username])

    await client.query('COMMIT')

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Account linked successfully',
      }),
    }
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('Error in link-prima789-account:', error)
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        message: 'Internal Server Error',
        error: error.message,
      }),
    }
  } finally {
    client.release()
  }
}
