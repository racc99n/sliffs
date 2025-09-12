/**
 * Prima789 Socket.IO Integration Script for LINE Member Card
 * Version: 3.1.0 - Socket.IO Real-time Edition
 *
 * ดักข้อมูล real-time จาก Socket.IO และ WebSocket ของ Prima789
 * และส่งไปยัง LINE Member Card System
 */

;(function () {
  'use strict'

  // Configuration
  const CONFIG = {
    WEBHOOK_URL:
      'https://sliffs.netlify.app/.netlify/functions/transaction-webhook',
    API_KEY: 'PRIMA789_f1922de52a8e5c6bf5b4777dabeff027',
    DEBUG: true,
    VERSION: '3.1.0-socketio-realtime',
    RETRY_ATTEMPTS: 3,
    RETRY_DELAY: 2000,
    HEARTBEAT_INTERVAL: 30000,
    // Socket.IO Event Names to Monitor
    SOCKET_EVENTS: [
      'user_login',
      'user_data',
      'balance_update',
      'transaction',
      'deposit',
      'withdrawal',
      'bet_placed',
      'bet_settled',
      'credit_update',
      'member_sync',
      'account_balance',
    ],
    // WebSocket Message Types
    WS_MESSAGE_TYPES: [
      'USER_LOGIN',
      'BALANCE_UPDATE',
      'TRANSACTION_UPDATE',
      'MEMBER_DATA',
      'CREDIT_PUSH',
    ],
  }

  // Global state
  let currentUser = null
  let lastBalance = null
  let transactionQueue = []
  let isProcessing = false
  let isInitialized = false
  let socketConnections = []
  let wsConnections = []
  let heartbeatInterval = null
  let sessionId = null

  // Logger function
  function log(level, message, data = null) {
    if (!CONFIG.DEBUG && level === 'DEBUG') return

    const timestamp = new Date().toISOString()
    const icon = getLogIcon(level)

    console[level.toLowerCase()](
      `[Prima789-SocketIO] ${timestamp}: ${icon} ${message}`,
      data || ''
    )
  }

  function getLogIcon(level) {
    const icons = {
      DEBUG: '🔍',
      INFO: '✅',
      WARN: '⚠️',
      ERROR: '❌',
    }
    return icons[level] || '📝'
  }

  // Initialize Socket.IO interceptor
  function initSocketIOInterceptor() {
    try {
      // Method 1: Intercept Socket.IO if available
      if (window.io && typeof window.io === 'function') {
        interceptSocketIO()
      }

      // Method 2: Look for existing socket connections
      findExistingSockets()

      // Method 3: Monitor for new socket creation
      monitorSocketCreation()

      // Method 4: Intercept WebSocket connections
      interceptWebSocket()

      log('INFO', 'Socket.IO interceptor initialized')
    } catch (error) {
      log('ERROR', 'Failed to initialize Socket.IO interceptor:', error)
    }
  }

  // Intercept Socket.IO library
  function interceptSocketIO() {
    const originalIO = window.io

    window.io = function (...args) {
      const socket = originalIO.apply(this, args)

      log('INFO', '🔌 New Socket.IO connection detected')
      monitorSocket(socket)

      return socket
    }

    // Copy properties
    Object.keys(originalIO).forEach((key) => {
      window.io[key] = originalIO[key]
    })
  }

  // Find existing socket connections
  function findExistingSockets() {
    // Check common socket.io patterns
    const socketPaths = [
      'window.socket',
      'window.io.socket',
      'window.app.socket',
      'window.client.socket',
      'window.prima789.socket',
      'window.gameSocket',
      'window.memberSocket',
    ]

    socketPaths.forEach((path) => {
      try {
        const socket = eval(path)
        if (socket && typeof socket.on === 'function') {
          log('INFO', `🔍 Found existing socket at: ${path}`)
          monitorSocket(socket)
        }
      } catch (e) {
        // Path doesn't exist, continue
      }
    })
  }

  // Monitor socket creation
  function monitorSocketCreation() {
    // Override EventTarget.prototype to catch socket creation
    const originalAddEventListener = EventTarget.prototype.addEventListener

    EventTarget.prototype.addEventListener = function (
      type,
      listener,
      options
    ) {
      if (this.constructor.name === 'Socket' || (this.io && this.io.engine)) {
        log('INFO', '🎯 Socket event listener detected')
        monitorSocket(this)
      }

      return originalAddEventListener.call(this, type, listener, options)
    }
  }

  // Intercept WebSocket connections
  function interceptWebSocket() {
    const OriginalWebSocket = window.WebSocket

    window.WebSocket = function (url, protocols) {
      const ws = new OriginalWebSocket(url, protocols)

      log('INFO', '🌐 New WebSocket connection:', url)
      monitorWebSocket(ws, url)

      return ws
    }

    // Copy static methods
    Object.keys(OriginalWebSocket).forEach((key) => {
      window.WebSocket[key] = OriginalWebSocket[key]
    })
  }

  // Monitor Socket.IO socket
  function monitorSocket(socket) {
    if (!socket || typeof socket.on !== 'function') {
      log('WARN', 'Invalid socket object')
      return
    }

    socketConnections.push(socket)
    log(
      'INFO',
      `📡 Monitoring Socket.IO connection (Total: ${socketConnections.length})`
    )

    // Monitor specific events
    CONFIG.SOCKET_EVENTS.forEach((eventName) => {
      socket.on(eventName, (data) => {
        log('INFO', `🎯 Socket event detected: ${eventName}`, data)
        processSocketData(eventName, data)
      })
    })

    // Monitor all events (catch-all)
    const originalEmit = socket.emit
    const originalOn = socket.on

    // Intercept outgoing events
    socket.emit = function (eventName, data, ...args) {
      if (isRelevantEvent(eventName, data)) {
        log('INFO', `📤 Socket emit: ${eventName}`, data)
        processSocketData(eventName, data, 'outgoing')
      }
      return originalEmit.apply(this, arguments)
    }

    // Intercept incoming events
    socket.on = function (eventName, callback, ...args) {
      const wrappedCallback = function (data) {
        if (isRelevantEvent(eventName, data)) {
          log('INFO', `📥 Socket receive: ${eventName}`, data)
          processSocketData(eventName, data, 'incoming')
        }
        return callback.apply(this, arguments)
      }

      return originalOn.call(this, eventName, wrappedCallback, ...args)
    }

    // Monitor connection events
    socket.on('connect', () => {
      log('INFO', '✅ Socket connected')
      sendConnectionEvent('socket_connected')
    })

    socket.on('disconnect', () => {
      log('INFO', '❌ Socket disconnected')
      sendConnectionEvent('socket_disconnected')
    })

    socket.on('error', (error) => {
      log('ERROR', 'Socket error:', error)
    })
  }

  // Monitor WebSocket
  function monitorWebSocket(ws, url) {
    wsConnections.push({ ws, url })
    log('INFO', `🌐 Monitoring WebSocket: ${url}`)

    // Override message handler
    const originalOnMessage = ws.onmessage
    ws.onmessage = function (event) {
      try {
        const data = JSON.parse(event.data)
        log('INFO', '📥 WebSocket message received:', data)
        processWebSocketData(data, url)
      } catch (e) {
        // Not JSON, check if it's relevant text
        if (isRelevantWebSocketMessage(event.data)) {
          log('INFO', '📥 WebSocket text message:', event.data)
          processWebSocketText(event.data, url)
        }
      }

      if (originalOnMessage) {
        return originalOnMessage.call(this, event)
      }
    }

    // Override send method
    const originalSend = ws.send
    ws.send = function (data) {
      try {
        const parsedData = JSON.parse(data)
        log('INFO', '📤 WebSocket send:', parsedData)
        processWebSocketData(parsedData, url, 'outgoing')
      } catch (e) {
        if (isRelevantWebSocketMessage(data)) {
          log('INFO', '📤 WebSocket send text:', data)
          processWebSocketText(data, url, 'outgoing')
        }
      }

      return originalSend.call(this, data)
    }

    // Connection events
    ws.onopen = function (event) {
      log('INFO', '✅ WebSocket connected:', url)
      sendConnectionEvent('websocket_connected', { url })
    }

    ws.onclose = function (event) {
      log('INFO', '❌ WebSocket closed:', { url, code: event.code })
      sendConnectionEvent('websocket_closed', { url, code: event.code })
    }

    ws.onerror = function (error) {
      log('ERROR', 'WebSocket error:', { url, error })
    }
  }

  // Check if event is relevant
  function isRelevantEvent(eventName, data) {
    const relevantEvents = [
      'user',
      'login',
      'auth',
      'member',
      'account',
      'balance',
      'credit',
      'deposit',
      'withdrawal',
      'transaction',
      'bet',
      'game',
      'sync',
      'update',
    ]

    const eventLower = eventName.toLowerCase()
    return (
      relevantEvents.some((keyword) => eventLower.includes(keyword)) ||
      hasRelevantData(data)
    )
  }

  // Check if WebSocket message is relevant
  function isRelevantWebSocketMessage(message) {
    if (typeof message !== 'string') return false

    const keywords = [
      'user',
      'login',
      'member',
      'account',
      'balance',
      'credit',
      'transaction',
      'deposit',
      'withdrawal',
      'prima789',
      'mm_user',
      'available',
    ]

    const messageLower = message.toLowerCase()
    return keywords.some((keyword) => messageLower.includes(keyword))
  }

  // Check if data contains relevant information
  function hasRelevantData(data) {
    if (!data || typeof data !== 'object') return false

    const relevantFields = [
      'user_id',
      'userId',
      'mm_user',
      'username',
      'member_id',
      'balance',
      'available',
      'credit',
      'amount',
      'transaction_id',
      'acc_no',
      'bank_name',
      'first_name',
      'last_name',
    ]

    return relevantFields.some(
      (field) =>
        data.hasOwnProperty(field) ||
        (data.data && data.data.hasOwnProperty(field))
    )
  }

  // Process Socket.IO data
  function processSocketData(eventName, data, direction = 'incoming') {
    try {
      log('INFO', '🔄 Processing socket data:', {
        event: eventName,
        direction,
        data,
      })

      // Extract user data
      const userData = extractUserData(data)
      if (userData) {
        handleUserData(userData, `socket_${eventName}`)
      }

      // Extract balance data
      const balanceData = extractBalanceData(data)
      if (balanceData) {
        handleBalanceUpdate(balanceData, `socket_${eventName}`)
      }

      // Extract transaction data
      const transactionData = extractTransactionData(data)
      if (transactionData) {
        handleTransactionData(transactionData, `socket_${eventName}`)
      }
    } catch (error) {
      log('ERROR', 'Error processing socket data:', error)
    }
  }

  // Process WebSocket data
  function processWebSocketData(data, url, direction = 'incoming') {
    try {
      log('INFO', '🔄 Processing WebSocket data:', { url, direction, data })

      // Check message type
      if (data.type && CONFIG.WS_MESSAGE_TYPES.includes(data.type)) {
        processWebSocketMessage(data, url)
      } else {
        // Generic processing
        processSocketData(
          `ws_${data.type || 'message'}`,
          data.payload || data,
          direction
        )
      }
    } catch (error) {
      log('ERROR', 'Error processing WebSocket data:', error)
    }
  }

  // Process WebSocket text message
  function processWebSocketText(message, url, direction = 'incoming') {
    try {
      // Try to extract structured data from text
      const userData = extractUserDataFromText(message)
      if (userData) {
        handleUserData(userData, 'websocket_text')
      }
    } catch (error) {
      log('ERROR', 'Error processing WebSocket text:', error)
    }
  }

  // Process specific WebSocket message types
  function processWebSocketMessage(data, url) {
    switch (data.type) {
      case 'USER_LOGIN':
        if (data.payload) {
          handleUserData(data.payload, 'websocket_login')
        }
        break

      case 'BALANCE_UPDATE':
        if (data.payload) {
          handleBalanceUpdate(data.payload, 'websocket_balance')
        }
        break

      case 'TRANSACTION_UPDATE':
        if (data.payload) {
          handleTransactionData(data.payload, 'websocket_transaction')
        }
        break

      case 'MEMBER_DATA':
        if (data.payload) {
          handleUserData(data.payload, 'websocket_member')
        }
        break

      case 'CREDIT_PUSH':
        if (data.payload) {
          handleBalanceUpdate(data.payload, 'websocket_credit')
        }
        break
    }
  }

  // Extract user data from various formats
  function extractUserData(data) {
    if (!data) return null

    const userData = {}
    const userFields = {
      mm_user: [
        'mm_user',
        'user_id',
        'userId',
        'username',
        'login',
        'member_id',
      ],
      first_name: ['first_name', 'firstName', 'fname', 'name'],
      last_name: ['last_name', 'lastName', 'lname'],
      acc_no: ['acc_no', 'account_no', 'phone', 'tel', 'mobile'],
      bank_name: ['bank_name', 'bank', 'bankName'],
      available: ['available', 'balance', 'amount', 'credit'],
    }

    // Direct mapping
    Object.keys(userFields).forEach((targetField) => {
      userFields[targetField].forEach((sourceField) => {
        if (data[sourceField] !== undefined) {
          userData[targetField] = data[sourceField]
        }
      })
    })

    // Check nested data
    if (data.data || data.payload || data.user || data.member) {
      const nested = data.data || data.payload || data.user || data.member
      Object.keys(userFields).forEach((targetField) => {
        userFields[targetField].forEach((sourceField) => {
          if (nested[sourceField] !== undefined) {
            userData[targetField] = nested[sourceField]
          }
        })
      })
    }

    return Object.keys(userData).length > 0 ? userData : null
  }

  // Extract balance data
  function extractBalanceData(data) {
    if (!data) return null

    const balanceFields = [
      'available',
      'balance',
      'amount',
      'credit',
      'new_balance',
    ]
    let balance = null

    balanceFields.forEach((field) => {
      if (data[field] !== undefined) {
        balance = parseFloat(data[field])
      }
    })

    if (data.data || data.payload) {
      const nested = data.data || data.payload
      balanceFields.forEach((field) => {
        if (nested[field] !== undefined) {
          balance = parseFloat(nested[field])
        }
      })
    }

    return balance !== null ? { balance, data } : null
  }

  // Extract transaction data
  function extractTransactionData(data) {
    if (!data) return null

    const transactionFields = [
      'transaction_id',
      'txn_id',
      'id',
      'amount',
      'type',
    ]
    const hasTransaction = transactionFields.some(
      (field) =>
        data[field] !== undefined ||
        (data.data && data.data[field] !== undefined)
    )

    return hasTransaction ? data : null
  }

  // Extract user data from text message
  function extractUserDataFromText(text) {
    try {
      // Look for patterns like "user: aukprima100006"
      const userMatch = text.match(
        /(?:user|mm_user|username|member):\s*([a-zA-Z0-9_]+)/i
      )
      if (userMatch) {
        return { mm_user: userMatch[1] }
      }

      // Look for balance patterns
      const balanceMatch = text.match(
        /(?:balance|available|credit):\s*([0-9.,]+)/i
      )
      if (balanceMatch) {
        return { available: parseFloat(balanceMatch[1].replace(',', '')) }
      }
    } catch (error) {
      log('ERROR', 'Error extracting data from text:', error)
    }

    return null
  }

  // Handle user data
  function handleUserData(userData, source) {
    try {
      log('INFO', '👤 Processing user data:', { userData, source })

      if (!userData.mm_user) {
        log('WARN', 'No user ID found in data')
        return
      }

      // Check if new user
      const isNewUser = !currentUser || currentUser.mm_user !== userData.mm_user

      if (isNewUser) {
        log('INFO', '🆕 New user detected:', userData.mm_user)
        currentUser = userData

        queueTransaction({
          transaction_type: 'user_login',
          user_id: userData.mm_user,
          username: userData.mm_user,
          amount: 0,
          transaction_id: generateTransactionId('login'),
          timestamp: new Date().toISOString(),
          details: {
            source: source,
            user_data: userData,
            session_id: sessionId,
          },
        })
      } else {
        // Update existing user data
        currentUser = { ...currentUser, ...userData }
      }

      // Send sync data
      queueTransaction({
        transaction_type: 'data_sync',
        user_id: userData.mm_user,
        username: userData.mm_user,
        amount: 0,
        transaction_id: generateTransactionId('sync'),
        timestamp: new Date().toISOString(),
        details: {
          source: source,
          user_data: userData,
          session_id: sessionId,
        },
      })
    } catch (error) {
      log('ERROR', 'Error handling user data:', error)
    }
  }

  // Handle balance update
  function handleBalanceUpdate(balanceData, source) {
    try {
      const newBalance = balanceData.balance

      if (newBalance === undefined || isNaN(newBalance)) {
        log('WARN', 'Invalid balance data')
        return
      }

      log('INFO', '💰 Processing balance update:', {
        newBalance,
        lastBalance,
        source,
      })

      if (lastBalance !== null && lastBalance !== newBalance) {
        const amount = newBalance - lastBalance

        queueTransaction({
          transaction_type: amount > 0 ? 'deposit' : 'withdrawal',
          user_id: currentUser?.mm_user || 'unknown',
          username: currentUser?.mm_user || 'unknown',
          amount: Math.abs(amount),
          balance_before: lastBalance,
          balance_after: newBalance,
          transaction_id: generateTransactionId(amount > 0 ? 'dep' : 'wd'),
          timestamp: new Date().toISOString(),
          details: {
            source: source,
            change_amount: amount,
            raw_data: balanceData.data,
          },
        })
      }

      lastBalance = newBalance
    } catch (error) {
      log('ERROR', 'Error handling balance update:', error)
    }
  }

  // Handle transaction data
  function handleTransactionData(transactionData, source) {
    try {
      log('INFO', '💳 Processing transaction data:', {
        transactionData,
        source,
      })

      queueTransaction({
        transaction_type: 'transaction',
        user_id: currentUser?.mm_user || transactionData.user_id || 'unknown',
        username: currentUser?.mm_user || transactionData.username || 'unknown',
        amount: parseFloat(transactionData.amount) || 0,
        transaction_id:
          transactionData.transaction_id || generateTransactionId('txn'),
        timestamp: new Date().toISOString(),
        details: {
          source: source,
          raw_transaction: transactionData,
        },
      })
    } catch (error) {
      log('ERROR', 'Error handling transaction data:', error)
    }
  }

  // Send connection event
  function sendConnectionEvent(eventType, data = {}) {
    queueTransaction({
      transaction_type: 'system_event',
      user_id: currentUser?.mm_user || 'anonymous',
      username: currentUser?.mm_user || 'anonymous',
      amount: 0,
      transaction_id: generateTransactionId('sys'),
      timestamp: new Date().toISOString(),
      details: {
        source: 'socketio_integration',
        event_type: eventType,
        session_id: sessionId,
        ...data,
      },
    })
  }

  // Generate transaction ID
  function generateTransactionId(prefix = 'txn') {
    const timestamp = Date.now()
    const random = Math.random().toString(36).substr(2, 5)
    return `${prefix}_${timestamp}_${random}`
  }

  // Queue transaction (reuse from console integration)
  function queueTransaction(transactionData) {
    transactionQueue.push(transactionData)
    log('INFO', '📝 Transaction queued:', transactionData.transaction_type)

    if (!isProcessing) {
      processTransactionQueue()
    }
  }

  // Process transaction queue
  async function processTransactionQueue() {
    if (isProcessing || transactionQueue.length === 0) return

    isProcessing = true
    log(
      'INFO',
      '🔄 Processing transaction queue...',
      `${transactionQueue.length} items`
    )

    while (transactionQueue.length > 0) {
      const transaction = transactionQueue.shift()

      try {
        await sendTransactionData(transaction)
        await new Promise((resolve) => setTimeout(resolve, 200)) // Rate limiting
      } catch (error) {
        log('ERROR', 'Failed to send transaction:', error)

        // Retry logic
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
    log('INFO', '✅ Transaction queue processed')
  }

  // Send transaction data to API
  async function sendTransactionData(transactionData) {
    try {
      const response = await fetch(CONFIG.WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': CONFIG.API_KEY,
          'User-Agent': `Prima789-SocketIO-Integration/${CONFIG.VERSION}`,
        },
        body: JSON.stringify(transactionData),
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const result = await response.json()
      log('DEBUG', '✅ Transaction sent successfully:', result)

      return result
    } catch (error) {
      log('ERROR', 'Error sending transaction:', error)
      throw error
    }
  }

  // Heartbeat system
  function startHeartbeat() {
    if (heartbeatInterval) clearInterval(heartbeatInterval)

    heartbeatInterval = setInterval(() => {
      queueTransaction({
        transaction_type: 'heartbeat',
        user_id: currentUser?.mm_user || 'anonymous',
        username: currentUser?.mm_user || 'anonymous',
        amount: 0,
        transaction_id: generateTransactionId('hb'),
        timestamp: new Date().toISOString(),
        details: {
          source: 'socketio_heartbeat',
          session_id: sessionId,
          socket_connections: socketConnections.length,
          ws_connections: wsConnections.length,
          version: CONFIG.VERSION,
        },
      })
    }, CONFIG.HEARTBEAT_INTERVAL)
  }

  // Main initialization
  function initPrima789SocketIOIntegration() {
    if (isInitialized) {
      log('WARN', '⚠️ Prima789 Socket.IO integration already initialized')
      return
    }

    log(
      'INFO',
      '🚀 Initializing Prima789 Socket.IO Integration v' + CONFIG.VERSION
    )

    try {
      sessionId = `socketio_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`

      initSocketIOInterceptor()
      startHeartbeat()

      isInitialized = true
      log('INFO', '✅ Prima789 Socket.IO Integration initialized successfully')
    } catch (error) {
      log(
        'ERROR',
        '❌ Failed to initialize Prima789 Socket.IO Integration:',
        error
      )
    }
  }

  // Public API
  window.Prima789SocketIO = {
    init: initPrima789SocketIOIntegration,
    getCurrentUser: () => currentUser,
    getLastBalance: () => lastBalance,
    getQueueLength: () => transactionQueue.length,
    isProcessing: () => isProcessing,
    getConnections: () => ({
      sockets: socketConnections.length,
      websockets: wsConnections.length,
    }),
    getStats: () => ({
      initialized: isInitialized,
      version: CONFIG.VERSION,
      currentUser: currentUser?.mm_user || null,
      lastBalance: lastBalance,
      queueLength: transactionQueue.length,
      isProcessing: isProcessing,
      sessionId: sessionId,
      connections: {
        sockets: socketConnections.length,
        websockets: wsConnections.length,
      },
    }),
    forceSync: () => {
      if (currentUser) {
        handleUserData(currentUser, 'manual_sync')
      }
    },
  }

  // Auto-initialize
  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      initPrima789SocketIOIntegration
    )
  } else {
    setTimeout(initPrima789SocketIOIntegration, 1000)
  }

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval)
    }
    log('INFO', '👋 Prima789 Socket.IO Integration cleanup')
  })

  log('INFO', `Prima789 Socket.IO Integration v${CONFIG.VERSION} script loaded`)
})()

// Display initialization message
console.log('🎰 Prima789 Socket.IO Integration v3.1.0 - PRODUCTION READY ✅')
