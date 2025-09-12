const {
  checkUserLinking,
  getPrima789Account,
  getUserTransactions,
  getUserStats,
  logSystemEvent,
} = require('./utils/database')

exports.handler = async (event, context) => {
  console.log('💰 Balance Inquiry - Start')

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
    let lineUserId = null
    let requestType = 'balance' // 'balance', 'full', 'transactions'
    let limit = 10

    // Get parameters from query string or request body
    if (event.httpMethod === 'GET') {
      lineUserId = event.queryStringParameters?.lineUserId
      requestType = event.queryStringParameters?.type || 'balance'
      limit = parseInt(event.queryStringParameters?.limit) || 10
    } else if (event.httpMethod === 'POST') {
      const requestData = JSON.parse(event.body || '{}')
      lineUserId = requestData.lineUserId
      requestType = requestData.requestType || requestData.type || 'balance'
      limit = requestData.limit || 10
    }

    if (!lineUserId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'LINE User ID is required',
          message: 'Please provide lineUserId parameter',
        }),
      }
    }

    console.log(
      `Processing balance inquiry for ${lineUserId}, type: ${requestType}`
    )

    // Check if user is linked
    const linkingInfo = await checkUserLinking(lineUserId)

    if (!linkingInfo) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'User not found',
          message: 'LINE user not found in system',
        }),
      }
    }

    if (!linkingInfo.is_linked || !linkingInfo.prima789_username) {
      await logSystemEvent(
        'INFO',
        'balance-inquiry',
        `Balance inquiry for unlinked user: ${lineUserId}`,
        { is_linked: false },
        lineUserId
      )

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: false,
          isLinked: false,
          message:
            'บัญชียังไม่ได้เชื่อมโยง กรุณาเชื่อมโยงบัญชี Prima789 ก่อนใช้งาน',
        }),
      }
    }

    const prima789Username = linkingInfo.prima789_username

    // Get Prima789 account details
    const account = await getPrima789Account(prima789Username)

    if (!account) {
      await logSystemEvent(
        'ERROR',
        'balance-inquiry',
        `Prima789 account not found: ${prima789Username}`,
        { prima789_username: prima789Username },
        lineUserId
      )

      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Prima789 account not found',
          message: 'ไม่พบบัญชี Prima789 ที่เชื่อมโยง',
        }),
      }
    }

    let responseData = {
      success: true,
      isLinked: true,
      user: {
        line_user_id: linkingInfo.line_user_id,
        display_name: linkingInfo.display_name,
        prima789_username: prima789Username,
        linked_at: linkingInfo.linked_at,
        link_method: linkingInfo.link_method,
      },
    }

    // Basic balance information (always included)
    responseData.balance = {
      available: parseFloat(account.available) || 0,
      credit_limit: parseFloat(account.credit_limit) || 0,
      bet_credit: parseFloat(account.bet_credit) || 0,
      tier: account.tier || 'Bronze',
      points: parseInt(account.points) || 0,
      last_updated: account.updated_at,
    }

    // Include additional information based on request type
    if (requestType === 'full') {
      // Full account information
      responseData.account = {
        username: account.username,
        display_name:
          account.first_name && account.last_name
            ? `${account.first_name} ${account.last_name}`
            : account.username,
        first_name: account.first_name,
        last_name: account.last_name,
        tel: account.tel,
        email: account.email,
        bank_name: account.bank_name,
        bank_id: account.bank_id,
        acc_no: account.acc_no,
        total_transactions: parseInt(account.total_transactions) || 0,
        member_since: account.register_time,
        last_login: account.last_login,
        created_at: account.created_at,
        updated_at: account.updated_at,
      }

      // Get user statistics
      const stats = await getUserStats(lineUserId)
      responseData.statistics = {
        total_transactions: parseInt(stats.total_transactions) || 0,
        total_income_transactions:
          parseInt(stats.total_income_transactions) || 0,
        total_expense_transactions:
          parseInt(stats.total_expense_transactions) || 0,
        total_income: parseFloat(stats.total_income) || 0,
        total_expenses: parseFloat(stats.total_expenses) || 0,
        last_transaction_date: stats.last_transaction_date,
      }
    }

    if (requestType === 'transactions' || requestType === 'full') {
      // Recent transactions
      const transactions = await getUserTransactions(lineUserId, limit)
      responseData.recent_transactions = transactions.map((tx) => ({
        transaction_id: tx.transaction_id,
        transaction_type: tx.transaction_type,
        amount: parseFloat(tx.amount) || 0,
        balance_before: parseFloat(tx.balance_before),
        balance_after: parseFloat(tx.balance_after),
        description: tx.description,
        source: tx.source,
        created_at: tx.created_at,
        processed_at: tx.processed_at,
      }))
    }

    // Calculate tier progress
    responseData.tier_progress = calculateTierProgress(
      account.tier,
      account.points
    )

    // Add formatted display values
    responseData.display = {
      balance_formatted: `฿${parseFloat(
        account.available || 0
      ).toLocaleString()}`,
      credit_formatted: `฿${parseFloat(
        account.credit_limit || 0
      ).toLocaleString()}`,
      points_formatted: parseInt(account.points || 0).toLocaleString(),
      tier_display: getTierDisplayInfo(account.tier),
      last_updated_relative: getRelativeTime(account.updated_at),
    }

    await logSystemEvent(
      'INFO',
      'balance-inquiry',
      `Balance inquiry successful: ${lineUserId} -> ${prima789Username}`,
      {
        request_type: requestType,
        balance: parseFloat(account.available || 0),
        tier: account.tier,
      },
      lineUserId
    )

    console.log(
      `✅ Balance inquiry complete for ${lineUserId}: ฿${parseFloat(
        account.available || 0
      ).toLocaleString()}`
    )

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(responseData),
    }
  } catch (error) {
    console.error('❌ Balance Inquiry Error:', error)

    await logSystemEvent(
      'ERROR',
      'balance-inquiry',
      `Balance inquiry error: ${error.message}`,
      { error: error.message, stack: error.stack }
    )

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Internal server error',
        message: 'Failed to retrieve balance information',
        details:
          process.env.NODE_ENV === 'development' ? error.message : undefined,
      }),
    }
  }
}

// Helper functions
function calculateTierProgress(currentTier, currentPoints) {
  const tierLevels = {
    Bronze: { min: 0, max: 1000, next: 'Silver' },
    Silver: { min: 1000, max: 5000, next: 'Gold' },
    Gold: { min: 5000, max: 20000, next: 'Platinum' },
    Platinum: { min: 20000, max: 50000, next: 'Diamond' },
    Diamond: { min: 50000, max: 100000, next: null },
  }

  const current = tierLevels[currentTier] || tierLevels['Bronze']
  const points = parseInt(currentPoints) || 0

  const progress = Math.min(
    (points - current.min) / (current.max - current.min),
    1
  )
  const pointsNeeded = current.next ? Math.max(current.max - points, 0) : 0

  return {
    current_tier: currentTier,
    current_points: points,
    progress_percentage: Math.round(progress * 100),
    points_needed_for_next: pointsNeeded,
    next_tier: current.next,
    tier_min_points: current.min,
    tier_max_points: current.max,
  }
}

function getTierDisplayInfo(tier) {
  const tierInfo = {
    Bronze: {
      color: '#CD7F32',
      icon: '🥉',
      name: 'สมาชิกทองแดง',
      benefits: ['โบนัสต้อนรับ', 'รายการโปรโมชั่นพื้นฐาน'],
    },
    Silver: {
      color: '#C0C0C0',
      icon: '🥈',
      name: 'สมาชิกเงิน',
      benefits: ['โบนัสฝากเงินพิเศษ', 'แคชแบครายสัปดาห์', 'ลอตเตอรี่ฟรี'],
    },
    Gold: {
      color: '#FFD700',
      icon: '🥇',
      name: 'สมาชิกทอง',
      benefits: [
        'โบนัสสูงสุด 50%',
        'แคshแบครายวัน',
        'เครดิตฟรี',
        'ของรางวัลพิเศษ',
      ],
    },
    Platinum: {
      color: '#E5E4E2',
      icon: '💎',
      name: 'สมาชิกแพลตตินัม',
      benefits: [
        'Account Manager เฉพาะ',
        'โบนัสไม่อั้น',
        'Fast Track ถอนเงิน',
        'ทัวร์นาเม้นต์พิเศษ',
      ],
    },
    Diamond: {
      color: '#B9F2FF',
      icon: '💠',
      name: 'สมาชิกเพชร',
      benefits: [
        'VIP Treatment',
        'เครดิตไม่อั้น',
        'ของรางวัลเอ็กซ์คลูซีฟ',
        'งานปาร์ตี้ VIP',
      ],
    },
  }

  return tierInfo[tier] || tierInfo['Bronze']
}

function getRelativeTime(dateString) {
  if (!dateString) return 'ไม่ทราบ'

  const now = new Date()
  const date = new Date(dateString)
  const diffMs = now - date
  const diffMins = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMins < 1) return 'เมื่อสักครู่'
  if (diffMins < 60) return `${diffMins} นาทีที่แล้ว`
  if (diffHours < 24) return `${diffHours} ชั่วโมงที่แล้ว`
  if (diffDays < 30) return `${diffDays} วันที่แล้ว`

  return date.toLocaleDateString('th-TH', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}
