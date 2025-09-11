const { Pool } = require('pg')

exports.handler = async (event, context) => {
  const pool = new Pool({
    connectionString: process.env.NETLIFY_DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  })

  try {
    const client = await pool.connect()

    // เพิ่ม columns ที่ขาดหาย
    const alterQueries = [
      'ALTER TABLE line_accounts ADD COLUMN IF NOT EXISTS username VARCHAR(100)',
      'ALTER TABLE line_accounts ADD COLUMN IF NOT EXISTS display_name VARCHAR(100)',
      'ALTER TABLE line_accounts ADD COLUMN IF NOT EXISTS balance DECIMAL(15,2) DEFAULT 0.00',
      'ALTER TABLE line_accounts ADD COLUMN IF NOT EXISTS points INTEGER DEFAULT 0',
      "ALTER TABLE line_accounts ADD COLUMN IF NOT EXISTS tier VARCHAR(20) DEFAULT 'Bronze'",
      "ALTER TABLE line_accounts ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active'",
    ]

    for (const query of alterQueries) {
      await client.query(query)
    }

    // เพิ่มข้อมูลทดสอบ
    await client.query(`
            INSERT INTO line_accounts (
                line_user_id, prima789_user_id, username, display_name, 
                balance, points, tier, status
            ) VALUES (
                'test-user', 'test_12345', 'testuser', 'Test User', 
                5000.00, 1250, 'Silver', 'active'
            ) ON CONFLICT (line_user_id) DO UPDATE SET
                username = EXCLUDED.username,
                display_name = EXCLUDED.display_name,
                balance = EXCLUDED.balance,
                points = EXCLUDED.points,
                tier = EXCLUDED.tier,
                status = EXCLUDED.status
        `)

    client.release()
    await pool.end()

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        message: 'Database schema fixed successfully',
      }),
    }
  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: error.message,
      }),
    }
  }
}
