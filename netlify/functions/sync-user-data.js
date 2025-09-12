// ===== netlify/functions/sync-user-data.js =====
const {
  upsertLineUser,
  upsertPrima789Account,
  checkUserLinking,
  updateAccountBalance,
  logSystemEvent,
  executeQuery,
} = require('./utils/database')

exports.handler = async (event, context) => {
  console.log('🔄 Sync User Data - Start')

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
    const {
      lineUserId,
      userProfile,
      prima789Data,
      syncType = 'profile',
    } = JSON.parse(event.body || '{}')

    if (!lineUserId) {
      throw new Error('LINE User ID is required')
    }

    console.log(`Syncing user data: ${lineUserId}, type: ${syncType}`)

    const result = {
      updated: [],
      lineUser: null,
      prima789Account: null,
    }

    // Log sync start
    await logSystemEvent('sync_user_data_start', lineUserId, {
      syncType,
      hasProfile: !!userProfile,
      hasPrima789Data: !!prima789Data,
      source: 'sync-user-data',
    })

    // Sync user profile
    if ((syncType === 'profile' || syncType === 'full') && userProfile) {
      result.lineUser = await upsertLineUser(lineUserId, userProfile)
      result.updated.push('profile')
      console.log('✅ Profile synced')
    }

    // Sync Prima789 data
    if ((syncType === 'prima789' || syncType === 'full') && prima789Data) {
      // Check if user has linked account
      const linkingResult = await checkUserLinking(lineUserId)

      if (linkingResult.isLinked && linkingResult.linkData) {
        const accountId = linkingResult.linkData.prima789_account_id

        // Update Prima789 account data
        if (prima789Data.username) {
          result.prima789Account = await upsertPrima789Account({
            username: prima789Data.username,
            email: prima789Data.email,
            phone: prima789Data.phone,
            balance: prima789Data.balance,
            lastLogin: prima789Data.lastLogin,
            accountType: prima789Data.accountType,
            status: prima789Data.status,
          })
        }

        // Update balance if provided
        if (typeof prima789Data.balance !== 'undefined') {
          await updateAccountBalance(accountId, prima789Data.balance)
          result.updated.push('balance')
        }

        result.updated.push('prima789')
        console.log('✅ Prima789 data synced')
      } else {
        console.log('⚠️ No Prima789 account linked for user')
      }
    }

    // Update sync timestamp for LINE user
    await executeQuery(
      'UPDATE line_users SET last_sync = NOW(), updated_at = NOW() WHERE line_user_id = $1',
      [lineUserId]
    )

    // Log sync success
    await logSystemEvent('sync_user_data_success', lineUserId, {
      result,
      source: 'sync-user-data',
    })

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

    // Log error
    const data = JSON.parse(event.body || '{}')
    if (data.lineUserId) {
      await logSystemEvent(
        'sync_user_data_error',
        data.lineUserId,
        {
          error: error.message,
          stack: error.stack,
          source: 'sync-user-data',
        },
        'error'
      )
    }

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Failed to sync user data',
        message: error.message,
        timestamp: new Date().toISOString(),
      }),
    }
  }
}
