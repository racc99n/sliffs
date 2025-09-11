import pkg from 'pg';
const { Pool } = pkg;

export const handler = async (event, context) => {
    try {
        const headers = {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        };

        if (event.httpMethod === 'OPTIONS') {
            return { statusCode: 200, headers, body: '' };
        }

        // Test database connection
        const pool = new Pool({
            connectionString: process.env.NETLIFY_DATABASE_URL,
            ssl: { rejectUnauthorized: false }
        });

        const client = await pool.connect();
        const result = await client.query('SELECT NOW() as server_time, version() as db_version');
        client.release();

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                status: 'healthy',
                database: 'connected',
                server_time: result.rows[0].server_time,
                db_version: result.rows[0].db_version.substring(0, 50) + '...',
                environment: {
                    DATABASE_URL_SET: !!process.env.NETLIFY_DATABASE_URL,
                    LINE_TOKEN_SET: !!process.env.LINE_CHANNEL_ACCESS_TOKEN,
                    LINE_SECRET_SET: !!process.env.LINE_CHANNEL_SECRET
                }
            })
        };

    } catch (error) {
        console.error('Health check error:', error);
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                status: 'error',
                error: error.message,
                environment: {
                    DATABASE_URL_SET: !!process.env.NETLIFY_DATABASE_URL,
                    LINE_TOKEN_SET: !!process.env.LINE_CHANNEL_ACCESS_TOKEN,
                    LINE_SECRET_SET: !!process.env.LINE_CHANNEL_SECRET
                }
            })
        };
    }
};
