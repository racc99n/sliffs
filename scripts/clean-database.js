/**
 * Clean Database Script - ลบตารางเก่าและสร้างใหม่
 * ใช้เมื่อต้องการเริ่มต้นฐานข้อมูลใหม่ทั้งหมด
 */

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.NETLIFY_DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function cleanAndRecreate() {
    console.log('🧹 กำลังลบตารางเก่าและสร้างใหม่...\n');
    
    try {
        // ลบตารางทั้งหมด
        const tables = [
            'system_logs',
            'socket_sync_sessions', 
            'transactions',
            'account_links',
            'prima789_accounts',
            'line_users'
        ];
        
        console.log('🗑️  ลบตารางเก่า...');
        for (const table of tables) {
            try {
                await pool.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
                console.log(`✅ ลบตาราง ${table} สำเร็จ`);
            } catch (error) {
                console.log(`⚠️  ไม่สามารถลบตาราง ${table}: ${error.message}`);
            }
        }
        
        console.log('\n🏗️  สร้างตารางใหม่...');
        
        // สร้าง extension
        await pool.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
        
        // สร้างตาราง line_users
        await pool.query(`
            CREATE TABLE line_users (
                id SERIAL PRIMARY KEY,
                line_user_id VARCHAR(255) UNIQUE NOT NULL,
                display_name VARCHAR(255),
                picture_url TEXT,
                status_message TEXT,
                language VARCHAR(10) DEFAULT 'th',
                is_linked BOOLEAN DEFAULT FALSE,
                prima789_username VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ สร้างตาราง line_users สำเร็จ');
        
        // สร้างตาราง prima789_accounts
        await pool.query(`
            CREATE TABLE prima789_accounts (
                id SERIAL PRIMARY KEY,
                username VARCHAR(255) UNIQUE NOT NULL,
                mm_user VARCHAR(255),
                acc_no VARCHAR(255),
                bank_id VARCHAR(50),
                bank_name VARCHAR(255),
                first_name VARCHAR(255),
                last_name VARCHAR(255),
                tel VARCHAR(50),
                email VARCHAR(255),
                available DECIMAL(15,2) DEFAULT 0.00,
                credit_limit DECIMAL(15,2) DEFAULT 0.00,
                bet_credit DECIMAL(15,2) DEFAULT 0.00,
                tier VARCHAR(50) DEFAULT 'Bronze',
                points INTEGER DEFAULT 0,
                total_transactions INTEGER DEFAULT 0,
                member_ref VARCHAR(255),
                register_time TIMESTAMP,
                last_login TIMESTAMP,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ สร้างตาราง prima789_accounts สำเร็จ');
        
        // สร้างตารางอื่นๆ
        await pool.query(`
            CREATE TABLE account_links (
                id SERIAL PRIMARY KEY,
                line_user_id VARCHAR(255),
                prima789_username VARCHAR(255),
                link_method VARCHAR(50),
                linked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_active BOOLEAN DEFAULT TRUE,
                UNIQUE(line_user_id, prima789_username)
            )
        `);
        console.log('✅ สร้างตาราง account_links สำเร็จ');
        
        await pool.query(`
            CREATE TABLE transactions (
                id SERIAL PRIMARY KEY,
                transaction_id VARCHAR(255) UNIQUE NOT NULL,
                line_user_id VARCHAR(255),
                prima789_username VARCHAR(255),
                transaction_type VARCHAR(50) NOT NULL,
                amount DECIMAL(15,2) DEFAULT 0.00,
                balance_before DECIMAL(15,2),
                balance_after DECIMAL(15,2),
                description TEXT,
                source VARCHAR(100),
                details JSONB,
                processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ สร้างตาราง transactions สำเร็จ');
        
        await pool.query(`
            CREATE TABLE socket_sync_sessions (
                id SERIAL PRIMARY KEY,
                sync_id VARCHAR(255) UNIQUE NOT NULL,
                line_user_id VARCHAR(255),
                status VARCHAR(50) DEFAULT 'waiting',
                prima789_data JSONB,
                completed_at TIMESTAMP,
                expires_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP + INTERVAL '10 minutes'),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ สร้างตาราง socket_sync_sessions สำเร็จ');
        
        await pool.query(`
            CREATE TABLE system_logs (
                id SERIAL PRIMARY KEY,
                level VARCHAR(20) DEFAULT 'INFO',
                source VARCHAR(100),
                message TEXT,
                data JSONB,
                user_id VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ สร้างตาราง system_logs สำเร็จ');
        
        // สร้าง indexes
        console.log('\n📊 สร้าง indexes...');
        await pool.query('CREATE INDEX idx_line_users_user_id ON line_users(line_user_id)');
        await pool.query('CREATE INDEX idx_prima789_accounts_username ON prima789_accounts(username)');
        await pool.query('CREATE INDEX idx_transactions_line_user ON transactions(line_user_id)');
        await pool.query('CREATE INDEX idx_transactions_created ON transactions(created_at)');
        console.log('✅ สร้าง indexes สำเร็จ');
        
        // เพิ่มข้อมูลตัวอย่าง
        console.log('\n🎭 เพิ่มข้อมูลตัวอย่าง...');
        await pool.query(`
            INSERT INTO prima789_accounts (username, mm_user, first_name, last_name, available, tier, points, register_time, last_login) 
            VALUES 
            ('testuser123', 'testuser123', 'สมชาย', 'ทดสอบ', 25680.50, 'Gold', 8750, NOW() - INTERVAL '30 days', NOW()),
            ('vipgamer99', 'vipgamer99', 'วีไอพี', 'เกมเมอร์', 155000.00, 'Diamond', 25680, NOW() - INTERVAL '60 days', NOW())
        `);
        console.log('✅ เพิ่มข้อมูลตัวอย่างสำเร็จ');
        
        console.log('\n🎉 ลบและสร้างฐานข้อมูลใหม่เสร็จสิ้น!');
        
    } catch (error) {
        console.error('❌ เกิดข้อผิดพลาด:', error);
    } finally {
        await pool.end();
    }
}

cleanAndRecreate();