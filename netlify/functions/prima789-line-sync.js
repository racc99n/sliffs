// ===== netlify/functions/prima789-line-sync.js =====
const {
  upsertLineUser,
  checkUserLinking,
  getUserBalance,
  getRecentTransactions,
  logSystemEvent,
} = require('./utils/database')

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
    const data = JSON.parse(event.body || '{}')
    const { lineUserId, userProfile, syncType = 'full' } = data

    if (!lineUserId) {
      throw new Error('LINE User ID is required')
    }

    console.log(`Syncing user: ${lineUserId}, profile:`, userProfile)

    // Log sync start
    await logSystemEvent('sync_start', lineUserId, {
      syncType,
      userProfile: !!userProfile,
      source: 'prima789-line-sync',
    })

    // 1. Upsert LINE User
    const lineUser = await upsertLineUser(lineUserId, userProfile)

    // 2. Check for existing Prima789 account link
    const linkingResult = await checkUserLinking(lineUserId)

    // 3. Get additional data if linked
    let balance = 0
    let recentTransactions = []

    if (linkingResult.isLinked) {
      try {
        balance = await getUserBalance(lineUserId)
        recentTransactions = await getRecentTransactions(lineUserId, 5)
      } catch (error) {
        console.warn('⚠️ Failed to get balance/transactions:', error)
      }
    }

    // 4. Prepare sync result
    const syncResult = {
      lineUser: {
        userId: lineUser.line_user_id,
        displayName: lineUser.display_name,
        statusMessage: lineUser.status_message,
        pictureUrl: lineUser.picture_url,
        lastSync: lineUser.last_sync,
      },
      accountLinking: linkingResult,
      balance,
      recentTransactions,
      syncType,
      syncedAt: new Date().toISOString(),
    }

    // Log sync success
    await logSystemEvent('sync_success', lineUserId, {
      result: syncResult,
      source: 'prima789-line-sync',
    })

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

    // Log sync error
    const data = JSON.parse(event.body || '{}')
    if (data.lineUserId) {
      await logSystemEvent(
        'sync_error',
        data.lineUserId,
        {
          error: error.message,
          stack: error.stack,
          source: 'prima789-line-sync',
        },
        'error'
      )
    }

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
