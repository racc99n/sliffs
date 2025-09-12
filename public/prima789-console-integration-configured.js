/**
 * Prima789 Console Integration Script - PRODUCTION CONFIGURED
 * Version: 3.2.0 - Fully Configured Edition
 *
 * ✅ Pre-configured with real API endpoints
 * ✅ Enhanced data detection algorithms
 * ✅ Advanced error handling & retry logic
 * ✅ Real-time sync with LINE Member Card System
 */

;(function () {
  'use strict'

  // ✅ PRODUCTION CONFIGURATION - FULLY CONFIGURED
  const CONFIG = {
    WEBHOOK_URL:
      'https://sliffs.netlify.app/.netlify/functions/transaction-webhook',
    API_KEY: 'PRIMA789_f1922de52a8e5c6bf5b4777dabeff027',
    DEBUG: true,
    VERSION: '3.2.0-production-configured',
    RETRY_ATTEMPTS: 5,
    RETRY_DELAY: 1500,
    QUEUE_MAX_SIZE: 200,
    HEARTBEAT_INTERVAL: 25000,
    QUEUE_PROCESS_INTERVAL: 800,

    // ✅ Enhanced console keywords detection
    CONSOLE_KEYWORDS: [
      'login customer_data',
      'customer_data',
      'member_data',
      'user_data',
      'login_data',
      'customer_req_info',
      'credit_push',
      'balance_update',
      'account_info',
      'user_info',
      'member_info',
      'prima789_user',
      'mm_user',
      'available',
      'aukprima',
      'deposit',
      'withdrawal',
      'transaction',
      'bet_credit',
      'acc_no',
      'bank_name',
    ],

    // ✅ Advanced data patterns
    DATA_PATTERNS: [
      /login\s+customer_data/i,
      /customer_data.*object/i,
      /mm_user.*aukprima/i,
      /available.*\d+/i,
      /credit_push.*\d+/i,
      /balance.*\d+\.\d+/i,
      /transaction.*id/i,
    ],

    // ✅ Smart notification settings
    NOTIFICATIONS: {
      ENABLED: true,
      DURATION: 4000,
      POSITION: 'top-right',
      SHOW_SUCCESS: true,
      SHOW_ERRORS: true,
    },
  }

  // Global state management
  let currentUser = null
  let lastBalance = null
  let transactionQueue = []
  let isProcessing = false
  let isInitialized = false
  let sessionId = null
  let heartbeatInterval = null
  let queueProcessInterval = null
  let statsCollector = {
    totalTransactions: 0,
    successfulSyncs: 0,
    errors: 0,
    startTime: Date.now(),
  }

  // Original console functions backup
  const originalConsole = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug
      ? console.debug.bind(console)
      : console.log.bind(console),
  }

  // Enhanced logging system
  function log(level, message, data = null) {
    if (!CONFIG.DEBUG && level === 'DEBUG') return

    const timestamp = new Date().toISOString()
    const icon = getLogIcon(level)
    const prefix = `[Prima789-Console-v${CONFIG.VERSION}] ${timestamp}: ${icon}`

    if (originalConsole[level.toLowerCase()]) {
      originalConsole[level.toLowerCase()](prefix, message, data || '')
    } else {
      originalConsole.log(prefix, message, data || '')
    }

    // Update stats
    if (level === 'ERROR') statsCollector.errors++
  }

  function getLogIcon(level) {
    const icons = {
      DEBUG: '🔍',
      INFO: '✅',
      WARN: '⚠️',
      ERROR: '❌',
      SUCCESS: '🎉',
    }
    return icons[level] || '📝'
  }

  // ✅ ENHANCED Console Interceptor with Smart Detection
  function initConsoleInterceptor() {
    try {
      // Override all console methods
      ;['log', 'info', 'warn', 'error', 'debug'].forEach((method) => {
        console[method] = function (...args) {
          // Always call original first
          originalConsole[method].apply(console, args)

          // Smart detection and processing
          interceptConsoleMessage(method, args)
        }
      })

      log('INFO', '🚀 Enhanced console interceptor initialized')
      return true
    } catch (error) {
      log('ERROR', '❌ Failed to initialize console interceptor:', error)
      return false
    }
  }

  // ✅ SMART Console Message Detection
  function interceptConsoleMessage(type, args) {
    try {
      const fullMessage = args
        .map((arg) =>
          typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
        )
        .join(' ')

      // Method 1: Keyword detection
      const hasKeyword = CONFIG.CONSOLE_KEYWORDS.some((keyword) =>
        fullMessage.toLowerCase().includes(keyword.toLowerCase())
      )

      // Method 2: Pattern detection
      const matchesPattern = CONFIG.DATA_PATTERNS.some((pattern) =>
        pattern.test(fullMessage)
      )

      // Method 3: Object analysis
      const hasRelevantObject = args.some(
        (arg) =>
          typeof arg === 'object' && arg !== null && isCustomerDataObject(arg)
      )

      if (hasKeyword || matchesPattern || hasRelevantObject) {
        log('INFO', `🎯 Smart detection triggered: ${type}`, {
          keyword: hasKeyword,
          pattern: matchesPattern,
          object: hasRelevantObject,
        })
        processConsoleData(args, type, fullMessage)
      }
    } catch (error) {
      log('ERROR', 'Error in console message interception:', error)
    }
  }

  // ✅ ADVANCED Data Processing Engine
  function processConsoleData(args, consoleType, fullMessage) {
    try {
      log('INFO', '🔄 Processing console data with advanced algorithms')

      let extractedData = null

      // Strategy 1: Direct object analysis
      for (const arg of args) {
        if (typeof arg === 'object' && arg !== null) {
          const customerData = extractCustomerDataFromObject(arg)
          if (customerData) {
            extractedData = customerData
            break
          }
        }
      }

      // Strategy 2: String parsing with multiple techniques
      if (!extractedData) {
        extractedData = extractCustomerDataFromString(fullMessage)
      }

      // Strategy 3: Pattern-based extraction
      if (!extractedData) {
        extractedData = extractDataUsingPatterns(fullMessage)
      }

      // Strategy 4: Context-aware extraction
      if (!extractedData) {
        extractedData = extractDataFromContext(args, consoleType)
      }

      if (extractedData) {
        log(
          'SUCCESS',
          '📋 Successfully extracted customer data:',
          extractedData
        )
        handleCustomerData(extractedData, `console_${consoleType}`)
        statsCollector.successfulSyncs++
      } else {
        log('DEBUG', '🔍 No relevant data found in console message')
      }
    } catch (error) {
      log('ERROR', '❌ Error processing console data:', error)
      statsCollector.errors++
    }
  }

  // ✅ ENHANCED Customer Data Object Detection
  function isCustomerDataObject(obj) {
    if (!obj || typeof obj !== 'object') return false

    // Prima789 specific fields (high confidence)
    const highConfidenceFields = [
      'mm_user',
      'aukprima',
      'prima',
      'user_id',
      'member_id',
      'acc_no',
      'bank_name',
      'available',
      'credit_limit',
      'bet_credit',
    ]

    // General customer fields (medium confidence)
    const mediumConfidenceFields = [
      'first_name',
      'last_name',
      'tel',
      'email',
      'phone',
      'balance',
      'credit',
      'amount',
      'transaction_id',
    ]

    // Count field matches
    const highMatches = highConfidenceFields.filter((field) =>
      hasFieldInObject(obj, field)
    ).length
    const mediumMatches = mediumConfidenceFields.filter((field) =>
      hasFieldInObject(obj, field)
    ).length

    // Advanced scoring system
    const score = highMatches * 3 + mediumMatches * 1
    const isRelevant = score >= 4 || highMatches >= 2

    if (isRelevant) {
      log(
        'DEBUG',
        `📊 Object relevance score: ${score} (high: ${highMatches}, medium: ${mediumMatches})`
      )
    }

    return isRelevant
  }

  // Check if field exists in object (including nested)
  function hasFieldInObject(obj, field) {
    if (obj.hasOwnProperty(field)) return true

    // Check nested objects
    for (const key in obj) {
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        if (hasFieldInObject(obj[key], field)) return true
      }
    }

    // Check string values for partial matches
    for (const key in obj) {
      if (
        typeof obj[key] === 'string' &&
        obj[key].toLowerCase().includes(field.toLowerCase())
      ) {
        return true
      }
    }

    return false
  }

  // ✅ Extract customer data from object
  function extractCustomerDataFromObject(obj) {
    const extracted = {}

    // Direct field mapping
    const fieldMappings = {
      mm_user: ['mm_user', 'username', 'user_id', 'login', 'member_id'],
      acc_no: ['acc_no', 'account_no', 'phone', 'tel', 'mobile'],
      first_name: ['first_name', 'fname', 'firstname', 'name'],
      last_name: ['last_name', 'lname', 'lastname'],
      available: ['available', 'balance', 'current_balance', 'amount'],
      credit_limit: ['credit_limit', 'limit', 'max_credit'],
      bet_credit: ['bet_credit', 'credit', 'betting_credit'],
      bank_name: ['bank_name', 'bank', 'bank_info'],
      bank_id: ['bank_id', 'bankId'],
      created_at: ['created_at', 'register_date', 'reg_date'],
      registerTime: ['registerTime', 'register_time'],
      email: ['email', 'e_mail', 'mail'],
      member_ref: ['member_ref', 'ref', 'reference'],
    }

    // Extract using mappings
    Object.keys(fieldMappings).forEach((targetField) => {
      const sourceFields = fieldMappings[targetField]

      for (const sourceField of sourceFields) {
        const value = getValueFromObject(obj, sourceField)
        if (value !== null && value !== undefined) {
          extracted[targetField] = value
          break
        }
      }
    })

    // Special handling for aukprima users
    const userString = JSON.stringify(obj).toLowerCase()
    if (userString.includes('aukprima')) {
      const match = userString.match(/aukprima\d+/)
      if (match && !extracted.mm_user) {
        extracted.mm_user = match[0]
      }
    }

    // Validate extracted data
    const hasMinimumData =
      extracted.mm_user || extracted.acc_no || extracted.available
    return hasMinimumData ? extracted : null
  }

  // Get value from object (including nested)
  function getValueFromObject(obj, field) {
    // Direct access
    if (obj.hasOwnProperty(field)) {
      return obj[field]
    }

    // Case-insensitive search
    const keys = Object.keys(obj)
    const matchingKey = keys.find(
      (key) => key.toLowerCase() === field.toLowerCase()
    )
    if (matchingKey) {
      return obj[matchingKey]
    }

    // Search in nested objects
    for (const key in obj) {
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        const nestedValue = getValueFromObject(obj[key], field)
        if (nestedValue !== null) return nestedValue
      }
    }

    return null
  }

  // ✅ Extract customer data from string with multiple techniques
  function extractCustomerDataFromString(text) {
    const extracted = {}

    try {
      // Technique 1: JSON extraction
      const jsonMatches = text.match(/\{[^{}]*\}/g)
      if (jsonMatches) {
        for (const jsonStr of jsonMatches) {
          try {
            const parsed = JSON.parse(jsonStr)
            const objectData = extractCustomerDataFromObject(parsed)
            if (objectData) {
              Object.assign(extracted, objectData)
            }
          } catch (e) {
            // Not valid JSON, continue
          }
        }
      }

      // Technique 2: Key-value pair extraction
      const patterns = [
        /(\w+):\s*"([^"]+)"/g, // "field": "value"
        /(\w+):\s*(\d+(?:\.\d+)?)/g, // field: 123.45
        /(\w+)=([^,\s}]+)/g, // field=value
        /(\w+)\s*:\s*([^,}]+)/g, // field: value
      ]

      patterns.forEach((pattern) => {
        let match
        while ((match = pattern.exec(text)) !== null) {
          const [, key, value] = match
          if (isRelevantField(key)) {
            extracted[key] = isNaN(value) ? value.trim() : parseFloat(value)
          }
        }
      })

      // Technique 3: Specific pattern matching
      const specificPatterns = {
        mm_user: /(?:mm_user|username|aukprima\w*)[:=]\s*"?([a-zA-Z0-9_]+)"?/i,
        available: /(?:available|balance)[:=]\s*"?([0-9.,]+)"?/i,
        acc_no: /(?:acc_no|phone|tel)[:=]\s*"?([0-9-]+)"?/i,
        bank_name: /(?:bank_name|bank)[:=]\s*"?([^"',}]+)"?/i,
      }

      Object.keys(specificPatterns).forEach((field) => {
        const match = text.match(specificPatterns[field])
        if (match) {
          extracted[field] =
            field === 'available'
              ? parseFloat(match[1].replace(',', ''))
              : match[1]
        }
      })
    } catch (error) {
      log('ERROR', 'Error extracting data from string:', error)
    }

    return Object.keys(extracted).length > 0 ? extracted : null
  }

  // ✅ Pattern-based data extraction
  function extractDataUsingPatterns(text) {
    const extracted = {}

    // Advanced regex patterns for Prima789
    const advancedPatterns = [
      {
        pattern: /login\s+customer_data.*?aukprima(\d+)/i,
        handler: (match) => ({ mm_user: `aukprima${match[1]}` }),
      },
      {
        pattern: /credit_push.*?(\d+(?:\.\d+)?)/i,
        handler: (match) => ({ available: parseFloat(match[1]) }),
      },
      {
        pattern: /balance.*?(\d+\.\d+)/i,
        handler: (match) => ({ available: parseFloat(match[1]) }),
      },
      {
        pattern: /transaction.*?id[^a-zA-Z0-9]*([a-zA-Z0-9_]+)/i,
        handler: (match) => ({ transaction_id: match[1] }),
      },
    ]

    advancedPatterns.forEach(({ pattern, handler }) => {
      const match = text.match(pattern)
      if (match) {
        try {
          const result = handler(match)
          Object.assign(extracted, result)
        } catch (error) {
          log('ERROR', 'Error in pattern handler:', error)
        }
      }
    })

    return Object.keys(extracted).length > 0 ? extracted : null
  }

  // ✅ Context-aware data extraction
  function extractDataFromContext(args, consoleType) {
    // Analyze context clues
    const context = {
      hasUserKeyword: args.some(
        (arg) =>
          String(arg).toLowerCase().includes('user') ||
          String(arg).toLowerCase().includes('customer') ||
          String(arg).toLowerCase().includes('member')
      ),
      hasBalanceKeyword: args.some(
        (arg) =>
          String(arg).toLowerCase().includes('balance') ||
          String(arg).toLowerCase().includes('available') ||
          String(arg).toLowerCase().includes('credit')
      ),
      consoleType: consoleType,
    }

    // Context-based extraction rules
    if (context.hasUserKeyword || context.hasBalanceKeyword) {
      return extractDataFromMixedArgs(args)
    }

    return null
  }

  // Extract data from mixed arguments
  function extractDataFromMixedArgs(args) {
    const extracted = {}

    args.forEach((arg, index) => {
      if (typeof arg === 'string') {
        // Look for aukprima pattern
        const userMatch = arg.match(/aukprima\d+/i)
        if (userMatch) {
          extracted.mm_user = userMatch[0]
        }

        // Look for balance pattern
        const balanceMatch = arg.match(/\d+\.\d+/)
        if (balanceMatch) {
          extracted.available = parseFloat(balanceMatch[0])
        }
      } else if (typeof arg === 'number') {
        // If it's a reasonable balance amount
        if (arg > 0 && arg < 1000000) {
          extracted.available = arg
        }
      }
    })

    return Object.keys(extracted).length > 0 ? extracted : null
  }

  // Check if field name is relevant
  function isRelevantField(fieldName) {
    const relevantFields = [
      'mm_user',
      'username',
      'user_id',
      'acc_no',
      'available',
      'balance',
      'credit',
      'first_name',
      'last_name',
      'bank_name',
      'tel',
      'phone',
      'email',
      'transaction_id',
      'amount',
    ]

    return relevantFields.some((field) =>
      fieldName.toLowerCase().includes(field.toLowerCase())
    )
  }

  // ✅ ADVANCED Customer Data Handler
  function handleCustomerData(customerData, source) {
    try {
      log('INFO', '🔄 Processing customer data with advanced handler:', {
        customerData,
        source,
      })

      // Normalize and validate data
      const normalizedData = normalizeCustomerData(customerData)

      if (!normalizedData.mm_user && !normalizedData.acc_no) {
        log('WARN', '⚠️ No user identifier found in data')
        return
      }

      // Smart user detection
      const userId =
        normalizedData.mm_user || normalizedData.acc_no || 'unknown'
      const isNewUser = !currentUser || currentUser.mm_user !== userId

      if (isNewUser) {
        log('SUCCESS', '👤 New user detected:', userId)
        currentUser = normalizedData
        handleUserLogin(normalizedData, source)

        // Show notification for new user
        if (CONFIG.NOTIFICATIONS.ENABLED) {
          showSmartNotification(`เชื่อมต่อผู้ใช้ใหม่: ${userId}`, 'success')
        }
      } else {
        // Update existing user data
        currentUser = { ...currentUser, ...normalizedData }
        log('INFO', '🔄 Updated existing user data')
      }

      // Smart balance detection
      if (normalizedData.available !== undefined) {
        handleBalanceUpdate(normalizedData.available, source)
      }

      // Send comprehensive sync data
      sendAdvancedSyncData(normalizedData, source)

      statsCollector.totalTransactions++
    } catch (error) {
      log('ERROR', '❌ Error in advanced customer data handler:', error)
      statsCollector.errors++
    }
  }

  // ✅ Enhanced data normalization
  function normalizeCustomerData(rawData) {
    const normalized = {}

    // Advanced field mapping with priority
    const fieldMappings = {
      mm_user: {
        sources: ['mm_user', 'username', 'user_id', 'login', 'member_id'],
        transform: (value) => String(value).toLowerCase(),
      },
      acc_no: {
        sources: ['acc_no', 'account_no', 'phone', 'tel', 'mobile'],
        transform: (value) => String(value).replace(/[^\d-]/g, ''),
      },
      first_name: {
        sources: ['first_name', 'fname', 'firstname'],
        transform: (value) => String(value).trim(),
      },
      last_name: {
        sources: ['last_name', 'lname', 'lastname'],
        transform: (value) => String(value).trim(),
      },
      available: {
        sources: ['available', 'balance', 'current_balance', 'amount'],
        transform: (value) => parseFloat(value) || 0,
      },
      credit_limit: {
        sources: ['credit_limit', 'limit', 'max_credit'],
        transform: (value) => parseFloat(value) || 0,
      },
      bet_credit: {
        sources: ['bet_credit', 'credit', 'betting_credit'],
        transform: (value) => parseFloat(value) || 0,
      },
      bank_name: {
        sources: ['bank_name', 'bank', 'bank_info'],
        transform: (value) => String(value).trim(),
      },
    }

    // Apply mappings with transforms
    Object.keys(fieldMappings).forEach((targetField) => {
      const config = fieldMappings[targetField]

      for (const sourceField of config.sources) {
        const value = getValueFromObject(rawData, sourceField)
        if (value !== null && value !== undefined) {
          try {
            normalized[targetField] = config.transform(value)
            break
          } catch (error) {
            log('WARN', `Transform error for ${targetField}:`, error)
          }
        }
      }
    })

    // Copy unmapped relevant fields
    Object.keys(rawData).forEach((key) => {
      if (!normalized.hasOwnProperty(key) && isRelevantField(key)) {
        normalized[key] = rawData[key]
      }
    })

    return normalized
  }

  // ✅ Advanced user login handler
  function handleUserLogin(userData, source) {
    const loginTransaction = {
      transaction_type: 'user_login',
      user_id: userData.mm_user || userData.acc_no,
      username: userData.mm_user || userData.acc_no,
      amount: 0,
      balance_before: null,
      balance_after: parseFloat(userData.available) || 0,
      transaction_id: generateTransactionId('login'),
      timestamp: new Date().toISOString(),
      details: {
        source: source,
        session_id: sessionId,
        user_data: userData,
        detection_confidence: calculateDetectionConfidence(userData),
        browser_info: {
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          language: navigator.language,
        },
      },
    }

    queueTransaction(loginTransaction)
    log('SUCCESS', '🎉 User login transaction created')
  }

  // ✅ Smart balance update handler
  function handleBalanceUpdate(newBalance, source) {
    try {
      const balance = parseFloat(newBalance)

      if (isNaN(balance)) {
        log('WARN', '⚠️ Invalid balance value:', newBalance)
        return
      }

      if (lastBalance !== null && Math.abs(lastBalance - balance) >= 0.01) {
        const amount = balance - lastBalance
        const transactionType = amount > 0 ? 'deposit' : 'withdrawal'

        const balanceTransaction = {
          transaction_type: transactionType,
          user_id: currentUser?.mm_user || 'unknown',
          username: currentUser?.mm_user || 'unknown',
          amount: Math.abs(amount),
          balance_before: lastBalance,
          balance_after: balance,
          transaction_id: generateTransactionId(amount > 0 ? 'dep' : 'wd'),
          timestamp: new Date().toISOString(),
          details: {
            source: source,
            session_id: sessionId,
            change_amount: amount,
            change_percentage: ((amount / lastBalance) * 100).toFixed(2),
            user_data: currentUser,
          },
        }

        queueTransaction(balanceTransaction)

        // Show balance change notification
        if (CONFIG.NOTIFICATIONS.ENABLED && Math.abs(amount) >= 1) {
          const formattedAmount = formatCurrency(Math.abs(amount))
          const message = `${
            transactionType === 'deposit' ? '💰 เงินเข้า' : '💸 เงินออก'
          }: ${formattedAmount}`
          showSmartNotification(
            message,
            transactionType === 'deposit' ? 'success' : 'info'
          )
        }

        log('SUCCESS', `💰 Balance ${transactionType}:`, { amount, balance })
      }

      lastBalance = balance
    } catch (error) {
      log('ERROR', '❌ Error handling balance update:', error)
    }
  }

  // ✅ Send advanced sync data
  function sendAdvancedSyncData(userData, source) {
    const syncTransaction = {
      transaction_type: 'data_sync',
      user_id: userData.mm_user || userData.acc_no,
      username: userData.mm_user || userData.acc_no,
      amount: 0,
      balance_before: lastBalance,
      balance_after: parseFloat(userData.available) || lastBalance || 0,
      transaction_id: generateTransactionId('sync'),
      timestamp: new Date().toISOString(),
      details: {
        source: source,
        session_id: sessionId,
        user_data: userData,
        sync_timestamp: new Date().toISOString(),
        detection_method: 'console_interception',
        data_quality: calculateDataQuality(userData),
        version: CONFIG.VERSION,
      },
    }

    queueTransaction(syncTransaction)
    log('INFO', '📡 Advanced sync data queued')
  }

  // Calculate detection confidence score
  function calculateDetectionConfidence(userData) {
    let score = 0
    const maxScore = 100

    if (userData.mm_user) score += 30
    if (userData.available !== undefined) score += 25
    if (userData.acc_no) score += 20
    if (userData.first_name) score += 10
    if (userData.bank_name) score += 10
    if (userData.created_at) score += 5

    return Math.min(score, maxScore)
  }

  // Calculate data quality score
  function calculateDataQuality(userData) {
    const totalFields = Object.keys(userData).length
    const filledFields = Object.values(userData).filter(
      (value) => value !== null && value !== undefined && value !== ''
    ).length

    return Math.round((filledFields / totalFields) * 100)
  }

  // ✅ Enhanced transaction ID generation
  function generateTransactionId(prefix = 'txn') {
    const timestamp = Date.now()
    const random = Math.random().toString(36).substr(2, 6)
    const session = sessionId ? sessionId.substr(-4) : '0000'
    return `${prefix}_${timestamp}_${random}_${session}`
  }

  // ✅ SMART Transaction Queue System
  function queueTransaction(transactionData) {
    try {
      // Queue size management
      if (transactionQueue.length >= CONFIG.QUEUE_MAX_SIZE) {
        log('WARN', '⚠️ Queue full, removing oldest transaction')
        const removed = transactionQueue.shift()
        log('DEBUG', 'Removed transaction:', removed.transaction_type)
      }

      // Add metadata
      transactionData._queued_at = Date.now()
      transactionData._attempts = 0
      transactionData._priority = getTransactionPriority(
        transactionData.transaction_type
      )

      transactionQueue.push(transactionData)

      // Sort by priority
      transactionQueue.sort((a, b) => b._priority - a._priority)

      log(
        'INFO',
        `📝 Transaction queued: ${transactionData.transaction_type} (Queue: ${transactionQueue.length})`
      )

      // Start processing if not already running
      if (!isProcessing && !queueProcessInterval) {
        startQueueProcessor()
      }
    } catch (error) {
      log('ERROR', '❌ Error queueing transaction:', error)
    }
  }

  // Get transaction priority
  function getTransactionPriority(transactionType) {
    const priorities = {
      user_login: 10,
      deposit: 8,
      withdrawal: 8,
      data_sync: 5,
      heartbeat: 1,
    }
    return priorities[transactionType] || 3
  }

  // ✅ Start smart queue processor
  function startQueueProcessor() {
    if (queueProcessInterval) return

    queueProcessInterval = setInterval(async () => {
      if (transactionQueue.length > 0 && !isProcessing) {
        await processTransactionQueue()
      } else if (transactionQueue.length === 0) {
        // Stop processor if queue is empty
        clearInterval(queueProcessInterval)
        queueProcessInterval = null
        log('DEBUG', '🛑 Queue processor stopped (empty queue)')
      }
    }, CONFIG.QUEUE_PROCESS_INTERVAL)

    log('INFO', '🚀 Smart queue processor started')
  }

  // ✅ ENHANCED Transaction Queue Processor
  async function processTransactionQueue() {
    if (isProcessing || transactionQueue.length === 0) return

    isProcessing = true
    const startTime = Date.now()
    let processed = 0
    let errors = 0

    log('INFO', `🔄 Processing queue: ${transactionQueue.length} transactions`)

    try {
      while (transactionQueue.length > 0 && processed < 10) {
        // Process max 10 per batch
        const transaction = transactionQueue.shift()

        try {
          await sendTransactionWithRetry(transaction)
          processed++

          // Rate limiting
          if (transactionQueue.length > 0) {
            await delay(200)
          }
        } catch (error) {
          errors++
          log('ERROR', `❌ Failed to send transaction:`, error)

          // Retry logic
          if (transaction._attempts < CONFIG.RETRY_ATTEMPTS) {
            transaction._attempts++
            transaction._retry_at =
              Date.now() + CONFIG.RETRY_DELAY * transaction._attempts
            transactionQueue.unshift(transaction) // Put back at front
            log(
              'WARN',
              `🔄 Retrying transaction (attempt ${transaction._attempts}/${CONFIG.RETRY_ATTEMPTS})`
            )
          } else {
            log(
              'ERROR',
              `❌ Max retries exceeded for transaction: ${transaction.transaction_id}`
            )
          }
        }
      }

      const processingTime = Date.now() - startTime
      log(
        'SUCCESS',
        `✅ Queue batch processed: ${processed} sent, ${errors} errors in ${processingTime}ms`
      )
    } catch (error) {
      log('ERROR', '❌ Error in queue processing:', error)
    } finally {
      isProcessing = false
    }
  }

  // ✅ Send transaction with enhanced retry logic
  async function sendTransactionWithRetry(transactionData) {
    try {
      const response = await fetch(CONFIG.WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': CONFIG.API_KEY,
          'User-Agent': `Prima789-Console-Integration/${CONFIG.VERSION}`,
          'X-Session-ID': sessionId,
          'X-Transaction-Priority': transactionData._priority.toString(),
          'X-Retry-Attempt': transactionData._attempts.toString(),
        },
        body: JSON.stringify({
          ...transactionData,
          _metadata: {
            sent_at: new Date().toISOString(),
            queue_time: Date.now() - transactionData._queued_at,
            attempt: transactionData._attempts + 1,
            client_version: CONFIG.VERSION,
          },
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(
          `HTTP ${response.status}: ${response.statusText} - ${errorText}`
        )
      }

      const result = await response.json()

      log(
        'SUCCESS',
        `✅ Transaction sent: ${transactionData.transaction_type}`,
        {
          id: transactionData.transaction_id,
          response: result,
        }
      )

      return result
    } catch (error) {
      log(
        'ERROR',
        `❌ Send error for ${transactionData.transaction_type}:`,
        error
      )
      throw error
    }
  }

  // ✅ ENHANCED Notification System
  function showSmartNotification(
    message,
    type = 'info',
    duration = CONFIG.NOTIFICATIONS.DURATION
  ) {
    if (!CONFIG.NOTIFICATIONS.ENABLED) return

    try {
      // Remove existing notifications
      const existing = document.querySelectorAll('.prima789-notification')
      existing.forEach((notification) => notification.remove())

      const notification = document.createElement('div')
      notification.className = `prima789-notification prima789-${type}`
      notification.style.cssText = `
              position: fixed;
              top: 20px;
              right: 20px;
              background: ${getNotificationBackground(type)};
              color: white;
              padding: 12px 20px;
              border-radius: 8px;
              box-shadow: 0 4px 20px rgba(0,0,0,0.15);
              z-index: 999999;
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              font-size: 14px;
              font-weight: 500;
              max-width: 350px;
              opacity: 0;
              transform: translateX(100%);
              transition: all 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55);
              backdrop-filter: blur(10px);
              border: 1px solid rgba(255,255,255,0.2);
          `

      const icon = getNotificationIcon(type)
      notification.innerHTML = `
              <div style="display: flex; align-items: center; gap: 8px;">
                  <span style="font-size: 16px;">${icon}</span>
                  <div>
                      <div style="font-weight: 600; margin-bottom: 2px;">Prima789 × LINE</div>
                      <div style="opacity: 0.9; font-size: 13px;">${message}</div>
                  </div>
              </div>
          `

      document.body.appendChild(notification)

      // Animate in
      requestAnimationFrame(() => {
        notification.style.opacity = '1'
        notification.style.transform = 'translateX(0)'
      })

      // Auto remove
      setTimeout(() => {
        notification.style.opacity = '0'
        notification.style.transform = 'translateX(100%)'
        setTimeout(() => {
          if (notification.parentNode) {
            notification.parentNode.removeChild(notification)
          }
        }, 300)
      }, duration)
    } catch (error) {
      log('ERROR', 'Error showing notification:', error)
    }
  }

  // Get notification background
  function getNotificationBackground(type) {
    const backgrounds = {
      success: 'linear-gradient(135deg, #4ade80, #22c55e)',
      error: 'linear-gradient(135deg, #f87171, #ef4444)',
      warning: 'linear-gradient(135deg, #fbbf24, #f59e0b)',
      info: 'linear-gradient(135deg, #60a5fa, #3b82f6)',
    }
    return backgrounds[type] || backgrounds.info
  }

  // Get notification icon
  function getNotificationIcon(type) {
    const icons = {
      success: '✅',
      error: '❌',
      warning: '⚠️',
      info: 'ℹ️',
    }
    return icons[type] || icons.info
  }

  // ✅ ADVANCED Heartbeat System
  function startAdvancedHeartbeat() {
    if (heartbeatInterval) clearInterval(heartbeatInterval)

    heartbeatInterval = setInterval(async () => {
      try {
        const heartbeatData = {
          transaction_type: 'heartbeat',
          user_id: currentUser?.mm_user || 'anonymous',
          username: currentUser?.mm_user || 'anonymous',
          amount: 0,
          transaction_id: generateTransactionId('hb'),
          timestamp: new Date().toISOString(),
          details: {
            source: 'console_heartbeat_v3',
            session_id: sessionId,
            uptime: Date.now() - statsCollector.startTime,
            stats: {
              total_transactions: statsCollector.totalTransactions,
              successful_syncs: statsCollector.successfulSyncs,
              errors: statsCollector.errors,
              queue_length: transactionQueue.length,
              current_user: currentUser?.mm_user || null,
              last_balance: lastBalance,
            },
            system_info: {
              version: CONFIG.VERSION,
              browser: navigator.userAgent,
              memory: performance.memory
                ? {
                    used: performance.memory.usedJSHeapSize,
                    total: performance.memory.totalJSHeapSize,
                    limit: performance.memory.jsHeapSizeLimit,
                  }
                : null,
            },
          },
        }

        queueTransaction(heartbeatData)
      } catch (error) {
        log('ERROR', '💓 Heartbeat error:', error)
      }
    }, CONFIG.HEARTBEAT_INTERVAL)

    log('INFO', '💓 Advanced heartbeat started')
  }

  // Utility functions
  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  function formatCurrency(amount) {
    return new Intl.NumberFormat('th-TH', {
      style: 'currency',
      currency: 'THB',
      minimumFractionDigits: 2,
    }).format(amount)
  }

  // ✅ MAIN INITIALIZATION - PRODUCTION READY
  function initPrima789ConsoleIntegrationConfigured() {
    if (isInitialized) {
      log('WARN', '⚠️ Prima789 Console Integration already initialized')
      return false
    }

    log(
      'INFO',
      `🚀 Initializing Prima789 Console Integration v${CONFIG.VERSION} - PRODUCTION CONFIGURED`
    )

    try {
      // Generate session ID
      sessionId = `console_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 8)}`

      // Initialize all components
      const consoleOK = initConsoleInterceptor()
      if (!consoleOK) {
        throw new Error('Console interceptor initialization failed')
      }

      startAdvancedHeartbeat()
      isInitialized = true

      // Show success notification
      if (CONFIG.NOTIFICATIONS.ENABLED) {
        setTimeout(() => {
          showSmartNotification(
            'Console Integration เริ่มทำงานแล้ว!',
            'success'
          )
        }, 1000)
      }

      log('SUCCESS', '🎉 Prima789 Console Integration SUCCESSFULLY INITIALIZED')
      log('INFO', `📊 Session ID: ${sessionId}`)
      log(
        'INFO',
        `🔧 Configuration: API Ready, Debug ${
          CONFIG.DEBUG ? 'ON' : 'OFF'
        }, Notifications ${CONFIG.NOTIFICATIONS.ENABLED ? 'ON' : 'OFF'}`
      )

      return true
    } catch (error) {
      log('ERROR', '❌ INITIALIZATION FAILED:', error)

      if (CONFIG.NOTIFICATIONS.ENABLED) {
        showSmartNotification('เกิดข้อผิดพลาดในการเริ่มต้น', 'error')
      }

      return false
    }
  }

  // ✅ ENHANCED Public API
  window.Prima789ConsoleConfigured = {
    // Core functions
    init: initPrima789ConsoleIntegrationConfigured,

    // Data access
    getCurrentUser: () => currentUser,
    getLastBalance: () => lastBalance,
    getSessionId: () => sessionId,

    // Queue management
    getQueueLength: () => transactionQueue.length,
    isProcessing: () => isProcessing,
    clearQueue: () => {
      transactionQueue.length = 0
      log('INFO', '🗑️ Transaction queue cleared')
    },

    // Manual operations
    forceSync: () => {
      if (currentUser) {
        sendAdvancedSyncData(currentUser, 'manual_force_sync')
        return true
      }
      return false
    },

    // Statistics and monitoring
    getStats: () => ({
      initialized: isInitialized,
      version: CONFIG.VERSION,
      sessionId: sessionId,
      uptime: Date.now() - statsCollector.startTime,
      currentUser: currentUser?.mm_user || null,
      lastBalance: lastBalance,
      queue: {
        length: transactionQueue.length,
        isProcessing: isProcessing,
      },
      stats: {
        totalTransactions: statsCollector.totalTransactions,
        successfulSyncs: statsCollector.successfulSyncs,
        errors: statsCollector.errors,
        successRate:
          statsCollector.totalTransactions > 0
            ? (
                (statsCollector.successfulSyncs /
                  statsCollector.totalTransactions) *
                100
              ).toFixed(2)
            : 0,
      },
      config: {
        debug: CONFIG.DEBUG,
        notifications: CONFIG.NOTIFICATIONS.DISABLED,
        webhookUrl: CONFIG.WEBHOOK_URL,
        version: CONFIG.VERSION,
      },
    }),

    // Testing and debugging
    testNotification: (type = 'info') => {
      showSmartNotification(`ทดสอบการแจ้งเตือน ${type}`, type)
    },

    simulateData: (testData = null) => {
      const simData = testData || {
        mm_user: 'test_aukprima999',
        available: Math.floor(Math.random() * 10000) + 1000,
        first_name: 'Test',
        last_name: 'User',
      }

      handleCustomerData(simData, 'manual_simulation')
      log('INFO', '🧪 Simulated data processed:', simData)
    },

    // Configuration
    updateConfig: (newConfig) => {
      Object.assign(CONFIG, newConfig)
      log('INFO', '🔧 Configuration updated:', newConfig)
    },
  }

  // ✅ AUTO-INITIALIZATION with Smart Detection
  function autoInit() {
    // Wait for DOM and other scripts
    const initDelay = document.readyState === 'loading' ? 2000 : 1000

    setTimeout(() => {
      const success = initPrima789ConsoleIntegrationConfigured()

      if (success) {
        log('SUCCESS', '🎉 AUTO-INITIALIZATION COMPLETED SUCCESSFULLY')
      } else {
        log('ERROR', '❌ AUTO-INITIALIZATION FAILED')
      }
    }, initDelay)
  }

  // Start auto-initialization
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit)
  } else {
    autoInit()
  }

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    if (heartbeatInterval) clearInterval(heartbeatInterval)
    if (queueProcessInterval) clearInterval(queueProcessInterval)

    log('INFO', '👋 Prima789 Console Integration cleanup completed')
  })

  // Final loading message
  log(
    'SUCCESS',
    `📦 Prima789 Console Integration v${CONFIG.VERSION} - CONFIGURED & READY`
  )
})()

// ✅ PRODUCTION READY CONFIRMATION
console.log('🎰 Prima789 Console Integration v3.2.0 - PRODUCTION CONFIGURED ✅')
