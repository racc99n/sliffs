// ===== netlify/functions/check-account-linking.js =====
const { query } = require('./utils/database')

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ message: 'Method Not Allowed' }),
    }
  }

  try {
    const lineUserId = event.queryStringParameters.lineUserId
    if (!lineUserId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ message: 'LINE User ID is required' }),
      }
    }

    const sql = `
            SELECT 
                pa.username,
                pa.first_name,
                pa.last_name,
                pa.available as balance,
                pa.tier,
                pa.points
            FROM line_users lu
            JOIN account_links al ON lu.line_user_id = al.line_user_id
            JOIN prima789_accounts pa ON al.prima789_username = pa.username
            WHERE lu.line_user_id = $1 AND al.is_active = TRUE;
        `

    const result = await query(sql, [lineUserId])

    if (result.rows.length > 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          isLinked: true,
          linkData: result.rows[0],
        }),
      }
    } else {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ isLinked: false }),
      }
    }
  } catch (error) {
    console.error('Error in check-account-linking:', error)
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        message: 'Internal Server Error',
        error: error.message,
      }),
    }
  }
}
