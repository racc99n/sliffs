const {
  upsertLineUser,
  searchPrima789Account,
  getPrima789Account,
  createAccountLink,
  createSocketSyncSession,
  logSystemEvent,
  createTransaction,
} = require('./utils/database')

exports.handler = async (event, context) => {
  console.log('🔗 Link Prima789 Account - Start')

  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
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
    const requestData = JSON.parse(event.body || '{}')
    const {
      lineUserId,
      userProfile,
      syncMethod,
      username,
      prima789AccountData,
    } = requestData

    // Validate required data
    if (!lineUserId || !userProfile) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Missing required data',
          message: 'lineUserId and userProfile are required',
        }),
      }
    }

    console.log(
      `Processing account linking for ${lineUserId} with method: ${syncMethod}`
    )

    // Upsert LINE user first
    await upsertLineUser(userProfile)

    let result = {}

    switch (syncMethod) {
      case 'auto':
        result = await handleAutoSync(lineUserId, userProfile)
        break
      case 'manual':
        if (!username) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({
              success: false,
              error: 'Username is required for manual sync',
            }),
          }
        }
        result = await handleManualSync(lineUserId, userProfile, username)
        break
      case 'socket':
        result = await handleSocketSync(lineUserId, userProfile)
        break
      case 'direct':
        if (!prima789AccountData) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({
              success: false,
              error: 'Prima789 account data is required for direct sync',
            }),
          }
        }
        result = await handleDirectSync(
          lineUserId,
          userProfile,
          prima789AccountData
        )
        break
      default:
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'Invalid sync method',
            message: 'Supported methods: auto, manual, socket, direct',
          }),
        }
    }

    console.log(
      `✅ Account linking result for ${lineUserId}:`,
      result.success ? 'SUCCESS' : 'FAILED'
    )

    return {
      statusCode: result.success ? 200 : 400,
      headers,
      body: JSON.stringify(result),
    }
  } catch (error) {
    console.error('❌ Link Prima789 Account Error:', error)

    await logSystemEvent(
      'ERROR',
      'link-prima789-account',
      `Error linking account: ${error.message}`,
      { error: error.message, stack: error.stack }
    )

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Internal server error',
        message: 'Failed to link Prima789 account',
        details:
          process.env.NODE_ENV === 'development' ? error.message : undefined,
      }),
    }
  }
}

// Handle automatic sync based on LINE profile data
async function handleAutoSync(lineUserId, userProfile) {
  try {
    console.log(`Auto sync for ${lineUserId}: searching by display name`)

    const searchCriteria = {
      displayName: userProfile.displayName,
    }

    const accounts = await searchPrima789Account(searchCriteria)

    if (accounts.length === 0) {
      await logSystemEvent(
        'INFO',
        'handleAutoSync',
        `No Prima789 accounts found for ${userProfile.displayName}`,
        { search_criteria: searchCriteria },
        lineUserId
      )

      return {
        success: false,
        accountFound: false,
        message:
          'ไม่พบบัญชี Prima789 ที่ตรงกับชื่อในโปรไฟล์ LINE กรุณาใช้วิธีกรอกข้อมูลด้วยตนเอง',
      }
    }

    // If multiple accounts found, return the most recently active one
    const account = accounts[0]

    // Create account link
    await createAccountLink(lineUserId, account.username, 'auto')

    // Create linking transaction record
    await createTransaction({
      transaction_id: `link_auto_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 5)}`,
      line_user_id: lineUserId,
      prima789_username: account.username,
      transaction_type: 'account_link',
      amount: 0,
      balance_after: parseFloat(account.available) || 0,
      description: `Account linked automatically via display name match`,
      source: 'auto_link',
      details: {
        link_method: 'auto',
        search_criteria: searchCriteria,
        user_profile: userProfile,
      },
    })

    await logSystemEvent(
      'INFO',
      'handleAutoSync',
      `Auto sync successful: ${lineUserId} -> ${account.username}`,
      { prima789_account: account.username, method: 'auto' },
      lineUserId
    )

    return {
      success: true,
      accountFound: true,
      account: {
        username: account.username,
        display_name:
          account.first_name && account.last_name
            ? `${account.first_name} ${account.last_name}`
            : account.username,
        balance: parseFloat(account.available) || 0,
        tier: account.tier || 'Bronze',
        points: parseInt(account.points) || 0,
        total_transactions: parseInt(account.total_transactions) || 0,
      },
      message: 'เชื่อมโยงบัญชีสำเร็จ',
    }
  } catch (error) {
    console.error('Auto sync error:', error)
    throw error
  }
}

// Handle manual sync with username
async function handleManualSync(lineUserId, userProfile, username) {
  try {
    console.log(`Manual sync for ${lineUserId}: searching username ${username}`)

    const account = await getPrima789Account(username)

    if (!account) {
      await logSystemEvent(
        'INFO',
        'handleManualSync',
        `Prima789 account not found: ${username}`,
        { username: username },
        lineUserId
      )

      return {
        success: false,
        accountFound: false,
        message: `ไม่พบบัญชี Prima789 ที่มี username: ${username}`,
      }
    }

    // Create account link
    await createAccountLink(lineUserId, account.username, 'manual')

    // Create linking transaction record
    await createTransaction({
      transaction_id: `link_manual_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 5)}`,
      line_user_id: lineUserId,
      prima789_username: account.username,
      transaction_type: 'account_link',
      amount: 0,
      balance_after: parseFloat(account.available) || 0,
      description: `Account linked manually via username: ${username}`,
      source: 'manual_link',
      details: {
        link_method: 'manual',
        input_username: username,
        user_profile: userProfile,
      },
    })

    await logSystemEvent(
      'INFO',
      'handleManualSync',
      `Manual sync successful: ${lineUserId} -> ${account.username}`,
      {
        prima789_account: account.username,
        method: 'manual',
        input_username: username,
      },
      lineUserId
    )

    return {
      success: true,
      accountFound: true,
      account: {
        username: account.username,
        display_name:
          account.first_name && account.last_name
            ? `${account.first_name} ${account.last_name}`
            : account.username,
        balance: parseFloat(account.available) || 0,
        tier: account.tier || 'Bronze',
        points: parseInt(account.points) || 0,
        total_transactions: parseInt(account.total_transactions) || 0,
      },
      message: 'เชื่อมโยงบัญชีสำเร็จ',
    }
  } catch (error) {
    console.error('Manual sync error:', error)
    throw error
  }
}

// Handle socket sync (real-time integration)
async function handleSocketSync(lineUserId, userProfile) {
  try {
    console.log(`Socket sync for ${lineUserId}: creating sync session`)

    const syncSession = await createSocketSyncSession(lineUserId, 10) // 10 minutes expiration

    await logSystemEvent(
      'INFO',
      'handleSocketSync',
      `Socket sync session created: ${syncSession.sync_id}`,
      { sync_session: syncSession },
      lineUserId
    )

    return {
      success: true,
      socketReady: true,
      syncId: syncSession.sync_id,
      expiresAt: syncSession.expires_at,
      message: 'กรุณาเข้าสู่ระบบ Prima789.com เพื่อทำการเชื่อมโยงอัตโนมัติ',
    }
  } catch (error) {
    console.error('Socket sync error:', error)
    throw error
  }
}

// Handle direct sync with Prima789 account data
async function handleDirectSync(lineUserId, userProfile, prima789AccountData) {
  try {
    console.log(`Direct sync for ${lineUserId}: using provided account data`)

    const { username } = prima789AccountData

    if (!username) {
      return {
        success: false,
        error: 'Username is required in Prima789 account data',
      }
    }

    // Create account link
    await createAccountLink(lineUserId, username, 'direct')

    // Create linking transaction record
    await createTransaction({
      transaction_id: `link_direct_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 5)}`,
      line_user_id: lineUserId,
      prima789_username: username,
      transaction_type: 'account_link',
      amount: 0,
      balance_after: parseFloat(prima789AccountData.available) || 0,
      description: `Account linked directly with provided data`,
      source: 'direct_link',
      details: {
        link_method: 'direct',
        prima789_data: prima789AccountData,
        user_profile: userProfile,
      },
    })

    await logSystemEvent(
      'INFO',
      'handleDirectSync',
      `Direct sync successful: ${lineUserId} -> ${username}`,
      { prima789_account: username, method: 'direct' },
      lineUserId
    )

    return {
      success: true,
      accountFound: true,
      account: {
        username: username,
        display_name:
          prima789AccountData.first_name && prima789AccountData.last_name
            ? `${prima789AccountData.first_name} ${prima789AccountData.last_name}`
            : username,
        balance: parseFloat(prima789AccountData.available) || 0,
        tier: prima789AccountData.tier || 'Bronze',
        points: parseInt(prima789AccountData.points) || 0,
        total_transactions:
          parseInt(prima789AccountData.total_transactions) || 0,
      },
      message: 'เชื่อมโยงบัญชีสำเร็จ',
    }
  } catch (error) {
    console.error('Direct sync error:', error)
    throw error
  }
}
