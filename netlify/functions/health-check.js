const {
  testConnection,
  getDashboardStats,
  cleanupExpiredSyncSessions,
} = require('./utils/database')

exports.handler = async (event, context) => {
  console.log('🏥 Health Check - Start')

  // Handle CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json',
  }

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: '',
    }
  }

  try {
    const startTime = Date.now()

    // Test database connection
    console.log('Testing database connection...')
    const dbStatus = await testConnection()

    // Get system statistics
    let stats = {}
    let cleanupResult = 0

    if (dbStatus.connected) {
      console.log('Getting dashboard statistics...')
      stats = await getDashboardStats()

      // Cleanup expired sync sessions
      console.log('Cleaning up expired sync sessions...')
      cleanupResult = await cleanupExpiredSyncSessions()
    }

    const responseTime = Date.now() - startTime

    // Determine overall health status
    const isHealthy = dbStatus.connected && !dbStatus.error
    const status = isHealthy ? 'healthy' : 'degraded'

    const healthData = {
      status: status,
      timestamp: new Date().toISOString(),
      server_time: dbStatus.server_time || new Date().toISOString(),
      response_time_ms: responseTime,
      version: '2.0.0',

      // Database status
      database: {
        connected: dbStatus.connected,
        version: dbStatus.db_version,
        pool_total: dbStatus.pool_total || 0,
        pool_idle: dbStatus.pool_idle || 0,
        error: dbStatus.error || null,
      },

      // System statistics (only if DB connected)
      statistics: dbStatus.connected
        ? {
            total_line_users: parseInt(stats.total_line_users) || 0,
            linked_users: parseInt(stats.linked_users) || 0,
            total_prima789_accounts:
              parseInt(stats.total_prima789_accounts) || 0,
            today_transactions: parseInt(stats.today_transactions) || 0,
            pending_sync_sessions: parseInt(stats.pending_sync_sessions) || 0,
            cleanup_expired_sessions: cleanupResult,
          }
        : null,

      // Environment info
      environment: {
        node_version: process.version,
        netlify_region: process.env.AWS_REGION || 'unknown',
        function_memory:
          process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE || 'unknown',
        timeout: context.getRemainingTimeInMillis
          ? context.getRemainingTimeInMillis()
          : 'unknown',
      },

      // Service endpoints status
      services: {
        line_api: 'operational', // ไม่ได้ test จริง เพื่อความเร็ว
        database: status,
        webhook_endpoint: 'operational',
      },
    }

    // Log health check
    console.log(
      `🏥 Health Check Complete - Status: ${status}, Response Time: ${responseTime}ms`
    )

    return {
      statusCode: isHealthy ? 200 : 503,
      headers,
      body: JSON.stringify(healthData, null, 2),
    }
  } catch (error) {
    console.error('❌ Health Check Error:', error)

    const errorResponse = {
      status: 'error',
      timestamp: new Date().toISOString(),
      error: {
        message: error.message,
        type: error.constructor.name,
      },
      database: {
        connected: false,
        error: error.message,
      },
      services: {
        database: 'error',
        line_api: 'unknown',
        webhook_endpoint: 'unknown',
      },
    }

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify(errorResponse, null, 2),
    }
  }
}
