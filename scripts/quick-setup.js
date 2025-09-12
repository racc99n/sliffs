#!/usr/bin/env node

// ===== SLIFFS Quick Setup Script =====
// สร้างและติดตั้งระบบ SLIFFS ทั้งหมดในคำสั่งเดียว

const fs = require('fs').promises
const path = require('path')

console.log('🚀 SLIFFS Quick Setup - Starting...\n')

async function createDirectories() {
  console.log('📁 Creating directories...')
  const dirs = ['netlify/functions/utils', 'scripts', 'icons', 'screenshots']

  for (const dir of dirs) {
    try {
      await fs.mkdir(dir, { recursive: true })
      console.log(`✅ Created: ${dir}`)
    } catch (error) {
      console.log(`📁 Exists: ${dir}`)
    }
  }
}

async function createDatabaseUtil() {
  console.log('\n🗄️ Creating database utility...')

  const databaseUtilCode = `// ===== netlify/functions/utils/database.js =====
const { Pool } = require('pg');

// Single database connection pool instance
let pool = null;

// Initialize database connection
const initializeDatabase = () => {
    if (!pool) {
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
            max: 10,
            min: 2,
            idleTimeoutMillis: 30000,
            acquireTimeoutMillis: 10000
        });

        pool.on('error', (err) => {
            console.error('❌ Database pool error:', err);
        });

        console.log('✅ Database pool initialized');
    }
    return pool;
};

const getDatabase = () => initializeDatabase();

const executeQuery = async (query, params = []) => {
    const db = getDatabase();
    
    try {
        console.log('🔍 Executing query:', query.substring(0, 100) + '...');
        const result = await db.query(query, params);
        console.log('✅ Query success, rows:', result.rowCount);
        return result;
    } catch (error) {
        console.error('❌ Query error:', error);
        throw error;
    }
};

const upsertLineUser = async (lineUserId, profile = {}) => {
    const query = \`
        INSERT INTO line_users (
            line_user_id, display_name, status_message, picture_url, 
            last_sync, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, NOW(), NOW(), NOW())
        ON CONFLICT (line_user_id) 
        DO UPDATE SET 
            display_name = EXCLUDED.display_name,
            status_message = EXCLUDED.status_message,
            picture_url = EXCLUDED.picture_url,
            last_sync = NOW(),
            updated_at = NOW()
        RETURNING *\`;
    
    const values = [
        lineUserId,
        profile.displayName || null,
        profile.statusMessage || null,
        profile.pictureUrl || null
    ];
    
    const result = await executeQuery(query, values);
    console.log('✅ Line user upserted:', lineUserId);
    return result.rows[0];
};

const checkUserLinking = async (lineUserId) => {
    const query = \`
        SELECT 
            al.linking_id,
            al.prima789_account_id,
            al.linked_at,
            al.is_active,
            pa.username,
            pa.email,
            pa.balance,
            pa.status as account_status
        FROM account_linking al
        JOIN prima789_accounts pa ON al.prima789_account_id = pa.account_id
        WHERE al.line_user_id = $1 AND al.is_active = true
        ORDER BY al.linked_at DESC
        LIMIT 1\`;
    
    const result = await executeQuery(query, [lineUserId]);
    const isLinked = result.rows.length > 0;
    
    console.log(\`Account linking status for \${lineUserId}: \${isLinked}\`);
    return {
        isLinked,
        linkData: result.rows[0] || null
    };
};

const getUserBalance = async (lineUserId) => {
    const query = \`
        SELECT pa.balance
        FROM account_linking al
        JOIN prima789_accounts pa ON al.prima789_account_id = pa.account_id
        WHERE al.line_user_id = $1 AND al.is_active = true AND pa.status = 'active'
        LIMIT 1\`;
    
    const result = await executeQuery(query, [lineUserId]);
    const balance = result.rows.length > 0 ? result.rows[0].balance : 0;
    
    console.log(\`Balance for \${lineUserId}: \${balance}\`);
    return parseFloat(balance) || 0;
};

const getRecentTransactions = async (lineUserId, limit = 10) => {
    const query = \`
        SELECT t.*, pa.username
        FROM transactions t
        JOIN prima789_accounts pa ON t.prima789_account_id = pa.account_id
        JOIN account_linking al ON pa.account_id = al.prima789_account_id
        WHERE al.line_user_id = $1 AND al.is_active = true
        ORDER BY t.processed_at DESC
        LIMIT $2\`;
    
    const result = await executeQuery(query, [lineUserId, limit]);
    console.log(\`Recent transactions for \${lineUserId}: \${result.rows.length} found\`);
    return result.rows;
};

const logSystemEvent = async (eventType, lineUserId = null, data = {}, level = 'info') => {
    const query = \`
        INSERT INTO system_logs (
            event_type, line_user_id, level, message, data, source, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
        RETURNING log_id\`;
    
    const values = [
        eventType,
        lineUserId,
        level,
        data.message || null,
        JSON.stringify(data),
        data.source || 'system'
    ];
    
    try {
        const result = await executeQuery(query, values);
        return result.rows[0].log_id;
    } catch (error) {
        console.error('Warning: Failed to log system event:', error);
        return null;
    }
};

const checkDatabaseHealth = async () => {
    try {
        const result = await executeQuery('SELECT NOW() as current_time, version() as db_version');
        return {
            status: 'healthy',
            timestamp: result.rows[0].current_time,
            version: result.rows[0].db_version,
            poolSize: pool ? pool.totalCount : 0
        };
    } catch (error) {
        return {
            status: 'unhealthy',
            error: error.message
        };
    }
};

module.exports = {
    getDatabase,
    executeQuery,
    upsertLineUser,
    checkUserLinking,
    getUserBalance,
    getRecentTransactions,
    logSystemEvent,
    checkDatabaseHealth
};`

  await fs.writeFile('netlify/functions/utils/database.js', databaseUtilCode)
  console.log('✅ Created: netlify/functions/utils/database.js')
}

async function createSyncFunctions() {
  console.log('\n⚙️ Creating sync functions...')

  // Prima789 LINE Sync Function
  const prima789SyncCode = `// ===== netlify/functions/prima789-line-sync.js =====
const { 
    upsertLineUser,
    checkUserLinking,
    getUserBalance,
    getRecentTransactions,
    logSystemEvent
} = require('./utils/database');

exports.handler = async (event, context) => {
    console.log('🔄 Prima789 LINE Sync - Start');
    
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json'
    };
    
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
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
    
    try {
        const data = JSON.parse(event.body || '{}');
        const { lineUserId, userProfile, syncType = 'full' } = data;
        
        if (!lineUserId) {
            throw new Error('LINE User ID is required');
        }
        
        console.log(\`Syncing user: \${lineUserId}\`);
        
        await logSystemEvent('sync_start', lineUserId, { 
            syncType,
            source: 'prima789-line-sync'
        });
        
        const lineUser = await upsertLineUser(lineUserId, userProfile);
        const linkingResult = await checkUserLinking(lineUserId);
        
        let balance = 0;
        let recentTransactions = [];
        
        if (linkingResult.isLinked) {
            try {
                balance = await getUserBalance(lineUserId);
                recentTransactions = await getRecentTransactions(lineUserId, 5);
            } catch (error) {
                console.warn('⚠️ Failed to get balance/transactions:', error);
            }
        }
        
        const syncResult = {
            lineUser: {
                userId: lineUser.line_user_id,
                displayName: lineUser.display_name,
                statusMessage: lineUser.status_message,
                pictureUrl: lineUser.picture_url,
                lastSync: lineUser.last_sync
            },
            accountLinking: linkingResult,
            balance,
            recentTransactions,
            syncType,
            syncedAt: new Date().toISOString()
        };
        
        await logSystemEvent('sync_success', lineUserId, {
            result: syncResult,
            source: 'prima789-line-sync'
        });
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                message: 'Sync operation completed',
                data: syncResult,
                timestamp: new Date().toISOString()
            })
        };
        
    } catch (error) {
        console.error('❌ Sync Error:', error);
        
        const data = JSON.parse(event.body || '{}');
        if (data.lineUserId) {
            await logSystemEvent('sync_error', data.lineUserId, {
                error: error.message,
                source: 'prima789-line-sync'
            }, 'error');
        }
        
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                success: false,
                error: 'Sync failed',
                message: error.message,
                timestamp: new Date().toISOString()
            })
        };
    }
};`

  await fs.writeFile(
    'netlify/functions/prima789-line-sync.js',
    prima789SyncCode
  )
  console.log('✅ Created: netlify/functions/prima789-line-sync.js')

  // Check Account Linking Function
  const checkLinkingCode = `// ===== netlify/functions/check-account-linking.js =====
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
};`

  await fs.writeFile(
    'netlify/functions/check-account-linking.js',
    checkLinkingCode
  )
  console.log('✅ Created: netlify/functions/check-account-linking.js')
}

async function createHealthCheck() {
  console.log('\n🏥 Creating health check function...')

  const healthCheckCode = `// ===== netlify/functions/health-check.js =====
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
};`

  await fs.writeFile('netlify/functions/health-check.js', healthCheckCode)
  console.log('✅ Created: netlify/functions/health-check.js')
}

async function createManifest() {
  console.log('\n📱 Creating manifest.json...')

  const manifest = {
    name: 'SLIFFS - Prima789 LINE Integration',
    short_name: 'SLIFFS',
    description: 'Complete Prima789 and LINE integration system',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#00B900',
    orientation: 'portrait-primary',
    scope: '/',
    lang: 'th',
    icons: [
      {
        src: '/icons/icon-192x192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable any',
      },
      {
        src: '/icons/icon-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable any',
      },
    ],
  }

  await fs.writeFile('manifest.json', JSON.stringify(manifest, null, 2))
  console.log('✅ Created: manifest.json')
}

async function createPackageJson() {
  console.log('\n📦 Creating package.json...')

  const packageJson = {
    name: 'sliffs',
    version: '1.0.0',
    description:
      'SLIFFS - Prima789 LINE Integration Functions & Front-end System',
    main: 'index.js',
    scripts: {
      dev: 'netlify dev',
      build: "echo 'Build completed'",
      deploy: 'netlify deploy --prod',
      'deploy:preview': 'netlify deploy',
      setup: 'node quick-setup.js',
      test: 'node scripts/test-functions.js',
      'check-health':
        'curl https://sliffs.netlify.app/.netlify/functions/health-check',
    },
    keywords: [
      'netlify',
      'functions',
      'line',
      'prima789',
      'liff',
      'postgresql',
    ],
    author: 'SLIFFS Team',
    license: 'MIT',
    dependencies: {
      pg: '^8.11.3',
      'node-fetch': '^2.7.0',
    },
    devDependencies: {
      'netlify-cli': '^17.10.1',
    },
    engines: {
      node: '>=18.0.0',
    },
  }

  await fs.writeFile('package.json', JSON.stringify(packageJson, null, 2))
  console.log('✅ Created: package.json')
}

async function createNetlifyConfig() {
  console.log('\n🌐 Creating netlify.toml...')

  const netlifyConfig = `[build]
  functions = "netlify/functions"
  publish = "."

[functions]
  node_bundler = "esbuild"

[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "DENY"
    X-Content-Type-Options = "nosniff"

[[headers]]
  for = "/.netlify/functions/*"
  [headers.values]
    Access-Control-Allow-Origin = "*"
    Access-Control-Allow-Headers = "Content-Type, Authorization"
    Access-Control-Allow-Methods = "GET, POST, OPTIONS"

[[redirects]]
  from = "/api/*"
  to = "/.netlify/functions/:splat"
  status = 200`

  await fs.writeFile('netlify.toml', netlifyConfig)
  console.log('✅ Created: netlify.toml')
}

async function createIndexHtml() {
  console.log('\n🌐 Creating index.html...')

  const indexHtml = `<!DOCTYPE html>
<html lang="th">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SLIFFS - Prima789 LINE Integration</title>
    <link rel="manifest" href="/manifest.json">
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        h1 { color: #00B900; }
        .status { padding: 20px; background: #f0f0f0; border-radius: 8px; margin: 20px 0; }
        .links a { display: block; margin: 10px 0; padding: 10px; background: #00B900; color: white; text-decoration: none; border-radius: 4px; }
        .links a:hover { background: #008800; }
    </style>
</head>
<body>
    <h1>🎯 SLIFFS Dashboard</h1>
    <p>Prima789 & LINE Integration System</p>
    
    <div class="status">
        <h3>🔍 System Status</h3>
        <p id="status">Checking system health...</p>
    </div>
    
    <div class="links">
        <h3>🔗 Quick Links</h3>
        <a href="/liff-member-card.html">📱 Member Card</a>
        <a href="/liff-account-linking.html">🔗 Account Linking</a>
        <a href="/.netlify/functions/health-check">🏥 Health Check</a>
    </div>
    
    <script>
        // Check system health on load
        fetch('/.netlify/functions/health-check')
            .then(r => r.json())
            .then(data => {
                const statusEl = document.getElementById('status');
                if (data.success) {
                    statusEl.innerHTML = \`✅ System is healthy! Database: \${data.database.status}\`;
                    statusEl.style.color = 'green';
                } else {
                    statusEl.innerHTML = \`❌ System has issues: \${data.error}\`;
                    statusEl.style.color = 'red';
                }
            })
            .catch(err => {
                document.getElementById('status').innerHTML = \`⚠️ Cannot connect to system\`;
                document.getElementById('status').style.color = 'orange';
            });
    </script>
</body>
</html>`

  await fs.writeFile('index.html', indexHtml)
  console.log('✅ Created: index.html')
}

async function createEnvTemplate() {
  console.log('\n🔐 Creating .env.example...')

  const envTemplate = `# SLIFFS Environment Variables
# Copy this to .env and fill in your values

# Database Configuration
DATABASE_URL=postgresql://username:password@hostname:5432/dbname

# Environment
NODE_ENV=production
NETLIFY_URL=https://sliffs.netlify.app

# LINE Platform (Optional)
CHANNEL_ACCESS_TOKEN=your_channel_access_token
CHANNEL_SECRET=your_channel_secret
LIFF_ID=your_liff_id

# Prima789 Integration (Optional)
PRIMA789_API_URL=https://your-prima789-api.com
PRIMA789_API_KEY=your_api_key
`

  await fs.writeFile('.env.example', envTemplate)
  console.log('✅ Created: .env.example')
}

async function runQuickSetup() {
  try {
    console.log('🎯 SLIFFS Quick Setup Starting...\n')

    await createDirectories()
    await createDatabaseUtil()
    await createSyncFunctions()
    await createHealthCheck()
    await createManifest()
    await createPackageJson()
    await createNetlifyConfig()
    await createIndexHtml()
    await createEnvTemplate()

    console.log('\n🎉 Setup completed successfully!\n')

    console.log('📋 Next steps:')
    console.log('1. Copy .env.example to .env and configure your database')
    console.log('2. Run: npm install')
    console.log('3. Run: npm run deploy')
    console.log('4. Test: npm run check-health\n')

    console.log('🔗 Your functions will be available at:')
    console.log('• https://sliffs.netlify.app/.netlify/functions/health-check')
    console.log(
      '• https://sliffs.netlify.app/.netlify/functions/prima789-line-sync'
    )
    console.log(
      '• https://sliffs.netlify.app/.netlify/functions/check-account-linking\n'
    )

    console.log('✅ All files created successfully!')
    console.log('🚀 Ready to deploy your SLIFFS system!')
  } catch (error) {
    console.error('\n❌ Setup failed:', error)
    console.error('Please check the error above and try again.')
    process.exit(1)
  }
}

// Run the setup
runQuickSetup()
