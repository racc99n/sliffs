// ===== netlify/functions/check-account-linking.js =====
const { 
    checkUserLinking,
    getUserBalance,
    logSystemEvent
} = require('./utils/database');

exports.handler = async (event, context) => {
    console.log('🔍 Check Account Linking - Start');
    
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json'
    };
    
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }
    
    try {
        const { lineUserId } = JSON.parse(event.body || '{}');
        
        if (!lineUserId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    success: false,
                    error: 'LINE User ID is required'
                })
            };
        }
        
        const linkingResult = await checkUserLinking(lineUserId);
        let balance = 0;
        
        if (linkingResult.isLinked) {
            try {
                balance = await getUserBalance(lineUserId);
            } catch (error) {
                console.warn('⚠️ Failed to get balance:', error);
                balance = 0;
            }
        }
        
        const responseData = {
            ...linkingResult.linkData,
            balance: linkingResult.isLinked ? balance : 0
        };
        
        await logSystemEvent('check_account_linking', lineUserId, {
            isLinked: linkingResult.isLinked,
            balance,
            source: 'check-account-linking'
        });
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                isLinked: linkingResult.isLinked,
                lineUserId,
                data: responseData,
                timestamp: new Date().toISOString()
            })
        };
        
    } catch (error) {
        console.error('❌ Check account linking error:', error);
        
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                success: false,
                error: 'Failed to check account linking',
                message: error.message,
                timestamp: new Date().toISOString()
            })
        };
    }
};