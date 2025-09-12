const {
  upsertPrima789Account,
  updateAccountBalance,
  createTransaction,
  createAccountLink,
  getLineUser,
  upsertLineUser,
  completeSocketSyncSession,
  getSocketSyncSession,
  logSystemEvent,
} = require('./utils/database')

// Webhook API Key from environment
const WEBHOOK_API_KEY = process.env.PRIMA789_WEBHOOK_API_KEY
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN

exports.handler = async (event, context) => {
  console.log('🔗 Transaction Webhook - Start')

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
    // Validate API key
    const providedApiKey =
      event.headers['x-api-key'] || event.headers['X-API-Key']

    if (
      !WEBHOOK_API_KEY ||
      !providedApiKey ||
      providedApiKey !== WEBHOOK_API_KEY
    ) {
      await logSystemEvent(
        'WARN',
        'transaction-webhook',
        'Unauthorized webhook access attempt',
        {
          provided_key: providedApiKey ? 'provided' : 'missing',
          ip: event.headers['x-forwarded-for'],
        }
      )

      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Unauthorized',
          message: 'Invalid API key',
        }),
      }
    }

    const webhookData = JSON.parse(event.body || '{}')
    console.log('📥 Webhook received:', {
      type: webhookData.transaction_type,
      user: webhookData.username,
      amount: webhookData.amount,
    })

    // Validate webhook data
    if (!webhookData.transaction_type || !webhookData.username) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Invalid webhook data',
          message: 'transaction_type and username are required',
        }),
      }
    }

    let result = {}

    switch (webhookData.transaction_type) {
      case 'user_login':
        result = await handleUserLogin(webhookData)
        break
      case 'data_sync':
        result = await handleDataSync(webhookData)
        break
      case 'deposit':
      case 'withdraw':
      case 'bet':
      case 'win':
      case 'bonus':
        result = await handleTransaction(webhookData)
        break
      case 'balance_update':
        result = await handleBalanceUpdate(webhookData)
        break
      default:
        result = await handleGenericTransaction(webhookData)
    }

    console.log(
      `✅ Webhook processed for ${webhookData.username}:`,
      result.success ? 'SUCCESS' : 'FAILED'
    )

    return {
      statusCode: result.success ? 200 : 400,
      headers,
      body: JSON.stringify(result),
    }
  } catch (error) {
    console.error('❌ Transaction Webhook Error:', error)

    await logSystemEvent(
      'ERROR',
      'transaction-webhook',
      `Webhook processing error: ${error.message}`,
      { error: error.message, stack: error.stack }
    )

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Internal server error',
        message: 'Failed to process webhook',
        details:
          process.env.NODE_ENV === 'development' ? error.message : undefined,
      }),
    }
  }
}

// Handle user login webhook
async function handleUserLogin(webhookData) {
  try {
    const { username, details = {} } = webhookData
    const userData = details.user_data || {}

    console.log(`🔐 Processing user login: ${username}`)

    // Update Prima789 account data
    const accountData = {
      username: username,
      mm_user: userData.mm_user || username,
      acc_no: userData.acc_no || userData.tel,
      bank_id: userData.bank_id,
      bank_name: userData.bank_name,
      first_name: userData.first_name,
      last_name: userData.last_name,
      tel: userData.tel || userData.acc_no,
      email: userData.email,
      available: parseFloat(userData.available) || 0,
      credit_limit: parseFloat(userData.credit_limit) || 0,
      bet_credit: parseFloat(userData.bet_credit) || 0,
      tier: userData.tier || 'Bronze',
      points: parseInt(userData.points) || 0,
      member_ref: userData.member_ref,
      register_time: userData.created_at || userData.registerTime,
      last_login: new Date().toISOString(),
    }

    const account = await upsertPrima789Account(accountData)

    // Create transaction record
    await createTransaction({
      transaction_id: webhookData.transaction_id,
      prima789_username: username,
      transaction_type: 'user_login',
      amount: 0,
      balance_after: parseFloat(userData.available) || 0,
      description: `User logged in to Prima789`,
      source: 'console_log',
      details: details,
    })

    // Check if there are any socket sync sessions waiting for this user
    await processSocketSyncForUser(username, userData)

    // Send LINE notification if linked
    await sendLineNotificationIfLinked(username, {
      type: 'login',
      message: `🔐 เข้าสู่ระบบ Prima789 สำเร็จ\nยอดเงิน: ฿${parseFloat(
        userData.available || 0
      ).toLocaleString()}`,
    })

    await logSystemEvent(
      'INFO',
      'handleUserLogin',
      `User login processed: ${username}`,
      { account_data: accountData }
    )

    return {
      success: true,
      message: 'User login processed successfully',
      account: {
        username: account.username,
        balance: parseFloat(account.available) || 0,
        tier: account.tier,
      },
    }
  } catch (error) {
    console.error('Handle user login error:', error)
    throw error
  }
}

// Handle data sync webhook
async function handleDataSync(webhookData) {
  try {
    const { username, details = {} } = webhookData
    const userData = details.user_data || {}

    console.log(`🔄 Processing data sync: ${username}`)

    // Update Prima789 account
    const accountData = {
      username: username,
      mm_user: userData.mm_user || username,
      available: parseFloat(userData.available) || 0,
      credit_limit: parseFloat(userData.credit_limit) || 0,
      bet_credit: parseFloat(userData.bet_credit) || 0,
      tier: userData.tier || 'Bronze',
      points: parseInt(userData.points) || 0,
      last_login: new Date().toISOString(),
    }

    // Only update non-null values
    Object.keys(accountData).forEach((key) => {
      if (
        accountData[key] === null ||
        accountData[key] === undefined ||
        accountData[key] === ''
      ) {
        delete accountData[key]
      }
    })

    const account = await upsertPrima789Account(accountData)

    // Create transaction record
    await createTransaction({
      transaction_id: webhookData.transaction_id,
      prima789_username: username,
      transaction_type: 'data_sync',
      amount: 0,
      balance_before: webhookData.balance_before,
      balance_after: parseFloat(userData.available) || 0,
      description: `Data synchronized from Prima789`,
      source: 'console_log',
      details: details,
    })

    await logSystemEvent(
      'INFO',
      'handleDataSync',
      `Data sync processed: ${username}`,
      { sync_data: userData }
    )

    return {
      success: true,
      message: 'Data sync processed successfully',
      account: {
        username: account.username,
        balance: parseFloat(account.available) || 0,
        tier: account.tier,
      },
    }
  } catch (error) {
    console.error('Handle data sync error:', error)
    throw error
  }
}

// Handle financial transactions (deposit, withdraw, bet, win, bonus)
async function handleTransaction(webhookData) {
  try {
    const {
      transaction_type,
      username,
      amount,
      balance_before,
      balance_after,
      details = {},
    } = webhookData

    console.log(
      `💰 Processing ${transaction_type}: ${username}, amount: ${amount}`
    )

    // Update account balance
    if (balance_after !== undefined && balance_after !== null) {
      await updateAccountBalance(username, balance_after, 'console_log')
    }

    // Create transaction record
    const transaction = await createTransaction({
      transaction_id: webhookData.transaction_id,
      prima789_username: username,
      transaction_type: transaction_type,
      amount: Math.abs(parseFloat(amount) || 0),
      balance_before: balance_before,
      balance_after: balance_after,
      description: getTransactionDescription(transaction_type, amount),
      source: 'console_log',
      details: details,
    })

    // Send LINE notification if linked
    await sendLineNotificationIfLinked(username, {
      type: transaction_type,
      amount: amount,
      balance: balance_after,
      message: formatTransactionMessage(
        transaction_type,
        amount,
        balance_after
      ),
    })

    await logSystemEvent(
      'INFO',
      'handleTransaction',
      `${transaction_type} processed: ${username}`,
      { transaction_type, amount, balance_after }
    )

    return {
      success: true,
      message: `${transaction_type} processed successfully`,
      transaction: {
        id: transaction.transaction_id,
        type: transaction_type,
        amount: Math.abs(parseFloat(amount) || 0),
        balance: balance_after,
      },
    }
  } catch (error) {
    console.error('Handle transaction error:', error)
    throw error
  }
}

// Handle balance update webhook
async function handleBalanceUpdate(webhookData) {
  try {
    const { username, balance_after } = webhookData

    console.log(
      `💰 Processing balance update: ${username}, new balance: ${balance_after}`
    )

    // Update account balance
    await updateAccountBalance(username, balance_after, 'console_log')

    // Create transaction record
    await createTransaction({
      transaction_id: webhookData.transaction_id,
      prima789_username: username,
      transaction_type: 'balance_update',
      amount: 0,
      balance_before: webhookData.balance_before,
      balance_after: balance_after,
      description: `Balance updated`,
      source: 'console_log',
      details: webhookData.details || {},
    })

    await logSystemEvent(
      'INFO',
      'handleBalanceUpdate',
      `Balance update processed: ${username}`,
      { new_balance: balance_after }
    )

    return {
      success: true,
      message: 'Balance update processed successfully',
      balance: balance_after,
    }
  } catch (error) {
    console.error('Handle balance update error:', error)
    throw error
  }
}

// Handle generic transaction
async function handleGenericTransaction(webhookData) {
  try {
    const { transaction_type, username } = webhookData

    console.log(
      `🔄 Processing generic transaction: ${transaction_type} for ${username}`
    )

    // Create transaction record
    const transaction = await createTransaction({
      transaction_id: webhookData.transaction_id,
      prima789_username: username,
      transaction_type: transaction_type,
      amount: parseFloat(webhookData.amount) || 0,
      balance_before: webhookData.balance_before,
      balance_after: webhookData.balance_after,
      description: webhookData.description || `${transaction_type} transaction`,
      source: 'console_log',
      details: webhookData.details || {},
    })

    await logSystemEvent(
      'INFO',
      'handleGenericTransaction',
      `Generic transaction processed: ${transaction_type} for ${username}`,
      { transaction_type, username }
    )

    return {
      success: true,
      message: `${transaction_type} processed successfully`,
      transaction: {
        id: transaction.transaction_id,
        type: transaction_type,
      },
    }
  } catch (error) {
    console.error('Handle generic transaction error:', error)
    throw error
  }
}

// Process socket sync for user (if any waiting sessions)
async function processSocketSyncForUser(username, userData) {
  try {
    // This is a simplified implementation
    // In a real system, you might need to maintain a mapping between Prima789 users and sync sessions
    console.log(`Checking socket sync sessions for ${username}`)

    await logSystemEvent(
      'DEBUG',
      'processSocketSyncForUser',
      `Checking socket sync for ${username}`,
      { username, user_data: userData }
    )

    // TODO: Implement actual socket sync session matching logic
    // For now, just log the event
  } catch (error) {
    console.error('Process socket sync error:', error)
  }
}

// Send LINE notification if account is linked
async function sendLineNotificationIfLinked(
  prima789Username,
  notificationData
) {
  try {
    if (!LINE_CHANNEL_ACCESS_TOKEN) {
      console.log(
        'LINE Channel Access Token not configured, skipping notification'
      )
      return
    }

    // TODO: Implement LINE notification sending
    // This would require finding linked LINE users and sending messages

    console.log(
      `📱 Would send LINE notification for ${prima789Username}:`,
      notificationData
    )

    await logSystemEvent(
      'DEBUG',
      'sendLineNotificationIfLinked',
      `Notification queued for ${prima789Username}`,
      { notification: notificationData }
    )
  } catch (error) {
    console.error('Send LINE notification error:', error)
  }
}

// Helper functions
function getTransactionDescription(type, amount) {
  const absAmount = Math.abs(parseFloat(amount) || 0)

  switch (type) {
    case 'deposit':
      return `ฝากเงิน ฿${absAmount.toLocaleString()}`
    case 'withdraw':
      return `ถอนเงิน ฿${absAmount.toLocaleString()}`
    case 'bet':
      return `วางเดิมพัน ฿${absAmount.toLocaleString()}`
    case 'win':
      return `ชนะเดิมพัน ฿${absAmount.toLocaleString()}`
    case 'bonus':
      return `โบนัส ฿${absAmount.toLocaleString()}`
    default:
      return `ธุรกรรม ${type}`
  }
}

function formatTransactionMessage(type, amount, balance) {
  const absAmount = Math.abs(parseFloat(amount) || 0)
  const balanceFormatted = parseFloat(balance || 0).toLocaleString()

  const icons = {
    deposit: '💰',
    withdraw: '💸',
    bet: '🎲',
    win: '🏆',
    bonus: '🎁',
  }

  const icon = icons[type] || '📊'
  const description = getTransactionDescription(type, amount)

  return `${icon} ${description}\nยอดคงเหลือ: ฿${balanceFormatted}`
}
