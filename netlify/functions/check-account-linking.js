const {
  checkUserLinking,
  getLineUser,
  logSystemEvent,
} = require('./utils/database')

exports.handler = async (event, context) => {
  console.log('🔗 Check Account Linking - Start')

  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json',
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' }
  }

  try {
    // Get LINE user ID from query parameters or Authorization header
    let lineUserId = null

    if (event.queryStringParameters?.lineUserId) {
      lineUserId = event.queryStringParameters.lineUserId
    }

    // Try to extract from Authorization header (LINE access token)
    if (!lineUserId && event.headers.authorization) {
      // In real implementation, you would verify LINE access token here
      // For now, we'll use a simple extraction method
      const authHeader = event.headers.authorization
      if (authHeader.startsWith('Bearer ')) {
        // This is a placeholder - in production you'd decode the token
        lineUserId = event.queryStringParameters?.lineUserId
      }
    }

    if (!lineUserId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'LINE User ID is required',
          message:
            'Please provide lineUserId parameter or valid authorization header',
        }),
      }
    }

    console.log(`Checking linking status for LINE user: ${lineUserId}`)

    // Check user linking status
    const linkingInfo = await checkUserLinking(lineUserId)

    if (!linkingInfo) {
      // User not found in database
      await logSystemEvent(
        'WARN',
        'check-account-linking',
        `LINE user not found: ${lineUserId}`,
        { line_user_id: lineUserId }
      )

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          isLinked: false,
          user: null,
          message:
            'User not found in system. Please complete LINE profile sync first.',
        }),
      }
    }

    const isLinked = linkingInfo.is_linked && linkingInfo.prima789_username

    let responseData = {
      success: true,
      isLinked: isLinked,
      user: {
        line_user_id: linkingInfo.line_user_id,
        display_name: linkingInfo.display_name,
        picture_url: linkingInfo.picture_url,
        language: linkingInfo.language,
      },
    }

    // If linked, include Prima789 account data
    if (isLinked) {
      responseData.data = {
        prima789_username: linkingInfo.prima789_username,
        display_name:
          linkingInfo.first_name && linkingInfo.last_name
            ? `${linkingInfo.first_name} ${linkingInfo.last_name}`
            : linkingInfo.prima789_username,
        balance: parseFloat(linkingInfo.balance) || 0,
        tier: linkingInfo.tier || 'Bronze',
        points: parseInt(linkingInfo.points) || 0,
        total_transactions: parseInt(linkingInfo.total_transactions) || 0,
        link_method: linkingInfo.link_method,
        linked_at: linkingInfo.linked_at,
        last_updated: linkingInfo.updated_at,
      }

      responseData.message = 'Account is linked successfully'

      await logSystemEvent(
        'INFO',
        'check-account-linking',
        `Account linked check: ${lineUserId} -> ${linkingInfo.prima789_username}`,
        { is_linked: true, prima789_username: linkingInfo.prima789_username },
        lineUserId
      )
    } else {
      responseData.message = 'Account is not linked to any Prima789 account'

      await logSystemEvent(
        'INFO',
        'check-account-linking',
        `Account not linked: ${lineUserId}`,
        { is_linked: false },
        lineUserId
      )
    }

    console.log(
      `✅ Linking check result for ${lineUserId}: ${
        isLinked ? 'LINKED' : 'NOT_LINKED'
      }`
    )

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(responseData),
    }
  } catch (error) {
    console.error('❌ Check Account Linking Error:', error)

    await logSystemEvent(
      'ERROR',
      'check-account-linking',
      `Error checking account linking: ${error.message}`,
      { error: error.message, stack: error.stack }
    )

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Internal server error',
        message: 'Failed to check account linking status',
        details:
          process.env.NODE_ENV === 'development' ? error.message : undefined,
      }),
    }
  }
}
