export const handler = async (event, context) => {
    try {
        // CORS headers
        const headers = {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
        };

        // Handle CORS preflight
        if (event.httpMethod === 'OPTIONS') {
            return {
                statusCode: 200,
                headers,
                body: ''
            };
        }

        if (event.httpMethod !== 'POST') {
            return {
                statusCode: 405,
                headers,
                body: JSON.stringify({ 
                    success: false, 
                    error: 'Method not allowed' 
                })
            };
        }

        console.log('sync-user-data called');
        console.log('Body:', event.body);

        const requestData = JSON.parse(event.body || '{}');
        const { username, lineUserId, userData = {} } = requestData;

        if (!username && !lineUserId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    success: false, 
                    error: 'username or lineUserId is required' 
                })
            };
        }

        console.log(`Syncing data for user: ${username || lineUserId}`);
        console.log('User data:', userData);

        // Mock response for now (will add database later)
        const mockResponse = {
            success: true,
            data: {
                prima789UserId: username || 'unknown',
                lineUserId: lineUserId || null,
                memberData: userData,
                syncTimestamp: new Date().toISOString()
            },
            message: 'Data sync processed (mock response - working!)'
        };

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(mockResponse)
        };

    } catch (error) {
        console.error('Error syncing user data:', error);
        
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({ 
                success: false, 
                error: 'Internal server error',
                details: error.message
            })
        };
    }
};
