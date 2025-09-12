// ===== netlify/functions/health-check.js =====
const { checkDatabaseHealth } = require('./utils/database');

exports.handler = async (event, context) => {
    console.log('🏥 Health Check - Start');
    
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Content-Type': 'application/json'
    };
    
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }
    
    try {
        const dbHealth = await checkDatabaseHealth();
        
        const healthStatus = {
            success: true,
            status: 'healthy',
            timestamp: new Date().toISOString(),
            database: dbHealth,
            environment: process.env.NODE_ENV || 'development',
            version: '1.0.0'
        };
        
        console.log('✅ Health check completed');
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(healthStatus)
        };
        
    } catch (error) {
        console.error('❌ Health check failed:', error);
        
        const errorStatus = {
            success: false,
            status: 'unhealthy',
            timestamp: new Date().toISOString(),
            error: error.message,
            database: { status: 'error' }
        };
        
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify(errorStatus)
        };
    }
};