const {
  upsertLineUser,
  checkUserLinking,
  upsertPrima789Account,
  createTransaction,
  updateAccountBalance,
  logSystemEvent,
} = require('./utils/database')

exports.handler = async (event, context) => {
  console.log('🔄 Sync User Data - Start')

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
      prima789Data,
      syncType = 'full', // 'profile', 'balance', 'full'
      forceUpdate = false,
    } = requestData

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

    console.log(`Processing data sync for ${lineUserId}, type: ${syncType}`)

    let result = {
      success: true,
      message: 'Data sync completed successfully',
      sync_type: syncType,
      timestamp: new Date().toISOString(),
      updates: {},
    }

    // Step 1: Sync LINE user profile
    if (userProfile && (syncType === 'profile' || syncType === 'full')) {
      console.log(`Syncing LINE profile for ${lineUserId}`)

      const lineUser = await upsertLineUser(userProfile)
      result.updates.line_profile = {
        updated: true,
        user_id: lineUser.line_user_id,
        display_name: lineUser.display_name,
        updated_at: lineUser.updated_at,
      }

      await logSystemEvent(
        'INFO',
        'sync-user-data',
        `LINE profile synced: ${lineUserId}`,
        { user_profile: userProfile },
        lineUserId
      )
    }

    // Step 2: Check linking status
    const linkingInfo = await checkUserLinking(lineUserId)
    result.is_linked = linkingInfo ? linkingInfo.is_linked : false
    result.prima789_username = linkingInfo
      ? linkingInfo.prima789_username
      : null

    // Step 3: Sync Prima789 data (if linked and data provided)
    if (prima789Data && linkingInfo && linkingInfo.is_linked) {
      console.log(`Syncing Prima789 data for ${linkingInfo.prima789_username}`)

      const syncResult = await syncPrima789Data(
        linkingInfo.prima789_username,
        prima789Data,
        syncType,
        forceUpdate
      )
      result.updates.prima789_account = syncResult

      await logSystemEvent(
        'INFO',
        'sync-user-data',
        `Prima789 data synced: ${linkingInfo.prima789_username}`,
        { sync_result: syncResult },
        lineUserId
      )
    } else if (prima789Data && !linkingInfo?.is_linked) {
      result.warnings = result.warnings || []
      result.warnings.push('Prima789 data provided but account is not linked')
    }

    // Step 4: Create sync transaction record
    if (linkingInfo && linkingInfo.is_linked) {
      const transactionId = `sync_${syncType}_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 5)}`

      await createTransaction({
        transaction_id: transactionId,
        line_user_id: lineUserId,
        prima789_username: linkingInfo.prima789_username,
        transaction_type: 'data_sync',
        amount: 0,
        balance_after: prima789Data?.available || null,
        description: `Data sync (${syncType})`,
        source: 'api_sync',
        details: {
          sync_type: syncType,
          force_update: forceUpdate,
          synced_data: {
            line_profile: !!userProfile,
            prima789_data: !!prima789Data,
          },
        },
      })

      result.sync_transaction_id = transactionId
    }

    // Step 5: Get updated user data for response
    if (linkingInfo && linkingInfo.is_linked) {
      const updatedLinkingInfo = await checkUserLinking(lineUserId)
      result.user_data = {
        line_user_id: updatedLinkingInfo.line_user_id,
        display_name: updatedLinkingInfo.display_name,
        prima789_username: updatedLinkingInfo.prima789_username,
        balance: parseFloat(updatedLinkingInfo.balance) || 0,
        tier: updatedLinkingInfo.tier,
        points: parseInt(updatedLinkingInfo.points) || 0,
        total_transactions:
          parseInt(updatedLinkingInfo.total_transactions) || 0,
        last_updated: updatedLinkingInfo.updated_at,
      }
    }

    console.log(`✅ Data sync complete for ${lineUserId}`)

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(result),
    }
  } catch (error) {
    console.error('❌ Sync User Data Error:', error)

    await logSystemEvent(
      'ERROR',
      'sync-user-data',
      `Data sync error: ${error.message}`,
      { error: error.message, stack: error.stack }
    )

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Internal server error',
        message: 'Failed to sync user data',
        details:
          process.env.NODE_ENV === 'development' ? error.message : undefined,
      }),
    }
  }
}

// Sync Prima789 account data
async function syncPrima789Data(username, prima789Data, syncType, forceUpdate) {
  try {
    console.log(`Syncing Prima789 data for ${username}:`, {
      type: syncType,
      force: forceUpdate,
      hasBalance: !!prima789Data.available,
    })

    let updateResult = {
      updated: false,
      changes: [],
      account_data: null,
      balance_updated: false,
      previous_balance: null,
      new_balance: null,
    }

    // Get current account data
    const { getPrima789Account } = require('./utils/database')
    const currentAccount = await getPrima789Account(username)

    if (currentAccount) {
      updateResult.previous_balance = parseFloat(currentAccount.available) || 0
    }

    // Prepare account data for update
    let accountData = {
      username: username,
    }

    // Map Prima789 data fields
    const fieldMapping = {
      mm_user: ['mm_user', 'username', 'user_id'],
      acc_no: ['acc_no', 'account_number', 'tel', 'phone'],
      bank_name: ['bank_name', 'bank'],
      bank_id: ['bank_id'],
      first_name: ['first_name', 'firstname'],
      last_name: ['last_name', 'lastname'],
      tel: ['tel', 'phone', 'acc_no'],
      email: ['email'],
      available: ['available', 'balance', 'current_balance'],
      credit_limit: ['credit_limit', 'limit'],
      bet_credit: ['bet_credit', 'credit'],
      tier: ['tier', 'level'],
      points: ['points', 'reward_points'],
      member_ref: ['member_ref', 'ref_code'],
      register_time: ['register_time', 'created_at', 'registerTime'],
      last_login: ['last_login', 'login_time'],
    }

    // Extract and map fields
    Object.keys(fieldMapping).forEach((targetField) => {
      const sourceFields = fieldMapping[targetField]
      for (const sourceField of sourceFields) {
        if (
          prima789Data[sourceField] !== undefined &&
          prima789Data[sourceField] !== null
        ) {
          accountData[targetField] = prima789Data[sourceField]
          break
        }
      }
    })

    // Always update last_login for sync operations
    accountData.last_login = new Date().toISOString()

    // Remove undefined/null values
    Object.keys(accountData).forEach((key) => {
      if (
        accountData[key] === null ||
        accountData[key] === undefined ||
        accountData[key] === ''
      ) {
        delete accountData[key]
      }
    })

    // Update account data
    if (Object.keys(accountData).length > 1) {
      // More than just username
      console.log(`Updating Prima789 account data for ${username}`)

      const updatedAccount = await upsertPrima789Account(accountData)
      updateResult.updated = true
      updateResult.account_data = updatedAccount
      updateResult.changes.push('account_data_updated')

      // Check if balance was updated
      if (accountData.available !== undefined) {
        updateResult.new_balance = parseFloat(accountData.available)
        updateResult.balance_updated =
          updateResult.previous_balance !== updateResult.new_balance

        if (updateResult.balance_updated) {
          updateResult.changes.push('balance_updated')

          // Create balance update transaction
          const transactionId = `balance_sync_${Date.now()}_${Math.random()
            .toString(36)
            .substr(2, 5)}`

          await createTransaction({
            transaction_id: transactionId,
            prima789_username: username,
            transaction_type: 'balance_sync',
            amount: Math.abs(
              updateResult.new_balance - (updateResult.previous_balance || 0)
            ),
            balance_before: updateResult.previous_balance,
            balance_after: updateResult.new_balance,
            description: `Balance synced from Prima789`,
            source: 'api_sync',
            details: {
              sync_type: syncType,
              force_update: forceUpdate,
              balance_change:
                updateResult.new_balance - (updateResult.previous_balance || 0),
            },
          })

          updateResult.balance_transaction_id = transactionId
        }
      }
    }

    // Special handling for balance-only sync
    if (syncType === 'balance' && prima789Data.available !== undefined) {
      const newBalance = parseFloat(prima789Data.available)

      if (
        forceUpdate ||
        !currentAccount ||
        parseFloat(currentAccount.available) !== newBalance
      ) {
        console.log(`Force updating balance for ${username}: ${newBalance}`)

        await updateAccountBalance(username, newBalance, 'api_sync')
        updateResult.balance_updated = true
        updateResult.new_balance = newBalance
        updateResult.changes.push('balance_force_updated')
      }
    }

    await logSystemEvent(
      'INFO',
      'syncPrima789Data',
      `Prima789 sync result for ${username}`,
      {
        sync_result: updateResult,
        sync_type: syncType,
        force_update: forceUpdate,
      }
    )

    return updateResult
  } catch (error) {
    console.error('Sync Prima789 data error:', error)
    throw error
  }
}
