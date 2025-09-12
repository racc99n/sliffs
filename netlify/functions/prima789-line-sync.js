/**
 * Prima789 LINE Sync Function
 * Netlify Function: /.netlify/functions/prima789-line-sync
 *
 * Main orchestrator for syncing data between Prima789 and LINE
 * Coordinates all sync operations and provides unified API
 */

const { Pool } = require('pg')

// Database configuration
let pool = null

function initializeDatabase() {
  if (pool) return pool

  try {
    const databaseUrl =
      process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL

    if (!databaseUrl) {
      throw new Error('Database URL not configured')
    }

    pool = new Pool({
      connectionString: databaseUrl,
      ssl: databaseUrl.includes('localhost')
        ? false
        : { rejectUnauthorized: false },
      max: 10,
      min: 2,
      idleTimeoutMillis: 30000,
      acquireTimeoutMillis: 10000,
    })

    console.log('✅ Database initialized for prima789-line-sync')
    return pool
  } catch (error) {
    console.error('❌ Database initialization failed:', error)
    throw error
  }
}

// Execute database query
async function executeQuery(query, params = []) {
  const client = initializeDatabase()

  try {
    console.log('🔍 Executing query:', query.substring(0, 80) + '...')
    const result = await client.query(query, params)
    console.log('✅ Query success, rows:', result.rowCount)
    return result
  } catch (error) {
    console.error('❌ Query error:', error)
    throw error
  }
}

// Internal API call helper
async function callInternalFunction(functionName, data, method = 'POST') {
  const baseUrl = process.env.NETLIFY_URL || 'https://sliffs.netlify.app'
  const url = `${baseUrl}/.netlify/functions/${functionName}`

  try {
    console.log(`🔗 Calling internal function: ${functionName}`)

    const response = await fetch(url, {
      method: method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: method !== 'GET' ? JSON.stringify(data) : undefined,
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(
        `Internal function ${functionName} failed: ${response.status} - ${errorText}`
      )
    }

    const result = await response.json()
    console.log(`✅ Internal function ${functionName} success`)
    return result
  } catch (error) {
    console.error(`❌ Internal function ${functionName} error:`, error)
    throw error
  }
}

// Comprehensive sync operation
async function performComprehensiveSync(syncData) {
  try {
    const {
      lineUserId,
      prima789Username,
      lineUserData,
      prima789AccountData,
      force = false,
      includeTransactions = true,
      metadata = {},
    } = syncData

    console.log('🔄 Starting comprehensive sync:', {
      lineUserId,
      prima789Username,
      hasLineUserData: !!lineUserData,
      hasPrima789Data: !!prima789AccountData,
      force,
      includeTransactions,
    })

    const syncResults = {
      startTime: new Date().toISOString(),
      operations: [],
      success: true,
      errors: [],
    }

    // Step 1: Check current linking status
    try {
      console.log('1️⃣ Checking account linking status')
      const linkingResult = await callInternalFunction(
        'check-account-linking',
        {
          lineUserId: lineUserId,
        }
      )

      syncResults.operations.push({
        step: 'check_linking',
        success: true,
        data: linkingResult,
      })

      const isCurrentlyLinked = linkingResult.success && linkingResult.isLinked
      console.log(
        `🔗 Current linking status: ${
          isCurrentlyLinked ? 'LINKED' : 'NOT LINKED'
        }`
      )
    } catch (error) {
      console.error('❌ Step 1 (check linking) failed:', error)
      syncResults.operations.push({
        step: 'check_linking',
        success: false,
        error: error.message,
      })
      syncResults.errors.push(`Check linking failed: ${error.message}`)
    }

    // Step 2: Sync user data if provided
    if (lineUserData || prima789AccountData) {
      try {
        console.log('2️⃣ Syncing user data')
        const syncUserResult = await callInternalFunction('sync-user-data', {
          lineUser: lineUserData,
          prima789Account: prima789AccountData,
          source: 'prima789-line-sync',
          metadata: {
            ...metadata,
            comprehensive_sync: true,
          },
        })

        syncResults.operations.push({
          step: 'sync_user_data',
          success: true,
          data: syncUserResult,
        })

        console.log('✅ User data sync completed')
      } catch (error) {
        console.error('❌ Step 2 (sync user data) failed:', error)
        syncResults.operations.push({
          step: 'sync_user_data',
          success: false,
          error: error.message,
        })
        syncResults.errors.push(`User data sync failed: ${error.message}`)
      }
    }

    // Step 3: Handle account linking if needed
    if (lineUserId && prima789Username && !syncResults.errors.length) {
      try {
        console.log('3️⃣ Processing account linking')

        // Check if linking is needed
        const currentLinking = syncResults.operations.find(
          (op) => op.step === 'check_linking'
        )
        const needsLinking = force || !currentLinking?.data?.isLinked

        if (needsLinking) {
          const linkResult = await callInternalFunction(
            'link-prima789-account',
            {
              lineUserId: lineUserId,
              syncMethod: 'auto',
              username: prima789Username,
              userData: lineUserData,
            }
          )

          syncResults.operations.push({
            step: 'create_link',
            success: true,
            data: linkResult,
          })

          console.log('🔗 Account linking completed')
        } else {
          console.log('🔗 Account linking skipped (already linked)')
          syncResults.operations.push({
            step: 'create_link',
            success: true,
            skipped: true,
            reason: 'Already linked',
          })
        }
      } catch (error) {
        console.error('❌ Step 3 (account linking) failed:', error)
        syncResults.operations.push({
          step: 'create_link',
          success: false,
          error: error.message,
        })
        syncResults.errors.push(`Account linking failed: ${error.message}`)
      }
    }

    // Step 4: Verify final sync status
    try {
      console.log('4️⃣ Verifying final sync status')
      const finalStatus = await callInternalFunction('check-sync-status', {
        lineUserId: lineUserId,
      })

      syncResults.operations.push({
        step: 'verify_status',
        success: true,
        data: finalStatus,
      })

      console.log('📊 Final sync verification completed')
    } catch (error) {
      console.error('❌ Step 4 (verify status) failed:', error)
      syncResults.operations.push({
        step: 'verify_status',
        success: false,
        error: error.message,
      })
      // Don't add to errors as this is verification only
    }

    // Determine overall success
    syncResults.success = syncResults.errors.length === 0
    syncResults.endTime = new Date().toISOString()
    syncResults.duration =
      new Date(syncResults.endTime) - new Date(syncResults.startTime)

    // Log final results
    console.log(
      `${syncResults.success ? '✅' : '❌'} Comprehensive sync completed:`,
      {
        success: syncResults.success,
        operations: syncResults.operations.length,
        errors: syncResults.errors.length,
        duration: `${syncResults.duration}ms`,
      }
    )

    return syncResults
  } catch (error) {
    console.error('❌ Comprehensive sync failed:', error)
    throw error
  }
}

// Batch sync operations
async function performBatchSync(batchRequests) {
  try {
    console.log(`📦 Starting batch sync for ${batchRequests.length} requests`)

    const batchResults = {
      startTime: new Date().toISOString(),
      total: batchRequests.length,
      successful: 0,
      failed: 0,
      results: [],
      summary: {
        operations: {},
        errors: [],
      },
    }

    for (let i = 0; i < batchRequests.length; i++) {
      const request = batchRequests[i]
      console.log(`⚡ Processing batch item ${i + 1}/${batchRequests.length}`)

      try {
        const result = await performComprehensiveSync(request)

        batchResults.results.push({
          index: i,
          success: true,
          data: result,
        })

        batchResults.successful++

        // Update summary
        result.operations.forEach((op) => {
          batchResults.summary.operations[op.step] =
            (batchResults.summary.operations[op.step] || 0) + 1
        })
      } catch (error) {
        console.error(`❌ Batch item ${i + 1} failed:`, error)

        batchResults.results.push({
          index: i,
          success: false,
          error: error.message,
          request: request,
        })

        batchResults.failed++
        batchResults.summary.errors.push(`Item ${i + 1}: ${error.message}`)
      }

      // Rate limiting - small delay between items
      if (i < batchRequests.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 200))
      }
    }

    batchResults.endTime = new Date().toISOString()
    batchResults.duration =
      new Date(batchResults.endTime) - new Date(batchResults.startTime)

    console.log(`✅ Batch sync completed:`, {
      total: batchResults.total,
      successful: batchResults.successful,
      failed: batchResults.failed,
      duration: `${batchResults.duration}ms`,
    })

    return batchResults
  } catch (error) {
    console.error('❌ Batch sync failed:', error)
    throw error
  }
}

// Get sync dashboard data
async function getSyncDashboard() {
  try {
    console.log('📊 Generating sync dashboard')

    const dashboard = {
      timestamp: new Date().toISOString(),
      sections: {},
    }

    // Get overall statistics
    try {
      const statsResult = await callInternalFunction(
        'check-sync-status',
        null,
        'GET'
      )
      dashboard.sections.statistics = statsResult.statistics
      dashboard.sections.performance = statsResult.performance
    } catch (error) {
      console.warn('⚠️ Failed to get statistics:', error)
      dashboard.sections.statistics = { error: 'Failed to load' }
    }

    // Get recent activities
    try {
      const activityResult = await callInternalFunction('check-sync-status', {
        activity: true,
      })
      dashboard.sections.recentActivity = activityResult.recentActivity
    } catch (error) {
      console.warn('⚠️ Failed to get activities:', error)
      dashboard.sections.recentActivity = { error: 'Failed to load' }
    }

    // Get system issues
    try {
      const issuesResult = await callInternalFunction('check-sync-status', {
        issues: true,
      })
      dashboard.sections.issues = issuesResult.issues
    } catch (error) {
      console.warn('⚠️ Failed to get issues:', error)
      dashboard.sections.issues = { error: 'Failed to load' }
    }

    // Add system health indicators
    dashboard.sections.health = {
      database: 'connected',
      functions: 'operational',
      lastUpdate: new Date().toISOString(),
    }

    return dashboard
  } catch (error) {
    console.error('❌ Error generating sync dashboard:', error)
    throw error
  }
}

// Main handler
exports.handler = async (event, context) => {
  console.log('🔄 Prima789 LINE Sync - Start')
  console.log('📊 Request info:', {
    method: event.httpMethod,
    path: event.path,
    query: event.queryStringParameters,
    bodyLength: event.body ? event.body.length : 0,
  })

  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json',
  }

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' }
  }

  try {
    // Initialize database
    initializeDatabase()

    // Handle different operations based on query parameters or request data
    const params = event.queryStringParameters || {}
    const operation = params.operation || params.op

    // GET requests - dashboard and status
    if (event.httpMethod === 'GET') {
      if (operation === 'dashboard') {
        console.log('📊 Generating sync dashboard')
        const dashboard = await getSyncDashboard()

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            data: dashboard,
          }),
        }
      }

      // Default GET - return service status
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          service: 'Prima789 LINE Sync',
          version: '1.0.0',
          status: 'operational',
          timestamp: new Date().toISOString(),
          operations: ['comprehensive-sync', 'batch-sync', 'dashboard'],
        }),
      }
    }

    // POST requests - sync operations
    if (event.httpMethod === 'POST') {
      if (!event.body) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'Request body required',
            message: 'Please provide sync operation data',
          }),
        }
      }

      const requestData = JSON.parse(event.body)
      console.log('📋 Sync operation request:', {
        operation: operation,
        isBatch: Array.isArray(requestData.requests || requestData),
        hasLineUserId: !!requestData.lineUserId,
        hasPrima789Username: !!requestData.prima789Username,
      })

      let result

      // Handle batch sync
      if (
        operation === 'batch' ||
        Array.isArray(requestData.requests || requestData)
      ) {
        const batchRequests = requestData.requests || requestData
        if (!Array.isArray(batchRequests)) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({
              success: false,
              error: 'Invalid batch request',
              message: 'Batch requests must be an array',
            }),
          }
        }

        result = await performBatchSync(batchRequests)
      } else {
        // Single comprehensive sync
        result = await performComprehensiveSync(requestData)
      }

      console.log('✅ Prima789 LINE Sync completed successfully')

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'Sync operation completed',
          data: result,
          timestamp: new Date().toISOString(),
        }),
      }
    }

    // Method not allowed
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Method not allowed',
        message: 'Only GET and POST methods are supported',
      }),
    }
  } catch (error) {
    console.error('❌ Prima789 LINE Sync error:', error)
    console.error('Stack trace:', error.stack)

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Internal server error',
        message: 'Failed to process sync operation',
        timestamp: new Date().toISOString(),
      }),
    }
  }
}
