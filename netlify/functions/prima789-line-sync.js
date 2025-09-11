// prima789-line-sync.js - Simplified Auto-Sync for Prima789.com
;(function () {
  'use strict'

  class Prima789LineSync {
    constructor(config = {}) {
      this.config = {
        apiBaseUrl:
          config.apiBaseUrl || 'https://sliffs.netlify.app/.netlify/functions',
        syncInterval: config.syncInterval || 60000, // 60 seconds
        retryAttempts: config.retryAttempts || 3,
        retryDelay: config.retryDelay || 5000,
        enableNotifications: config.enableNotifications !== false,
        enableAutoSync: config.enableAutoSync !== false,
        enableTransactionLogging: config.enableTransactionLogging !== false,
        debug: config.debug || false,
      }

      this.isInitialized = false
      this.currentUser = null
      this.lastSyncData = {}
      this.syncInterval = null
      this.observers = []
      this.retryCount = 0
      this.isProcessing = false

      this.log('Prima789 LINE Sync initializing...')
      this.init()
    }

    log(message, level = 'info') {
      if (this.config.debug) {
        console.log(`[Prima789Sync] ${message}`)
      }
    }

    async init() {
      if (this.isInitialized) return

      try {
        // รอให้หน้าเว็บโหลดเสร็จ
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', () => this.setup())
        } else {
          await this.setup()
        }

        this.isInitialized = true
        this.log('✅ Prima789 LINE Sync initialized successfully')
      } catch (error) {
        this.log(`❌ Failed to initialize: ${error.message}`, 'error')
      }
    }

    async setup() {
      // ตรวจสอบว่าอยู่ในหน้าที่เหมาะสม
      if (!this.isValidPage()) {
        this.log('Not a valid page for sync, skipping setup')
        return
      }

      // รอให้ user data โหลด
      await this.waitForUserData()

      if (this.currentUser) {
        this.log(`User detected: ${this.currentUser.username}`)

        // ทำ initial sync
        await this.performInitialSync()

        // ตั้งค่า monitoring
        this.setupDataMonitoring()

        // ตั้งค่า auto-sync
        if (this.config.enableAutoSync) {
          this.setupAutoSync()
        }

        // ตั้งค่า transaction monitoring
        if (this.config.enableTransactionLogging) {
          this.setupTransactionMonitoring()
        }
      } else {
        this.log('No user data found, sync not active')
      }
    }

    isValidPage() {
      const validPaths = ['/member', '/dashboard', '/profile', '/account']
      const currentPath = window.location.pathname.toLowerCase()
      return validPaths.some((path) => currentPath.includes(path))
    }

    async waitForUserData(maxAttempts = 10, interval = 1000) {
      for (let i = 0; i < maxAttempts; i++) {
        if (this.detectCurrentUser()) {
          return true
        }

        this.log(`Waiting for user data... attempt ${i + 1}/${maxAttempts}`)
        await this.delay(interval)
      }

      this.log('User data not found after waiting')
      return false
    }

    detectCurrentUser() {
      // วิธีที่ 1: จาก Global JavaScript variables
      const globalSources = [
        'window.currentUser',
        'window.user',
        'window.userData',
        'window.member',
        'window.userInfo',
      ]

      for (const source of globalSources) {
        const userData = this.getNestedProperty(
          window,
          source.replace('window.', '')
        )
        if (userData && (userData.username || userData.id)) {
          this.currentUser = this.normalizeUserData(userData)
          this.log(`User data found from: ${source}`)
          return true
        }
      }

      // วิธีที่ 2: จาก localStorage
      const storageKeys = [
        'user',
        'currentUser',
        'userData',
        'member',
        'userInfo',
      ]
      for (const key of storageKeys) {
        try {
          const stored = localStorage.getItem(key)
          if (stored) {
            const userData = JSON.parse(stored)
            if (userData && (userData.username || userData.id)) {
              this.currentUser = this.normalizeUserData(userData)
              this.log(`User data found from localStorage: ${key}`)
              return true
            }
          }
        } catch (e) {
          // Invalid JSON, skip
        }
      }

      // วิธีที่ 3: จาก DOM elements
      const userData = this.extractUserDataFromDOM()
      if (userData.username) {
        this.currentUser = userData
        this.log('User data found from DOM elements')
        return true
      }

      // วิธีที่ 4: จาก cookies
      const cookieKeys = ['user', 'member', 'userData']
      for (const key of cookieKeys) {
        try {
          const cookieValue = this.getCookie(key)
          if (cookieValue) {
            const userData = JSON.parse(decodeURIComponent(cookieValue))
            if (userData && (userData.username || userData.id)) {
              this.currentUser = this.normalizeUserData(userData)
              this.log(`User data found from cookie: ${key}`)
              return true
            }
          }
        } catch (e) {
          // Invalid JSON, skip
        }
      }

      return false
    }

    normalizeUserData(userData) {
      return {
        username: userData.username || userData.id || userData.user_id,
        displayName:
          userData.displayName ||
          userData.name ||
          userData.display_name ||
          userData.username,
        phoneNumber:
          userData.phoneNumber || userData.phone || userData.phone_number,
        email: userData.email || userData.email_address,
        balance: this.parseNumber(userData.balance || userData.amount || 0),
        points: this.parseNumber(userData.points || userData.point || 0),
        tier: userData.tier || userData.level || userData.rank || 'Bronze',
      }
    }

    extractUserDataFromDOM() {
      const selectors = {
        username:
          '[data-username], .username, #username, .user-id, [data-user-id]',
        displayName:
          '[data-display-name], .display-name, .user-name, [data-user-name]',
        balance:
          '[data-balance], .balance, #balance, .user-balance, [data-user-balance]',
        points:
          '[data-points], .points, #points, .user-points, [data-user-points]',
        tier: '[data-tier], .tier, .level, [data-level], .rank, [data-rank]',
      }

      const userData = {}

      for (const [key, selector] of Object.entries(selectors)) {
        const element = document.querySelector(selector)
        if (element) {
          let value =
            element.textContent ||
            element.value ||
            element.getAttribute('data-value')

          if (key === 'balance' || key === 'points') {
            value = this.parseNumber(value)
          }

          userData[key] = value
        }
      }

      return userData
    }

    parseNumber(value) {
      if (typeof value === 'number') return value
      if (typeof value === 'string') {
        // ลบ comma และสัญลักษณ์ที่ไม่ใช่ตัวเลข
        const cleaned = value.replace(/[^0-9.-]/g, '')
        const parsed = parseFloat(cleaned)
        return isNaN(parsed) ? 0 : parsed
      }
      return 0
    }

    getNestedProperty(obj, path) {
      return path
        .split('.')
        .reduce((current, key) => current && current[key], obj)
    }

    async performInitialSync() {
      if (this.isProcessing) return

      this.isProcessing = true
      this.log('Performing initial sync...')

      try {
        const userData = this.getCurrentUserData()
        await this.syncToLINE(userData)
        this.lastSyncData = userData
        this.retryCount = 0

        this.log('✅ Initial sync completed')
      } catch (error) {
        this.log(`❌ Initial sync failed: ${error.message}`, 'error')
        this.scheduleRetry()
      } finally {
        this.isProcessing = false
      }
    }

    getCurrentUserData() {
      // รีเฟรช user data จาก DOM
      const currentDOMData = this.extractUserDataFromDOM()

      // รวมข้อมูลจากหลายแหล่ง
      return {
        username: this.currentUser.username,
        displayName: currentDOMData.displayName || this.currentUser.displayName,
        phoneNumber: this.currentUser.phoneNumber,
        email: this.currentUser.email,
        balance:
          currentDOMData.balance !== undefined
            ? currentDOMData.balance
            : this.currentUser.balance,
        points:
          currentDOMData.points !== undefined
            ? currentDOMData.points
            : this.currentUser.points,
        tier: currentDOMData.tier || this.currentUser.tier,
        lastActivity: new Date().toISOString(),
        source: 'prima789_web',
      }
    }

    setupDataMonitoring() {
      // เฝ้าดูการเปลี่ยนแปลงใน DOM
      const observer = new MutationObserver(() => {
        this.checkForDataChanges()
      })

      // เฝ้าดู elements ที่เกี่ยวข้อง
      const elementsToWatch = document.querySelectorAll(
        '[data-balance], .balance, #balance, .user-balance, ' +
          '[data-points], .points, #points, .user-points, ' +
          '[data-tier], .tier, .level, .rank'
      )

      elementsToWatch.forEach((element) => {
        observer.observe(element, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
          attributeFilter: ['data-value', 'value'],
        })
      })

      this.observers.push(observer)

      // เฝ้าดูการเปลี่ยนแปลงใน localStorage
      this.interceptStorageUpdates()

      this.log('Data monitoring setup completed')
    }

    interceptStorageUpdates() {
      const originalSetItem = localStorage.setItem
      const self = this

      localStorage.setItem = function (key, value) {
        originalSetItem.call(localStorage, key, value)

        const relevantKeys = ['user', 'currentUser', 'userData', 'member']
        if (relevantKeys.includes(key)) {
          setTimeout(() => self.checkForDataChanges(), 100)
        }
      }
    }

    async checkForDataChanges() {
      if (this.isProcessing) return

      try {
        const currentData = this.getCurrentUserData()

        if (this.hasSignificantChanges(currentData)) {
          this.log('Significant data changes detected')
          await this.syncToLINE(currentData)
          this.lastSyncData = currentData
        }
      } catch (error) {
        this.log(`Error checking data changes: ${error.message}`, 'error')
      }
    }

    hasSignificantChanges(newData) {
      if (!this.lastSyncData || Object.keys(this.lastSyncData).length === 0) {
        return true
      }

      const thresholds = {
        balanceChange: 50, // 50 บาท
        pointsChange: 5, // 5 คะแนน
        tierChange: true,
      }

      // เช็คการเปลี่ยนแปลงยอดเงิน
      if (
        Math.abs((newData.balance || 0) - (this.lastSyncData.balance || 0)) >=
        thresholds.balanceChange
      ) {
        return true
      }

      // เช็คการเปลี่ยนแปลงคะแนน
      if (
        Math.abs((newData.points || 0) - (this.lastSyncData.points || 0)) >=
        thresholds.pointsChange
      ) {
        return true
      }

      // เช็คการเปลี่ยนแปลง tier
      if ((newData.tier || 'Bronze') !== (this.lastSyncData.tier || 'Bronze')) {
        return true
      }

      return false
    }

    setupAutoSync() {
      if (this.syncInterval) {
        clearInterval(this.syncInterval)
      }

      this.syncInterval = setInterval(async () => {
        if (!this.isProcessing) {
          await this.performPeriodicSync()
        }
      }, this.config.syncInterval)

      this.log(`Auto-sync enabled with interval: ${this.config.syncInterval}ms`)
    }

    async performPeriodicSync() {
      try {
        const userData = this.getCurrentUserData()
        await this.syncToLINE(userData, false) // ไม่ force sync
        this.log('Periodic sync completed')
      } catch (error) {
        this.log(`Periodic sync failed: ${error.message}`, 'error')
      }
    }

    setupTransactionMonitoring() {
      // เฝ้าดู form submissions
      document.addEventListener('submit', (event) => {
        this.handleFormSubmit(event)
      })

      // เฝ้าดู AJAX requests
      this.interceptAjaxRequests()

      this.log('Transaction monitoring setup completed')
    }

    handleFormSubmit(event) {
      const form = event.target

      if (this.isTransactionForm(form)) {
        this.log('Transaction form detected')

        // รอให้ form submit เสร็จแล้วค่อย sync
        setTimeout(() => {
          this.checkForDataChanges()
        }, 2000)
      }
    }

    isTransactionForm(form) {
      const transactionIndicators = [
        'deposit',
        'withdraw',
        'transfer',
        'payment',
        'ฝาก',
        'ถอน',
        'โอน',
        'ชำระ',
      ]

      const formText = (
        form.className +
        ' ' +
        form.id +
        ' ' +
        form.action
      ).toLowerCase()

      return transactionIndicators.some((indicator) =>
        formText.includes(indicator)
      )
    }

    interceptAjaxRequests() {
      // Intercept fetch requests
      const originalFetch = window.fetch
      const self = this

      window.fetch = async function (...args) {
        const response = await originalFetch(...args)

        const url = args[0]
        if (typeof url === 'string' && self.isTransactionAPI(url)) {
          self.log('Transaction API detected')
          setTimeout(() => self.checkForDataChanges(), 1000)
        }

        return response
      }
    }

    isTransactionAPI(url) {
      const transactionAPIs = [
        '/deposit',
        '/withdraw',
        '/transfer',
        '/payment',
        '/balance',
        '/point',
        '/transaction',
      ]

      return transactionAPIs.some((api) => url.includes(api))
    }

    async syncToLINE(userData, force = true) {
      if (!userData.username) {
        throw new Error('No username available for sync')
      }

      // ถ้าไม่ใช่ force sync ให้เช็คการเปลี่ยนแปลงก่อน
      if (!force && !this.hasSignificantChanges(userData)) {
        this.log('No significant changes, skipping sync')
        return
      }

      this.log('Syncing data to LINE...')

      const payload = {
        username: userData.username,
        userData: {
          displayName: userData.displayName,
          phoneNumber: userData.phoneNumber,
          email: userData.email,
          balance: userData.balance,
          points: userData.points,
          tier: userData.tier,
          lastActivity: userData.lastActivity,
          source: userData.source,
        },
      }

      const response = await fetch(`${this.config.apiBaseUrl}/sync-user-data`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        throw new Error(
          `Sync failed: ${response.status} ${response.statusText}`
        )
      }

      const result = await response.json()

      if (!result.success) {
        throw new Error(result.error || 'Sync failed')
      }

      this.log('✅ Data synced to LINE successfully')

      // แสดงการแจ้งเตือน (ถ้าเปิดใช้งาน)
      if (this.config.enableNotifications && force) {
        this.showSyncNotification('success')
      }

      return result
    }

    async scheduleRetry() {
      if (this.retryCount >= this.config.retryAttempts) {
        this.log('Max retry attempts reached')
        this.showSyncNotification('error')
        return
      }

      this.retryCount++
      this.log(
        `Scheduling retry ${this.retryCount}/${this.config.retryAttempts} in ${this.config.retryDelay}ms`
      )

      setTimeout(async () => {
        await this.performInitialSync()
      }, this.config.retryDelay)
    }

    showSyncNotification(type) {
      if (!this.config.enableNotifications) return

      const messages = {
        success: '✅ ข้อมูลซิงค์กับ LINE สำเร็จ',
        error: '❌ การซิงค์ข้อมูลล้มเหลว กรุณาลองใหม่',
        processing: '🔄 กำลังซิงค์ข้อมูล...',
      }

      // แสดงการแจ้งเตือนแบบง่าย
      if (window.alert && type === 'error') {
        // แสดง error เฉพาะในกรณีที่สำคัญ
        return
      }

      // หรือสร้าง notification element
      this.createNotificationElement(messages[type], type)
    }

    createNotificationElement(message, type) {
      const notification = document.createElement('div')
      notification.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background: ${
                  type === 'error'
                    ? '#FF6B6B'
                    : type === 'success'
                    ? '#06C755'
                    : '#007bff'
                };
                color: white;
                padding: 12px 16px;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                z-index: 10000;
                font-size: 14px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                max-width: 300px;
                opacity: 0;
                transform: translateX(100%);
                transition: all 0.3s ease;
            `
      notification.textContent = message

      document.body.appendChild(notification)

      // แสดง notification
      setTimeout(() => {
        notification.style.opacity = '1'
        notification.style.transform = 'translateX(0)'
      }, 100)

      // ซ่อน notification หลัง 5 วินาที
      setTimeout(() => {
        notification.style.opacity = '0'
        notification.style.transform = 'translateX(100%)'

        setTimeout(() => {
          if (notification.parentNode) {
            notification.parentNode.removeChild(notification)
          }
        }, 300)
      }, 5000)
    }

    getCookie(name) {
      const value = `; ${document.cookie}`
      const parts = value.split(`; ${name}=`)
      if (parts.length === 2) {
        return parts.pop().split(';').shift()
      }
      return null
    }

    delay(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms))
    }

    // Public methods
    async manualSync() {
      if (this.isProcessing) {
        this.log('Sync already in progress')
        return false
      }

      if (!this.currentUser) {
        this.log('No user data available for manual sync')
        return false
      }

      try {
        const userData = this.getCurrentUserData()
        await this.syncToLINE(userData, true)
        return true
      } catch (error) {
        this.log(`Manual sync failed: ${error.message}`, 'error')
        return false
      }
    }

    getStatus() {
      return {
        isInitialized: this.isInitialized,
        hasUser: !!this.currentUser,
        isProcessing: this.isProcessing,
        lastSyncData: this.lastSyncData,
        retryCount: this.retryCount,
        config: this.config,
      }
    }

    destroy() {
      // ยกเลิก auto-sync
      if (this.syncInterval) {
        clearInterval(this.syncInterval)
        this.syncInterval = null
      }

      // ยกเลิก observers
      this.observers.forEach((observer) => observer.disconnect())
      this.observers = []

      this.log('Prima789 LINE Sync destroyed')
    }
  }

  // สร้าง instance หลัก
  window.Prima789LineSync =
    window.Prima789LineSync ||
    new Prima789LineSync(window.PRIMA789_CONFIG || {})

  // Public API
  window.syncToLINE = () => {
    return window.Prima789LineSync.manualSync()
  }

  window.getSyncStatus = () => {
    return window.Prima789LineSync.getStatus()
  }

  // Export สำหรับ ES modules
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Prima789LineSync
  }
})()
