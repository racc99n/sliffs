import pkg from 'pg'
const { Pool } = pkg

const pool = new Pool({
  connectionString: process.env.NETLIFY_DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
})

export class NeonDB {
  static async query(text, params) {
    const client = await pool.connect()
    try {
      const result = await client.query(text, params)
      return result
    } finally {
      client.release()
    }
  }

  static async getLinkedAccount(lineUserId) {
    const query = `
            SELECT la.*, md.points, md.tier, md.balance, md.expires_at, md.last_activity, md.updated_at
            FROM line_accounts la
            LEFT JOIN member_data md ON la.prima789_user_id = md.prima789_user_id
            WHERE la.line_user_id = $1 AND la.is_active = true
            ORDER BY la.linked_at DESC
            LIMIT 1;
        `

    const result = await this.query(query, [lineUserId])
    return result.rows[0] || null
  }

  static async linkAccount(lineUserId, prima789UserId, memberData) {
    const query = `
            INSERT INTO line_accounts (line_user_id, prima789_user_id, display_name, phone_number, is_active, linked_at)
            VALUES ($1, $2, $3, $4, true, NOW())
            ON CONFLICT (line_user_id) 
            DO UPDATE SET 
                prima789_user_id = $2,
                display_name = $3,
                phone_number = $4,
                linked_at = NOW(),
                updated_at = NOW()
            RETURNING *;
        `

    return await this.query(query, [
      lineUserId,
      prima789UserId,
      memberData.displayName,
      memberData.phoneNumber,
    ])
  }

  static async updateMemberData(prima789UserId, memberData) {
    const query = `
            INSERT INTO member_data (prima789_user_id, points, tier, balance, expires_at, last_activity, sync_status)
            VALUES ($1, $2, $3, $4, $5, NOW(), 'synced')
            ON CONFLICT (prima789_user_id)
            DO UPDATE SET
                points = $2,
                tier = $3,
                balance = $4,
                expires_at = $5,
                last_activity = NOW(),
                sync_status = 'synced',
                updated_at = NOW()
            RETURNING *;
        `

    return await this.query(query, [
      prima789UserId,
      memberData.points || 0,
      memberData.tier || 'Bronze',
      memberData.balance || 0,
      memberData.expiresAt || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    ])
  }

  static async logTransaction(prima789UserId, transactionData) {
    const query = `
            INSERT INTO transactions (prima789_user_id, transaction_type, amount, points_earned, 
                                   description, transaction_date, source)
            VALUES ($1, $2, $3, $4, $5, $6, 'prima789_sync')
            RETURNING *;
        `

    return await this.query(query, [
      prima789UserId,
      transactionData.type,
      transactionData.amount,
      transactionData.pointsEarned,
      transactionData.description,
      transactionData.date || new Date(),
    ])
  }

  static async healthCheck() {
    try {
      const result = await this.query(
        'SELECT NOW() as server_time, version() as db_version;'
      )
      return {
        status: 'healthy',
        timestamp: result.rows[0].server_time,
        database: 'neon-postgres',
        version: result.rows[0].db_version,
      }
    } catch (error) {
      throw new Error(`Database health check failed: ${error.message}`)
    }
  }
}
