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

        console.log('check-username-linking called with:', event.httpMethod);
        console.log('Query params:', event.queryStringParameters);
        console.log('Body:', event.body);

        // Get request data
        let requestData = {};
        if (event.httpMethod === 'GET') {
            requestData = event.queryStringParameters || {};
        } else if (event.httpMethod === 'POST') {
            try {
                requestData = JSON.parse(event.body || '{}');
            } catch (parseError) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ 
                        success: false, 
                        error: 'Invalid JSON in request body' 
                    })
                };
            }
        }

        const { username, lineUserId } = requestData;
        
        if (!username && !lineUserId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    success: false, 
                    error: 'Username or lineUserId is required' 
                })
            };
        }

        // Mock response for now (will add database later)
        const mockResponse = {
            success: true,
            isLinked: false,
            data: null,
            message: `Checking for user: ${username || lineUserId} (mock response - working!)`
        };

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(mockResponse)
        };

    } catch (error) {
        console.error('Error in check-username-linking:', error);
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
