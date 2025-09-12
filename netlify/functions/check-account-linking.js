// ===== netlify/functions/check-account-linking.js =====
const {
  checkUserLinking,
  getUserBalance,
  logSystemEvent,
} = require('./utils/database')

exports.handler = async (event, context) => {
  console.log('🔍 Check Account Linking - Start')

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' }
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Method not allowed',
      }),
    }
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

    console.log(`Checking account linking for: ${lineUserId}`)

    // Check linking status
    const linkingResult = await checkUserLinking(lineUserId)

    // Get balance if linked
    let balance = 0
    if (linkingResult.isLinked) {
      try {
        balance = await getUserBalance(lineUserId)
      } catch (error) {
        console.warn('⚠️ Failed to get balance:', error)
        balance = 0
      }
    }

    // Prepare response data
    const responseData = {
      ...linkingResult.linkData,
      balance: linkingResult.isLinked ? balance : 0,
    }

    // Log check event
    await logSystemEvent('check_account_linking', lineUserId, {
      isLinked: linkingResult.isLinked,
      hasLinkData: !!linkingResult.linkData,
      balance,
      source: 'check-account-linking',
    })

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        isLinked: linkingResult.isLinked,
        lineUserId,
        data: responseData,
        timestamp: new Date().toISOString(),
      }),
    }
  } catch (error) {
    console.error('❌ Check account linking error:', error)

    // Log error
    const data = JSON.parse(event.body || '{}')
    if (data.lineUserId) {
      await logSystemEvent(
        'check_linking_error',
        data.lineUserId,
        {
          error: error.message,
          source: 'check-account-linking',
        },
        'error'
      )
    }

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Failed to check account linking',
        message: error.message,
        timestamp: new Date().toISOString(),
      }),
    }
  }
}
