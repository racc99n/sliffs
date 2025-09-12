/**
 * API Testing Script for Prima789 LINE Member Card System
 * Tests all deployed Netlify Functions with real database integration
 * Usage: node scripts/test-apis.js
 */

const fetch = require('node-fetch')
require('dotenv').config()

const BASE_URL = process.env.NETLIFY_URL || 'https://sliffs.netlify.app'
const WEBHOOK_API_KEY = process.env.PRIMA789_WEBHOOK_API_KEY

// Test configuration
const TEST_CONFIG = {
  timeout: 10000, // 10 seconds
  retries: 2,
  verbose: false,
}

// Test LINE user data
const TEST_LINE_USER = {
  userId: 'test_user_' + Date.now(),
  displayName: 'Test User API',
  pictureUrl: 'https://example.com/test-avatar.jpg',
  language: 'th',
}

// Test Prima789 data
const TEST_PRIMA789_DATA = {
  mm_user: 'test_api_user',
  username: 'test_api_user',
  first_name: 'Test',
  last_name: 'API User',
  available: 12500.75,
  credit_limit: 25000,
  tier: 'Silver',
  points: 1250,
  tel: '081-999-8888',
  bank_name: 'ทดสอบ API',
}

class APITester {
  constructor() {
    this.results = []
    this.passed = 0
    this.failed = 0
  }

  async runAllTests() {
    console.log('🧪 Starting API Tests...\n')
    console.log(`📍 Base URL: ${BASE_URL}`)
    console.log(`🔑 API Key: ${WEBHOOK_API_KEY ? 'Configured' : 'Missing'}\n`)

    // Basic API tests
    await this.testHealthCheck()
    await this.testAccountLinking()
    await this.testLinkAccount()
    await this.testBalanceInquiry()
    await this.testSyncUserData()
    await this.testTransactionWebhook()
    await this.testSocketSync()

    // Integration tests
    await this.testFullFlow()

    this.printSummary()
  }

  async apiCall(endpoint, options = {}) {
    const url = `${BASE_URL}/.netlify/functions${endpoint}`
    const timeout = TEST_CONFIG.timeout

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      })

      clearTimeout(timeoutId)

      const data = await response.json()

      return {
        ok: response.ok,
        status: response.status,
        data: data,
      }
    } catch (error) {
      clearTimeout(timeoutId)
      throw error
    }
  }

  async test(name, testFunc) {
    process.stdout.write(`🔬 ${name}... `)

    try {
      const result = await testFunc()

      if (result.success !== false) {
        console.log('✅ PASS')
        this.passed++
        this.results.push({ name, status: 'PASS', details: result })
      } else {
        console.log('❌ FAIL -', result.error || 'Unknown error')
        this.failed++
        this.results.push({ name, status: 'FAIL', error: result.error })
      }
    } catch (error) {
      console.log('❌ ERROR -', error.message)
      this.failed++
      this.results.push({ name, status: 'ERROR', error: error.message })
    }
  }

  // Test health check endpoint
  async testHealthCheck() {
    await this.test('Health Check', async () => {
      const response = await this.apiCall('/health-check')

      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}` }
      }

      const { status, database, statistics } = response.data

      if (status !== 'healthy') {
        return { success: false, error: `Status: ${status}` }
      }

      if (!database.connected) {
        return { success: false, error: 'Database not connected' }
      }

      return {
        success: true,
        database_version: database.version,
        stats: statistics,
      }
    })
  }

  // Test account linking check
  async testAccountLinking() {
    await this.test('Check Account Linking', async () => {
      const response = await this.apiCall(
        `/check-account-linking?lineUserId=${TEST_LINE_USER.userId}`
      )

      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}` }
      }

      const { success } = response.data

      if (!success) {
        return { success: false, error: 'API returned success: false' }
      }

      return { success: true, is_linked: response.data.isLinked }
    })
  }

  // Test account linking process
  async testLinkAccount() {
    await this.test('Link Prima789 Account', async () => {
      const requestData = {
        lineUserId: TEST_LINE_USER.userId,
        userProfile: TEST_LINE_USER,
        syncMethod: 'direct',
        prima789AccountData: TEST_PRIMA789_DATA,
      }

      const response = await this.apiCall('/link-prima789-account', {
        method: 'POST',
        body: JSON.stringify(requestData),
      })

      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}` }
      }

      const { success, account } = response.data

      if (!success) {
        return {
          success: false,
          error: response.data.error || 'Linking failed',
        }
      }

      return { success: true, linked_account: account?.username }
    })
  }

  // Test balance inquiry
  async testBalanceInquiry() {
    await this.test('Balance Inquiry', async () => {
      const requestData = {
        lineUserId: TEST_LINE_USER.userId,
        requestType: 'full',
      }

      const response = await this.apiCall('/balance-inquiry', {
        method: 'POST',
        body: JSON.stringify(requestData),
      })

      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}` }
      }

      const { success, isLinked, balance } = response.data

      if (!success) {
        return { success: false, error: 'Balance inquiry failed' }
      }

      return {
        success: true,
        is_linked: isLinked,
        balance: balance?.available || 0,
      }
    })
  }

  // Test sync user data
  async testSyncUserData() {
    await this.test('Sync User Data', async () => {
      const requestData = {
        lineUserId: TEST_LINE_USER.userId,
        userProfile: TEST_LINE_USER,
        prima789Data: TEST_PRIMA789_DATA,
        syncType: 'full',
      }

      const response = await this.apiCall('/sync-user-data', {
        method: 'POST',
        body: JSON.stringify(requestData),
      })

      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}` }
      }

      const { success, updates } = response.data

      if (!success) {
        return { success: false, error: 'Sync failed' }
      }

      return { success: true, updates: Object.keys(updates) }
    })
  }

  // Test transaction webhook
  async testTransactionWebhook() {
    await this.test('Transaction Webhook', async () => {
      if (!WEBHOOK_API_KEY) {
        return { success: false, error: 'API key not configured' }
      }

      const webhookData = {
        transaction_type: 'deposit',
        username: TEST_PRIMA789_DATA.username,
        user_id: TEST_PRIMA789_DATA.username,
        amount: 1000,
        balance_before: TEST_PRIMA789_DATA.available,
        balance_after: TEST_PRIMA789_DATA.available + 1000,
        transaction_id: `test_${Date.now()}`,
        timestamp: new Date().toISOString(),
        details: {
          source: 'api_test',
          test_data: true,
        },
      }

      const response = await this.apiCall('/transaction-webhook', {
        method: 'POST',
        headers: {
          'X-API-Key': WEBHOOK_API_KEY,
        },
        body: JSON.stringify(webhookData),
      })

      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}` }
      }

      const { success } = response.data

      if (!success) {
        return { success: false, error: 'Webhook processing failed' }
      }

      return { success: true, transaction_id: webhookData.transaction_id }
    })
  }

  // Test socket sync
  async testSocketSync() {
    await this.test('Socket Sync Session', async () => {
      // Create socket sync session first
      const createData = {
        lineUserId: TEST_LINE_USER.userId,
        userProfile: TEST_LINE_USER,
        syncMethod: 'socket',
      }

      const createResponse = await this.apiCall('/link-prima789-account', {
        method: 'POST',
        body: JSON.stringify(createData),
      })

      if (!createResponse.ok) {
        return { success: false, error: 'Failed to create sync session' }
      }

      const { syncId } = createResponse.data

      if (!syncId) {
        return { success: false, error: 'No sync ID returned' }
      }

      // Check sync status
      const statusResponse = await this.apiCall(
        `/check-sync-status?syncId=${syncId}`
      )

      if (!statusResponse.ok) {
        return { success: false, error: 'Failed to check sync status' }
      }

      const { success, status } = statusResponse.data

      if (!success) {
        return { success: false, error: 'Sync status check failed' }
      }

      return { success: true, sync_status: status, sync_id: syncId }
    })
  }

  // Test complete flow
  async testFullFlow() {
    await this.test('Full Integration Flow', async () => {
      const testUserId = 'flow_test_' + Date.now()
      const testUsername = 'flow_test_' + Date.now()

      try {
        // 1. Create LINE user and link account
        const linkResponse = await this.apiCall('/link-prima789-account', {
          method: 'POST',
          body: JSON.stringify({
            lineUserId: testUserId,
            userProfile: {
              userId: testUserId,
              displayName: 'Flow Test User',
            },
            syncMethod: 'direct',
            prima789AccountData: {
              ...TEST_PRIMA789_DATA,
              username: testUsername,
              mm_user: testUsername,
            },
          }),
        })

        if (!linkResponse.ok || !linkResponse.data.success) {
          return { success: false, error: 'Account linking failed' }
        }

        // 2. Check linking status
        const checkResponse = await this.apiCall(
          `/check-account-linking?lineUserId=${testUserId}`
        )

        if (!checkResponse.ok || !checkResponse.data.isLinked) {
          return { success: false, error: 'Account not properly linked' }
        }

        // 3. Send transaction webhook
        if (WEBHOOK_API_KEY) {
          await this.apiCall('/transaction-webhook', {
            method: 'POST',
            headers: { 'X-API-Key': WEBHOOK_API_KEY },
            body: JSON.stringify({
              transaction_type: 'bonus',
              username: testUsername,
              amount: 500,
              balance_after: TEST_PRIMA789_DATA.available + 500,
              transaction_id: `flow_test_${Date.now()}`,
              timestamp: new Date().toISOString(),
            }),
          })
        }

        // 4. Check balance
        const balanceResponse = await this.apiCall('/balance-inquiry', {
          method: 'POST',
          body: JSON.stringify({
            lineUserId: testUserId,
            requestType: 'full',
          }),
        })

        if (!balanceResponse.ok || !balanceResponse.data.success) {
          return { success: false, error: 'Balance inquiry failed' }
        }

        return {
          success: true,
          flow_complete: true,
          final_balance: balanceResponse.data.balance?.available,
        }
      } catch (error) {
        return { success: false, error: `Flow error: ${error.message}` }
      }
    })
  }

  printSummary() {
    console.log('\n📊 Test Results Summary')
    console.log('========================')
    console.log(`✅ Passed: ${this.passed}`)
    console.log(`❌ Failed: ${this.failed}`)
    console.log(`📊 Total:  ${this.passed + this.failed}`)
    console.log(
      `🎯 Success Rate: ${Math.round(
        (this.passed / (this.passed + this.failed)) * 100
      )}%`
    )

    if (this.failed > 0) {
      console.log('\n❌ Failed Tests:')
      this.results
        .filter((r) => r.status !== 'PASS')
        .forEach((result) => {
          console.log(`   • ${result.name}: ${result.error}`)
        })
    }

    console.log('\n🔗 Useful Links:')
    console.log(`   Dashboard: ${BASE_URL}/`)
    console.log(`   Health Check: ${BASE_URL}/.netlify/functions/health-check`)
    console.log(`   LIFF Member Card: ${BASE_URL}/liff-member-card.html`)
    console.log(
      `   LIFF Account Linking: ${BASE_URL}/liff-account-linking.html`
    )

    if (this.failed === 0) {
      console.log('\n🎉 All tests passed! System is ready for production.')
    } else {
      console.log(
        '\n⚠️  Some tests failed. Please check the configuration and try again.'
      )
    }
  }
}

// Command line interface
async function main() {
  const args = process.argv.slice(2)

  if (args.includes('--verbose')) {
    TEST_CONFIG.verbose = true
  }

  if (args.includes('--help')) {
    console.log('Prima789 API Testing Script')
    console.log('Usage: node test-apis.js [options]')
    console.log('Options:')
    console.log('  --verbose  Enable verbose output')
    console.log('  --help     Show this help message')
    return
  }

  const tester = new APITester()
  await tester.runAllTests()

  // Exit with error code if tests failed
  if (tester.failed > 0) {
    process.exit(1)
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('❌ Test script failed:', error.message)
    process.exit(1)
  })
}

module.exports = { APITester }
