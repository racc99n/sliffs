// ===== netlify/functions/utils/database.js =====
const { Pool } = require('pg')

let pool

function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      console.error('DATABASE_URL environment variable is not set.')
      throw new Error('Database connection string is missing.')
    }
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false,
      },
    })
  }
  return pool
}

// Function to safely execute queries
async function query(text, params) {
  const pool = getPool()
  const start = Date.now()
  try {
    const res = await pool.query(text, params)
    const duration = Date.now() - start
    console.log('executed query', { text, duration, rows: res.rowCount })
    return res
  } catch (error) {
    console.error('Error executing query', { text, error })
    throw error
  }
}

// Function to get a client from the pool for transactions
async function getClient() {
  const pool = getPool()
  const client = await pool.connect()
  return client
}

module.exports = {
  query,
  getClient,
}
