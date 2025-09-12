// ===== netlify/functions/transaction-webhook.js =====
const { query } = require('./utils/database')

const API_KEY = process.env.PRIMA789_API_KEY

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
    'Content-Type': 'application/json',
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' }
  }

  // Security Check
  const providedApiKey = event.headers['x-api-key']
  if (!providedApiKey || providedApiKey !== API_KEY) {
    console.warn('Unauthorized webhook access attempt')
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ message: 'Unauthorized' }),
    }
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ message: 'Method Not Allowed' }),
    }
  }

  try {
    const data = JSON.parse(event.body)

    // We need to find the line_user_id from prima789_username
    const getLineUserSql = `
            SELECT line_user_id 
            FROM account_links 
            WHERE prima789_username = $1 AND is_active = TRUE;
        `
    const userResult = await query(getLineUserSql, [data.user_id])

    const lineUserId =
      userResult.rows.length > 0 ? userResult.rows[0].line_user_id : null

    const insertTxSql = `
            INSERT INTO transactions (
                transaction_id, line_user_id, prima789_username, transaction_type, 
                amount, balance_before, balance_after, description, source, details
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);
        `

    await query(insertTxSql, [
      data.transaction_id,
      lineUserId,
      data.user_id,
      data.transaction_type,
      data.amount,
      data.balance_before,
      data.balance_after,
      `Transaction from ${data.details.source}`,
      data.details.source,
      data.details,
    ])

    // Also update the balance in prima789_accounts table
    if (data.balance_after !== undefined) {
      const updateBalanceSql = `
                UPDATE prima789_accounts 
                SET available = $1, updated_at = CURRENT_TIMESTAMP 
                WHERE username = $2;
             `
      await query(updateBalanceSql, [data.balance_after, data.user_id])
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, message: 'Webhook received' }),
    }
  } catch (error) {
    console.error('Error in transaction-webhook:', error)
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
