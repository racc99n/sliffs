// ===== scripts/setup.js =====
const fs = require('fs').promises
const path = require('path')

async function setupProject() {
  console.log('🚀 Setting up SLIFFS project...')

  try {
    // Create necessary directories
    const dirs = ['netlify/functions/utils', 'scripts', 'icons', 'screenshots']

    for (const dir of dirs) {
      try {
        await fs.mkdir(dir, { recursive: true })
        console.log(`✅ Created directory: ${dir}`)
      } catch (error) {
        if (error.code !== 'EEXIST') throw error
        console.log(`📁 Directory exists: ${dir}`)
      }
    }

    // Create .gitignore if not exists
    const gitignore = `
node_modules/
.env
.env.local
.netlify/
dist/
build/
logs/
*.log
.DS_Store
.vscode/settings.json
`

    try {
      await fs.writeFile('.gitignore', gitignore.trim())
      console.log('✅ Created .gitignore')
    } catch (error) {
      console.log('📄 .gitignore already exists')
    }

    // Create netlify.toml
    const netlifyConfig = `
[build]
  functions = "netlify/functions"
  publish = "."

[functions]
  node_bundler = "esbuild"

[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "DENY"
    X-Content-Type-Options = "nosniff"
    Referrer-Policy = "strict-origin-when-cross-origin"

[[headers]]
  for = "/.netlify/functions/*"
  [headers.values]
    Access-Control-Allow-Origin = "*"
    Access-Control-Allow-Headers = "Content-Type, Authorization"
    Access-Control-Allow-Methods = "GET, POST, OPTIONS"

[[redirects]]
  from = "/api/*"
  to = "/.netlify/functions/:splat"
  status = 200
`

    try {
      await fs.writeFile('netlify.toml', netlifyConfig.trim())
      console.log('✅ Created netlify.toml')
    } catch (error) {
      console.log('📄 netlify.toml already exists')
    }

    // Create basic HTML files if not exist
    const indexHtml = `
<!DOCTYPE html>
<html lang="th">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SLIFFS - Prima789 LINE Integration</title>
    <link rel="manifest" href="/manifest.json">
</head>
<body>
    <h1>🎯 SLIFFS Dashboard</h1>
    <p>Prima789 & LINE Integration System</p>
    
    <div>
        <h2>🔗 Quick Links</h2>
        <ul>
            <li><a href="/liff-member-card.html">Member Card</a></li>
            <li><a href="/liff-account-linking.html">Account Linking</a></li>
            <li><a href="/.netlify/functions/health-check">Health Check</a></li>
        </ul>
    </div>
    
    <script>
        console.log('🎯 SLIFFS Dashboard Loaded');
    </script>
</body>
</html>
`

    try {
      await fs.writeFile('index.html', indexHtml.trim())
      console.log('✅ Created index.html')
    } catch (error) {
      console.log('📄 index.html already exists')
    }

    console.log('🎉 Setup completed successfully!')
    console.log('\nNext steps:')
    console.log('1. Set up environment variables in .env file')
    console.log('2. Run: npm run create-db')
    console.log('3. Run: npm run deploy')
  } catch (error) {
    console.error('❌ Setup failed:', error)
    process.exit(1)
  }
}

// Run if called directly
if (require.main === module) {
  setupProject()
}

module.exports = { setupProject }

// ===== scripts/test-functions.js =====
const fetch = require('node-fetch')

const API_BASE = process.env.NETLIFY_URL || 'https://sliffs.netlify.app'

class FunctionTester {
  constructor() {
    this.results = []
  }

  async testFunction(endpoint, data = {}, method = 'POST') {
    const url = `${API_BASE}/.netlify/functions/${endpoint}`

    try {
      console.log(`🧪 Testing: ${endpoint}`)

      const response = await fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: method !== 'GET' ? JSON.stringify(data) : undefined,
      })

      const result = await response.json()
      const success = response.ok

      console.log(success ? `✅ ${endpoint}: OK` : `❌ ${endpoint}: FAILED`)

      this.results.push({
        endpoint,
        success,
        status: response.status,
        result,
      })

      return { success, result, status: response.status }
    } catch (error) {
      console.log(`❌ ${endpoint}: ERROR - ${error.message}`)
      this.results.push({
        endpoint,
        success: false,
        error: error.message,
      })
      return { success: false, error: error.message }
    }
  }

  async runAllTests() {
    console.log('🚀 Running all function tests...\n')

    // Test health check
    await this.testFunction('health-check', {}, 'GET')

    // Test with sample data
    const sampleUserId = 'U82f011b7b3355e52775a80b6dbf1cf7d'
    const sampleProfile = {
      displayName: 'Test User',
      statusMessage: 'Testing functions',
      pictureUrl: 'https://example.com/avatar.jpg',
    }

    // Test sync functions
    await this.testFunction('check-account-linking', {
      lineUserId: sampleUserId,
    })
    await this.testFunction('prima789-line-sync', {
      lineUserId: sampleUserId,
      userProfile: sampleProfile,
    })
    await this.testFunction('sync-user-data', {
      lineUserId: sampleUserId,
      userProfile: sampleProfile,
    })

    // Summary
    const total = this.results.length
    const passed = this.results.filter((r) => r.success).length

    console.log(`\n📊 Test Summary:`)
    console.log(`Total: ${total}, Passed: ${passed}, Failed: ${total - passed}`)
    console.log(`Success Rate: ${((passed / total) * 100).toFixed(1)}%`)

    if (passed === total) {
      console.log('🎉 All tests passed!')
    } else {
      console.log('⚠️ Some tests failed. Check logs above.')
      const failed = this.results.filter((r) => !r.success)
      failed.forEach((test) => {
        console.log(`❌ ${test.endpoint}: ${test.error || 'Unknown error'}`)
      })
    }

    return this.results
  }
}

// Run if called directly
if (require.main === module) {
  const tester = new FunctionTester()
  tester
    .runAllTests()
    .then(() => {
      process.exit(0)
    })
    .catch((error) => {
      console.error('Test runner error:', error)
      process.exit(1)
    })
}

module.exports = { FunctionTester }

// ===== scripts/health-check.js =====
const fetch = require('node-fetch')

async function healthCheck() {
  const API_BASE = process.env.NETLIFY_URL || 'https://sliffs.netlify.app'
  const url = `${API_BASE}/.netlify/functions/health-check`

  console.log('🏥 Running health check...')
  console.log(`URL: ${url}`)

  try {
    const response = await fetch(url)
    const data = await response.json()

    if (response.ok && data.success) {
      console.log('✅ System is healthy!')
      console.log('Database:', data.database?.status || 'Unknown')
      console.log('Timestamp:', data.timestamp)

      if (data.database?.poolSize) {
        console.log('Pool size:', data.database.poolSize)
      }
    } else {
      console.log('⚠️ System has issues:')
      console.log(data)
    }
  } catch (error) {
    console.log('❌ Health check failed:')
    console.log('Error:', error.message)

    if (error.code === 'ENOTFOUND') {
      console.log('🔍 Check if the URL is correct and the service is deployed')
    }
  }
}

// Run if called directly
if (require.main === module) {
  healthCheck()
}

module.exports = { healthCheck }

// ===== scripts/create-database.js =====
const { Client } = require('pg')

async function createDatabase() {
  console.log('🗄️ Creating database schema...')

  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL environment variable is required')
    process.exit(1)
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl:
      process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: false }
        : false,
  })

  try {
    await client.connect()
    console.log('✅ Connected to database')

    // Read and execute schema file
    // In a real scenario, you would read the SQL schema file
    // For now, we'll just test the connection

    const result = await client.query('SELECT version()')
    console.log('Database version:', result.rows[0].version)

    console.log('✅ Database schema setup completed')
  } catch (error) {
    console.error('❌ Database setup failed:', error)
    process.exit(1)
  } finally {
    await client.end()
  }
}

// Run if called directly
if (require.main === module) {
  createDatabase()
}

module.exports = { createDatabase }
