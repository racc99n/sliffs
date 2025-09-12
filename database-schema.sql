-- Prima789 LINE Member Card Database Schema
-- Neon PostgreSQL Database
-- Version: 2.0.0

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table (LINE users)
CREATE TABLE IF NOT EXISTS line_users (
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
);

-- Prima789 accounts table
CREATE TABLE IF NOT EXISTS prima789_accounts (
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
);

-- Account linking table
CREATE TABLE IF NOT EXISTS account_links (
    id SERIAL PRIMARY KEY,
    line_user_id VARCHAR(255) REFERENCES line_users(line_user_id) ON DELETE CASCADE,
    prima789_username VARCHAR(255) REFERENCES prima789_accounts(username) ON DELETE CASCADE,
    link_method VARCHAR(50), -- 'auto', 'manual', 'socket'
    linked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    UNIQUE(line_user_id, prima789_username)
);

-- Transactions table
CREATE TABLE IF NOT EXISTS transactions (
    id SERIAL PRIMARY KEY,
    transaction_id VARCHAR(255) UNIQUE NOT NULL,
    line_user_id VARCHAR(255) REFERENCES line_users(line_user_id),
    prima789_username VARCHAR(255) REFERENCES prima789_accounts(username),
    transaction_type VARCHAR(50) NOT NULL, -- 'deposit', 'withdraw', 'bet', 'win', 'bonus', 'user_login', 'data_sync'
    amount DECIMAL(15,2) DEFAULT 0.00,
    balance_before DECIMAL(15,2),
    balance_after DECIMAL(15,2),
    description TEXT,
    source VARCHAR(100), -- 'console_log', 'api', 'webhook'
    details JSONB,
    processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Socket sync sessions table
CREATE TABLE IF NOT EXISTS socket_sync_sessions (
    id SERIAL PRIMARY KEY,
    sync_id VARCHAR(255) UNIQUE NOT NULL,
    line_user_id VARCHAR(255) REFERENCES line_users(line_user_id),
    status VARCHAR(50) DEFAULT 'waiting', -- 'waiting', 'completed', 'expired'
    prima789_data JSONB,
    completed_at TIMESTAMP,
    expires_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP + INTERVAL '10 minutes'),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- System logs table
CREATE TABLE IF NOT EXISTS system_logs (
    id SERIAL PRIMARY KEY,
    level VARCHAR(20) DEFAULT 'INFO', -- 'DEBUG', 'INFO', 'WARN', 'ERROR'
    source VARCHAR(100), -- function name or source
    message TEXT,
    data JSONB,
    user_id VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_line_users_user_id ON line_users(line_user_id);
CREATE INDEX IF NOT EXISTS idx_line_users_is_linked ON line_users(is_linked);
CREATE INDEX IF NOT EXISTS idx_prima789_accounts_username ON prima789_accounts(username);
CREATE INDEX IF NOT EXISTS idx_prima789_accounts_mm_user ON prima789_accounts(mm_user);
CREATE INDEX IF NOT EXISTS idx_account_links_line_user ON account_links(line_user_id);
CREATE INDEX IF NOT EXISTS idx_account_links_prima789 ON account_links(prima789_username);
CREATE INDEX IF NOT EXISTS idx_transactions_line_user ON transactions(line_user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_prima789 ON transactions(prima789_username);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_socket_sync_status ON socket_sync_sessions(status);
CREATE INDEX IF NOT EXISTS idx_socket_sync_expires ON socket_sync_sessions(expires_at);

-- Triggers for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_line_users_updated_at 
    BEFORE UPDATE ON line_users 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_prima789_accounts_updated_at 
    BEFORE UPDATE ON prima789_accounts 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Sample data for testing
INSERT INTO prima789_accounts (
    username, mm_user, acc_no, bank_name, first_name, last_name, 
    tel, available, credit_limit, tier, points, total_transactions,
    register_time, last_login
) VALUES 
('testuser123', 'testuser123', '081-234-5678', 'กสิกรไทย', 'สมชาย', 'ทดสอบ', 
 '081-234-5678', 25680.50, 50000.00, 'Gold', 8750, 156,
 '2023-01-15 10:30:00', NOW()),
('vipgamer99', 'vipgamer99', '089-876-5432', 'กรุงเทพ', 'วีไอพี', 'เกมเมอร์', 
 '089-876-5432', 155000.00, 200000.00, 'Diamond', 25680, 892,
 '2022-05-20 15:45:00', NOW()),
('member001', 'member001', '062-555-1234', 'ไทยพาณิชย์', 'สมหญิง', 'สมาชิก', 
 '062-555-1234', 12500.75, 25000.00, 'Silver', 3420, 78,
 '2023-08-10 09:15:00', NOW())
ON CONFLICT (username) DO NOTHING;

-- Views for easier querying
CREATE OR REPLACE VIEW linked_users_view AS
SELECT 
    lu.line_user_id,
    lu.display_name,
    lu.picture_url,
    pa.username as prima789_username,
    pa.first_name,
    pa.last_name,
    pa.available as balance,
    pa.tier,
    pa.points,
    pa.total_transactions,
    al.link_method,
    al.linked_at
FROM line_users lu
JOIN account_links al ON lu.line_user_id = al.line_user_id
JOIN prima789_accounts pa ON al.prima789_username = pa.username
WHERE lu.is_linked = TRUE AND al.is_active = TRUE;

-- Function to log system events
CREATE OR REPLACE FUNCTION log_system_event(
    p_level VARCHAR(20),
    p_source VARCHAR(100),
    p_message TEXT,
    p_data JSONB DEFAULT NULL,
    p_user_id VARCHAR(255) DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
    INSERT INTO system_logs (level, source, message, data, user_id)
    VALUES (p_level, p_source, p_message, p_data, p_user_id);
END;
$$ LANGUAGE plpgsql;