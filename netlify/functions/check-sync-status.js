const {
  getSocketSyncSession,
  completeSocketSyncSession,
  createAccountLink,
  checkUserLinking,
  logSystemEvent,
  createTransaction,
} = require('./utils/database')

exports.handler = async (event, context) => {
  console.log('🔌 Check Socket Sync Status - Start')

  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' }
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Method not allowed',
        message: 'Only GET method is supported',
      }),
    }
  }

  try {
    const { syncId } = event.queryStringParameters || {}

    if (!syncId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Sync ID is required',
          message: 'Please provide syncId parameter',
        }),
      }
    }

    console.log(`Checking sync status for: ${syncId}`)

    // Get sync session
    const syncSession = await getSocketSyncSession(syncId)

    if (!syncSession) {
      await logSystemEvent(
        'WARN',
        'check-sync-status',
        `Socket sync session not found: ${syncId}`,
        { sync_id: syncId }
      )

      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Sync session not found',
          message: 'Socket sync session does not exist or has expired',
        }),
      }
    }

    const now = new Date()
    const expiresAt = new Date(syncSession.expires_at)
    const isExpired = now > expiresAt

    // Check if session is expired
    if (isExpired && syncSession.status === 'waiting') {
      await logSystemEvent(
        'INFO',
        'check-sync-status',
        `Socket sync session expired: ${syncId}`,
        { sync_session: syncSession }
      )

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          completed: false,
          expired: true,
          status: 'expired',
          message: 'Sync session has expired. Please try again.',
          sync_session: {
            sync_id: syncSession.sync_id,
            status: 'expired',
            created_at: syncSession.created_at,
            expires_at: syncSession.expires_at,
          },
        }),
      }
    }

    // Check if session is completed
    if (syncSession.status === 'completed') {
      console.log(`Socket sync completed: ${syncId}`)

      const prima789Data = syncSession.prima789_data
        ? JSON.parse(syncSession.prima789_data)
        : null

      // Check if account linking was successful
      const linkingInfo = await checkUserLinking(syncSession.line_user_id)
      const isAccountLinked = linkingInfo && linkingInfo.is_linked

      await logSystemEvent(
        'INFO',
        'check-sync-status',
        `Socket sync status checked - completed: ${syncId}`,
        {
          sync_session: syncSession,
          account_linked: isAccountLinked,
          prima789_data: prima789Data,
        },
        syncSession.line_user_id
      )

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          completed: true,
          expired: false,
          status: 'completed',
          accountLinked: isAccountLinked,
          message: isAccountLinked
            ? 'Account linking completed successfully!'
            : 'Sync completed but linking failed',
          sync_session: {
            sync_id: syncSession.sync_id,
            line_user_id: syncSession.line_user_id,
            status: syncSession.status,
            completed_at: syncSession.completed_at,
            created_at: syncSession.created_at,
            expires_at: syncSession.expires_at,
          },
          account: isAccountLinked
            ? {
                prima789_username: linkingInfo.prima789_username,
                display_name:
                  linkingInfo.first_name && linkingInfo.last_name
                    ? `${linkingInfo.first_name} ${linkingInfo.last_name}`
                    : linkingInfo.prima789_username,
                balance: parseFloat(linkingInfo.balance) || 0,
                tier: linkingInfo.tier || 'Bronze',
                points: parseInt(linkingInfo.points) || 0,
                linked_at: linkingInfo.linked_at,
              }
            : null,
          prima789_data: prima789Data,
        }),
      }
    }

    // Session is still waiting
    console.log(`Socket sync still waiting: ${syncId}`)

    const timeRemaining = Math.max(0, Math.floor((expiresAt - now) / 1000))

    await logSystemEvent(
      'DEBUG',
      'check-sync-status',
      `Socket sync status checked - waiting: ${syncId}`,
      {
        sync_session: syncSession,
        time_remaining: timeRemaining,
      },
      syncSession.line_user_id
    )

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        completed: false,
        expired: false,
        status: 'waiting',
        message: 'Waiting for Prima789 login to complete linking',
        sync_session: {
          sync_id: syncSession.sync_id,
          line_user_id: syncSession.line_user_id,
          status: syncSession.status,
          created_at: syncSession.created_at,
          expires_at: syncSession.expires_at,
          time_remaining_seconds: timeRemaining,
        },
        instructions: {
          step1: 'Open Prima789.com in a new tab',
          step2: 'Login with your Prima789 account',
          step3: 'Return to this page - linking will complete automatically',
          timeout: `This session will expire in ${Math.ceil(
            timeRemaining / 60
          )} minutes`,
        },
      }),
    }
  } catch (error) {
    console.error('❌ Check Socket Sync Status Error:', error)

    await logSystemEvent(
      'ERROR',
      'check-sync-status',
      `Socket sync status check error: ${error.message}`,
      { error: error.message, stack: error.stack }
    )

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Internal server error',
        message: 'Failed to check socket sync status',
        details:
          process.env.NODE_ENV === 'development' ? error.message : undefined,
      }),
    }
  }
}

// Register socket sync session (called from transaction webhook)
exports.registerSocketSync = async (syncId, prima789Data) => {
  try {
    console.log(`Registering socket sync completion: ${syncId}`)

    // Complete the sync session
    const completedSession = await completeSocketSyncSession(
      syncId,
      prima789Data
    )

    if (!completedSession) {
      throw new Error('Failed to complete socket sync session')
    }

    // Create account link
    const { username } = prima789Data
    if (username && completedSession.line_user_id) {
      try {
        await createAccountLink(
          completedSession.line_user_id,
          username,
          'socket'
        )

        // Create linking transaction
        await createTransaction({
          transaction_id: `socket_link_${Date.now()}_${Math.random()
            .toString(36)
            .substr(2, 5)}`,
          line_user_id: completedSession.line_user_id,
          prima789_username: username,
          transaction_type: 'account_link',
          amount: 0,
          balance_after: parseFloat(prima789Data.available) || 0,
          description: `Account linked via socket sync: ${syncId}`,
          source: 'socket_sync',
          details: {
            sync_id: syncId,
            link_method: 'socket',
            prima789_data: prima789Data,
          },
        })

        await logSystemEvent(
          'INFO',
          'registerSocketSync',
          `Socket sync linking successful: ${completedSession.line_user_id} -> ${username}`,
          {
            sync_id: syncId,
            line_user_id: completedSession.line_user_id,
            prima789_username: username,
          },
          completedSession.line_user_id
        )

        console.log(`✅ Socket sync registered and linked: ${syncId}`)
      } catch (linkError) {
        console.error('Socket sync linking error:', linkError)

        await logSystemEvent(
          'ERROR',
          'registerSocketSync',
          `Socket sync linking failed: ${linkError.message}`,
          {
            sync_id: syncId,
            error: linkError.message,
            prima789_data: prima789Data,
          },
          completedSession.line_user_id
        )
      }
    }

    return completedSession
  } catch (error) {
    console.error('Register socket sync error:', error)

    await logSystemEvent(
      'ERROR',
      'registerSocketSync',
      `Socket sync registration error: ${error.message}`,
      { sync_id: syncId, error: error.message }
    )

    throw error
  }
}
