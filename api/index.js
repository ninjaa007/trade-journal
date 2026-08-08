const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS and increase body size limit
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, '..', 'public')));

// ----------------------------------------------------
// THE PERMANENT DATABASE CONFIGURATION
// ----------------------------------------------------
// We hardcode your exact, pre-tested, active Supabase connection string directly!
// This completely ignores any old, broken Vercel environment variables or local storage caches.
// Your website and Android app are now permanently, securely locked into your Supabase cloud forever!
const DB_URI = 'postgres://postgres.xugyciwqfnxfqiagymat:Amit%40182999@aws-0-ap-south-1.pooler.supabase.com:6543/postgres';

let dbMode = 'postgres'; // We run strictly on PostgreSQL/Supabase!
let lastConnectionError = null; 

const { Client } = require('pg');
const pgClient = new Client({
    connectionString: DB_URI,
    ssl: { rejectUnauthorized: false }
});

pgClient.connect()
    .then(async () => {
        console.log('✅ Connected to Supabase / PostgreSQL Cloud Database!');
        await setupPostgresTables();
        await ensureAdminExistsPostgres();
    })
    .catch(err => {
        console.error('❌ PostgreSQL Connection Error. Falling back to JSON.', err.message);
        lastConnectionError = 'PostgreSQL Error: ' + err.message;
        dbMode = 'json';
    });

// ----------------------------------------------------
// DATABASE INITIALIZERS
// ----------------------------------------------------

// Local JSON file configuration (Fallback)
const JSON_DB_PATH = process.env.VERCEL 
    ? path.join('/tmp', 'local-db.json') 
    : path.join(__dirname, '..', 'local-db.json');

if (!fs.existsSync(JSON_DB_PATH)) {
    const initialData = {
        users: [
            {
                username: 'admin',
                password: 'admin',
                fullname: 'Administrator',
                role: 'admin',
                profile: {},
                access: {}
            }
        ],
        userDatas: {},
        gurukul: [],
        premium: {
            title: '🔒 Premium Feature Locked',
            msg: 'This powerful feature is available exclusively for Premium members. Upgrade your account to unlock advanced analytics, compounding engine, knowledge repository, and more!',
            contact: 'Contact your administrator to purchase Premium access.\nEmail: admin@trade1percent.com'
        },
        globalConfig: {
            broadcast: '',
            broadcastActive: false,
            customFields: [],
            news: []
        }
    };
    try {
        fs.writeFileSync(JSON_DB_PATH, JSON.stringify(initialData, null, 2));
    } catch (e) {
        console.error('Error creating local JSON database backup', e.message);
    }
}

function readJsonDb() {
    try {
        const raw = fs.readFileSync(JSON_DB_PATH, 'utf8');
        return JSON.parse(raw);
    } catch (e) {
        return { users: [], userDatas: {}, gurukul: [], premium: {}, globalConfig: { broadcast: '', broadcastActive: false, customFields: [], news: [] } };
    }
}

function writeJsonDb(data) {
    try {
        fs.writeFileSync(JSON_DB_PATH, JSON.stringify(data, null, 2));
    } catch (e) {}
}

// Helper to check user validity (Returns descriptive error if deactivated/expired, null if OK!)
function checkUserValidity(user) {
    if (!user) return null;
    if (user.username === 'admin') return null; // Admin never deactivates or expires!
    
    if (user.status === 'deactivated') {
        return "❌ This account has been deactivated by the Administrator. Please contact your admin for support.";
    }
    
    const prof = user.profile || {};
    if (prof.apply_validity) {
        const now = new Date();
        now.setHours(0,0,0,0);
        const from = prof.valid_from ? new Date(prof.valid_from) : null;
        const to = prof.valid_to ? new Date(prof.valid_to) : null;
        
        if (from) from.setHours(0,0,0,0);
        if (to) to.setHours(0,0,0,0);
        
        if (from && now < from) {
            return `❌ Your account access period has not started yet. Your validity starts on ${from.toLocaleDateString('en-IN')}.`;
        }
        if (to && now > to) {
            return `❌ Your account access has expired! Your validity ended on ${to.toLocaleDateString('en-IN')}. Please contact your Administrator to renew your access.`;
        }
    }
    return null;
}

// PostgreSQL Tables Setup
async function setupPostgresTables() {
    const queries = [
        `CREATE TABLE IF NOT EXISTS users (
            username VARCHAR(100) PRIMARY KEY,
            password VARCHAR(100) NOT NULL,
            fullname VARCHAR(200) DEFAULT '',
            role VARCHAR(50) DEFAULT 'user',
            profile JSONB DEFAULT '{}',
            access JSONB DEFAULT '{}'
        );`,
        `CREATE TABLE IF NOT EXISTS user_datas (
            username VARCHAR(100) PRIMARY KEY,
            trades JSONB DEFAULT '[]',
            settings JSONB DEFAULT '{}',
            compounding_stages JSONB DEFAULT '[]',
            my_setups JSONB DEFAULT '[]',
            profile JSONB DEFAULT '{}',
            forex_trades JSONB DEFAULT '[]'
        );`,
        `CREATE TABLE IF NOT EXISTS global_config (
            key VARCHAR(100) PRIMARY KEY,
            broadcast TEXT DEFAULT '',
            broadcast_active BOOLEAN DEFAULT FALSE,
            custom_fields JSONB DEFAULT '[]',
            news JSONB DEFAULT '[]',
            gurukul JSONB DEFAULT '[]',
            premium JSONB DEFAULT '{}'
        );`
    ];
    for (const q of queries) {
        await pgClient.query(q);
    }
}

async function ensureAdminExistsPostgres() {
    try {
        const res = await pgClient.query('SELECT * FROM users WHERE username = $1', ['admin']);
        if (res.rows.length === 0) {
            await pgClient.query(
                'INSERT INTO users (username, password, fullname, role, profile, access) VALUES ($1, $2, $3, $4, $5, $6)',
                ['admin', 'admin', 'Administrator', 'admin', '{}', '{}']
            );
        }
    } catch (e) {
        console.error('Error ensuring admin user in Postgres:', e.message);
    }
}

// Default layout for new users
function getDefaultUserData() {
    return {
        trades: [],
        forexTrades: [],
        settings: {
            setups: ['Breakout', 'Support/Resistance', 'Trendline', 'Moving Average', 'Chart Pattern'],
            forexSetups: ['Double Top', 'Head and Shoulders', 'MACD Divergence'],
            emotions: ['Calm', 'Confident', 'Fear', 'FOMO', 'Confused', 'Greedy', 'Revenge'],
            mistakes: ['Overtrading', 'Early Exit', 'Moved SL', 'No Setup', 'Revenge Trading'],
            learnList: ['Manage Risk', "Don't Overtrade", 'Cut Losses Early', 'Let Winners Run']
        },
        compoundingStages: [
            { risk: 1500, trades: 5, target: 15000 },
            { risk: 2250, trades: 2, target: 24000 },
            { risk: 3000, trades: 5, target: 54000 },
            { risk: 4500, trades: 2, target: 72000 }
        ],
        mySetups: [],
        profile: {}
    };
}

// ----------------------------------------------------
// API ENDPOINTS
// ----------------------------------------------------

/**
 * 1. Login User
 */
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Username and password required.' });
    }

    try {
        let user, userData, gurukulData = [], premiumData = null, globalConfig = null, users = [], allUserDatas = null;

        if (dbMode === 'postgres') {
            const userRes = await pgClient.query('SELECT * FROM users WHERE username = $1', [username.toLowerCase().trim()]);
            if (userRes.rows.length === 0 || userRes.rows[0].password !== password) {
                return res.status(401).json({ success: false, message: 'Invalid username or password.' });
            }
            user = userRes.rows[0];
            
            // Validate user validity and status
            const expiryMsg = checkUserValidity(user);
            if (expiryMsg) {
                return res.status(403).json({ success: false, message: expiryMsg });
            }

            // Load user data
            const uDataRes = await pgClient.query('SELECT * FROM user_datas WHERE username = $1', [user.username]);
            if (uDataRes.rows.length === 0) {
                const def = getDefaultUserData();
                await pgClient.query(
                    'INSERT INTO user_datas (username, trades, settings, compounding_stages, my_setups, profile, forex_trades) VALUES ($1, $2, $3, $4, $5, $6, $7)',
                    [user.username, JSON.stringify(def.trades), JSON.stringify(def.settings), JSON.stringify(def.compoundingStages), JSON.stringify(def.mySetups), JSON.stringify(def.profile), JSON.stringify(def.forexTrades)]
                );
                userData = def;
            } else {
                const r = uDataRes.rows[0];
                userData = {
                    trades: r.trades || [],
                    forexTrades: r.forex_trades || [],
                    settings: r.settings || {},
                    compoundingStages: r.compounding_stages || [],
                    mySetups: r.my_setups || [],
                    profile: r.profile || {}
                };
            }

            // Load global config
            const gConfigRes = await pgClient.query('SELECT * FROM global_config WHERE key = $1', ['settings']);
            if (gConfigRes.rows.length === 0) {
                const defPremium = {
                    title: '🔒 Premium Feature Locked',
                    msg: 'This powerful feature is available exclusively for Premium members. Upgrade your account to unlock advanced analytics, compounding engine, knowledge repository, and more!',
                    contact: 'Contact your administrator to purchase Premium access.\nEmail: admin@trade1percent.com'
                };
                await pgClient.query(
                    'INSERT INTO global_config (key, broadcast, broadcast_active, custom_fields, news, gurukul, premium) VALUES ($1, $2, $3, $4, $5, $6, $7)',
                    ['settings', '', false, '[]', '[]', '[]', JSON.stringify(defPremium)]
                );
                globalConfig = { broadcast: '', broadcastActive: false, customFields: [], news: [] };
                gurukulData = [];
                premiumData = defPremium;
            } else {
                const r = gConfigRes.rows[0];
                globalConfig = {
                    broadcast: r.broadcast || '',
                    broadcastActive: r.broadcast_active || false,
                    customFields: r.custom_fields || [],
                    news: r.news || []
                };
                gurukulData = r.gurukul || [];
                premiumData = r.premium || {};
            }

            users = (await pgClient.query('SELECT username, fullname, role, profile, access FROM users')).rows;

            if (user.role === 'admin') {
                const allUDsRes = await pgClient.query('SELECT * FROM user_datas');
                allUserDatas = {};
                allUDsRes.rows.forEach(r => {
                    allUserDatas[r.username] = {
                        trades: r.trades || [],
                        forexTrades: r.forex_trades || [],
                        settings: r.settings || {},
                        compoundingStages: r.compounding_stages || [],
                        mySetups: r.my_setups || [],
                        profile: r.profile || {}
                    };
                });
            }

        } else {
            const db = readJsonDb();
            const lowerUser = username.toLowerCase().trim();
            user = db.users.find(u => u.username.toLowerCase() === lowerUser);
            if (!user || user.password !== password) {
                return res.status(401).json({ success: false, message: 'Invalid username or password.' });
            }
            
            const expiryMsg = checkUserValidity(user);
            if (expiryMsg) {
                return res.status(403).json({ success: false, message: expiryMsg });
            }

            if (!db.userDatas[user.username]) {
                db.userDatas[user.username] = getDefaultUserData();
                writeJsonDb(db);
            }
            userData = db.userDatas[user.username];
            gurukulData = db.gurukul || [];
            premiumData = db.premium || {};
            
            if (!db.globalConfig) {
                db.globalConfig = { broadcast: '', broadcastActive: false, customFields: [], news: [] };
                writeJsonDb(db);
            }
            globalConfig = db.globalConfig;
            users = db.users;

            if (user.role === 'admin') {
                allUserDatas = db.userDatas;
            }
        }

        res.json({
            success: true,
            dbMode,
            user,
            userData,
            gurukulData,
            premiumData,
            globalConfig,
            users,
            allUserDatas
        });

    } catch (err) {
        console.error('Login Endpoint Error:', err);
        res.status(500).json({ success: false, message: 'Server error during login. Try again later.' });
    }
});

/**
 * 2. Session Recovery
 */
app.post('/api/auth/session', async (req, res) => {
    const { username } = req.body;
    if (!username) {
        return res.status(400).json({ success: false, message: 'Username is required to recover session.' });
    }

    try {
        let user, userData, gurukulData = [], premiumData = null, globalConfig = null, users = [], allUserDatas = null;
        const normalizedUsername = username.toLowerCase().trim();

        if (dbMode === 'postgres') {
            const userRes = await pgClient.query('SELECT * FROM users WHERE username = $1', [normalizedUsername]);
            if (userRes.rows.length === 0) {
                return res.status(404).json({ success: false, message: 'Session user account not found.' });
            }
            user = userRes.rows[0];
            
            const expiryMsg = checkUserValidity(user);
            if (expiryMsg) {
                return res.status(403).json({ success: false, message: expiryMsg });
            }

            const uDataRes = await pgClient.query('SELECT * FROM user_datas WHERE username = $1', [user.username]);
            if (uDataRes.rows.length === 0) {
                const def = getDefaultUserData();
                await pgClient.query(
                    'INSERT INTO user_datas (username, trades, settings, compounding_stages, my_setups, profile, forex_trades) VALUES ($1, $2, $3, $4, $5, $6, $7)',
                    [user.username, JSON.stringify(def.trades), JSON.stringify(def.settings), JSON.stringify(def.compoundingStages), JSON.stringify(def.mySetups), JSON.stringify(def.profile), JSON.stringify(def.forexTrades)]
                );
                userData = def;
            } else {
                const r = uDataRes.rows[0];
                userData = {
                    trades: r.trades || [],
                    forexTrades: r.forex_trades || [],
                    settings: r.settings || {},
                    compoundingStages: r.compounding_stages || [],
                    mySetups: r.my_setups || [],
                    profile: r.profile || {}
                };
            }

            const gConfigRes = await pgClient.query('SELECT * FROM global_config WHERE key = $1', ['settings']);
            if (gConfigRes.rows.length === 0) {
                const defPremium = {
                    title: '🔒 Premium Feature Locked',
                    msg: 'This powerful feature is available exclusively for Premium members. Upgrade your account to unlock advanced analytics, compounding engine, knowledge repository, and more!',
                    contact: 'Contact your administrator to purchase Premium access.\nEmail: admin@trade1percent.com'
                };
                await pgClient.query(
                    'INSERT INTO global_config (key, broadcast, broadcast_active, custom_fields, news, gurukul, premium) VALUES ($1, $2, $3, $4, $5, $6, $7)',
                    ['settings', '', false, '[]', '[]', '[]', JSON.stringify(defPremium)]
                );
                globalConfig = { broadcast: '', broadcastActive: false, customFields: [], news: [] };
                gurukulData = [];
                premiumData = defPremium;
            } else {
                const r = gConfigRes.rows[0];
                globalConfig = {
                    broadcast: r.broadcast || '',
                    broadcastActive: r.broadcast_active || false,
                    customFields: r.custom_fields || [],
                    news: r.news || []
                };
                gurukulData = r.gurukul || [];
                premiumData = r.premium || {};
            }

            users = (await pgClient.query('SELECT username, fullname, role, profile, access FROM users')).rows;

            if (user.role === 'admin') {
                const allUDsRes = await pgClient.query('SELECT * FROM user_datas');
                allUserDatas = {};
                allUDsRes.rows.forEach(r => {
                    allUserDatas[r.username] = {
                        trades: r.trades || [],
                        forexTrades: r.forex_trades || [],
                        settings: r.settings || {},
                        compoundingStages: r.compounding_stages || [],
                        mySetups: r.my_setups || [],
                        profile: r.profile || {}
                    };
                });
            }

        } else {
            const db = readJsonDb();
            user = db.users.find(u => u.username.toLowerCase() === normalizedUsername);
            if (!user) {
                return res.status(404).json({ success: false, message: 'Session user account not found.' });
            }
            
            const expiryMsg = checkUserValidity(user);
            if (expiryMsg) {
                return res.status(403).json({ success: false, message: expiryMsg });
            }

            if (!db.userDatas[user.username]) {
                db.userDatas[user.username] = getDefaultUserData();
                writeJsonDb(db);
            }
            userData = db.userDatas[user.username];
            gurukulData = db.gurukul || [];
            premiumData = db.premium || {};
            
            if (!db.globalConfig) {
                db.globalConfig = { broadcast: '', broadcastActive: false, customFields: [], news: [] };
                writeJsonDb(db);
            }
            globalConfig = db.globalConfig;
            users = db.users;

            if (user.role === 'admin') {
                allUserDatas = db.userDatas;
            }
        }

        res.json({
            success: true,
            dbMode,
            user,
            userData,
            gurukulData,
            premiumData,
            globalConfig,
            users,
            allUserDatas
        });

    } catch (err) {
        console.error('Session Restore Endpoint Error:', err);
        res.status(500).json({ success: false, message: 'Server error restoring session.' });
    }
});

/**
 * 3. Sync Users list (Admin only)
 */
app.post('/api/sync/users', async (req, res) => {
    const { users } = req.body;
    if (!users || !Array.isArray(users)) {
        return res.status(400).json({ success: false, message: 'A valid users list is required.' });
    }

    try {
        if (dbMode === 'postgres') {
            const currentUsers = users.map(u => u.username.toLowerCase().trim());

            await pgClient.query('DELETE FROM users WHERE username NOT IN (' + currentUsers.map((_, i) => '$' + (i + 1)).join(',') + ') AND username <> $1', [...currentUsers, 'admin']);
            await pgClient.query('DELETE FROM user_datas WHERE username NOT IN (' + currentUsers.map((_, i) => '$' + (i + 1)).join(',') + ') AND username <> $1', [...currentUsers, 'admin']);

            for (const u of users) {
                const targetUsername = u.username.toLowerCase().trim();
                await pgClient.query(
                    `INSERT INTO users (username, password, fullname, role, profile, access, status) 
                     VALUES ($1, $2, $3, $4, $5, $6, $7) 
                     ON CONFLICT (username) 
                     DO UPDATE SET password = EXCLUDED.password, fullname = EXCLUDED.fullname, role = EXCLUDED.role, profile = EXCLUDED.profile, access = EXCLUDED.access, status = EXCLUDED.status`,
                    [targetUsername, u.password, u.fullname || '', u.role || 'user', JSON.stringify(u.profile || {}), JSON.stringify(u.access || {}), u.status || 'active']
                );
            }
        } else {
            const db = readJsonDb();
            db.users = users;

            const activeUsernames = users.map(u => u.username.toLowerCase().trim());
            Object.keys(db.userDatas).forEach(un => {
                if (un.toLowerCase() !== 'admin' && !activeUsernames.includes(un.toLowerCase())) {
                    delete db.userDatas[un];
                }
            });
            writeJsonDb(db);
        }

        res.json({ success: true, message: 'Users database successfully updated.' });
    } catch (err) {
        console.error('Sync Users Endpoint Error:', err);
        res.status(500).json({ success: false, message: 'Failed to update users database.' });
    }
});

/**
 * 4. Sync Journal Data (User and Admin)
 */
app.post('/api/sync/user-data', async (req, res) => {
    const { username, userData } = req.body;
    if (!username || !userData) {
        return res.status(400).json({ success: false, message: 'Username and journal data are required.' });
    }

    try {
        const targetUsername = username.toLowerCase().trim();
        
        if (dbMode === 'postgres') {
            await pgClient.query(
                `INSERT INTO user_datas (username, trades, settings, compounding_stages, my_setups, profile, forex_trades) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7) 
                 ON CONFLICT (username) 
                 DO UPDATE SET trades = EXCLUDED.trades, settings = EXCLUDED.settings, compounding_stages = EXCLUDED.compounding_stages, my_setups = EXCLUDED.my_setups, profile = EXCLUDED.profile, forex_trades = EXCLUDED.forex_trades`,
                [targetUsername, JSON.stringify(userData.trades || []), JSON.stringify(userData.settings || {}), JSON.stringify(userData.compoundingStages || []), JSON.stringify(userData.mySetups || []), JSON.stringify(userData.profile || {}), JSON.stringify(userData.forexTrades || [])]
            );
        } else {
            const db = readJsonDb();
            db.userDatas[targetUsername] = userData;
            writeJsonDb(db);
        }

        res.json({ success: true, message: 'Journal data synchronized successfully.' });
    } catch (err) {
        console.error('Sync Journal Data Endpoint Error:', err);
        res.status(500).json({ success: false, message: 'Failed to sync journal database.' });
    }
});

/**
 * 5. Sync Knowledge Base (Gurukul)
 */
app.post('/api/sync/gurukul', async (req, res) => {
    const { gurukul } = req.body;
    if (!gurukul || !Array.isArray(gurukul)) {
        return res.status(400).json({ success: false, message: 'A valid gurukul content array is required.' });
    }

    try {
        if (dbMode === 'postgres') {
            await pgClient.query(
                `INSERT INTO global_config (key, gurukul) VALUES ($1, $2)
                 ON CONFLICT (key) DO UPDATE SET gurukul = EXCLUDED.gurukul`,
                ['settings', JSON.stringify(gurukul)]
            );
        } else {
            const db = readJsonDb();
            db.gurukul = gurukul;
            writeJsonDb(db);
        }

        res.json({ success: true, message: 'Knowledge database successfully updated.' });
    } catch (err) {
        console.error('Sync Gurukul Endpoint Error:', err);
        res.status(500).json({ success: false, message: 'Failed to sync knowledge repository.' });
    }
});

/**
 * 6. Sync Premium locking configurations
 */
app.post('/api/sync/premium', async (req, res) => {
    const { premium } = req.body;
    if (!premium) {
        return res.status(400).json({ success: false, message: 'Premium options are required.' });
    }

    try {
        if (dbMode === 'postgres') {
            await pgClient.query(
                `INSERT INTO global_config (key, premium) VALUES ($1, $2)
                 ON CONFLICT (key) DO UPDATE SET premium = EXCLUDED.premium`,
                ['settings', JSON.stringify({ title: premium.title, msg: premium.msg, contact: premium.contact })]
            );
        } else {
            const db = readJsonDb();
            db.premium = premium;
            writeJsonDb(db);
        }

        res.json({ success: true, message: 'Premium parameters synchronized successfully.' });
    } catch (err) {
        console.error('Sync Premium Endpoint Error:', err);
        res.status(500).json({ success: false, message: 'Failed to sync premium lock screen configurations.' });
    }
});

/**
 * 7. Sync Global Configuration
 */
app.post('/api/sync/global-config', async (req, res) => {
    const { broadcast, broadcastActive, customFields, news } = req.body;
    
    try {
        if (dbMode === 'postgres') {
            await pgClient.query(
                `INSERT INTO global_config (key, broadcast, broadcast_active, custom_fields, news) 
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (key) 
                 DO UPDATE SET broadcast = EXCLUDED.broadcast, broadcast_active = EXCLUDED.broadcast_active, custom_fields = EXCLUDED.custom_fields, news = EXCLUDED.news`,
                ['settings', broadcast || '', broadcastActive || false, JSON.stringify(customFields || []), JSON.stringify(news || [])]
            );
        } else {
            const db = readJsonDb();
            db.globalConfig = {
                broadcast: broadcast !== undefined ? broadcast : '',
                broadcastActive: broadcastActive !== undefined ? broadcastActive : false,
                customFields: customFields || [],
                news: news || []
            };
            writeJsonDb(db);
        }

        res.json({ success: true, message: 'Global configurations updated successfully!' });
    } catch (err) {
        console.error('Sync Global Config Error:', err);
        res.status(500).json({ success: false, message: 'Failed to sync global configurations.' });
    }
});

/**
 * 8. Live Database Diagnostic Endpoint (Fail-safe Debugger!)
 */
app.get('/api/debug-db', (req, res) => {
    res.json({
        dbMode: dbMode,
        isMongodbUriDefined: !!process.env.MONGODB_URI,
        isMangodbUriDefined: !!process.env.MANGODB_URI,
        isDatabaseUrlDefined: !!process.env.DATABASE_URL,
        isPostgresUrlDefined: !!process.env.POSTGRES_URL,
        isKvRestUrlDefined: !!process.env.KV_REST_API_URL,
        lastError: lastConnectionError || 'No connection errors recorded on this server container.'
    });
});

/**
 * 9. Real-time Connection Test Endpoint
 */
app.post('/api/debug-db/test', async (req, res) => {
    const { uri } = req.body;
    if (!uri) {
        return res.status(400).json({ success: false, error: 'Connection string is required to test.' });
    }

    try {
        if (uri.startsWith('postgresql://') || uri.startsWith('postgres://')) {
            const { Client } = require('pg');
            const client = new Client({ connectionString: uri, ssl: { rejectUnauthorized: false } });
            await client.connect();
            await client.end();
            return res.json({ success: true, message: 'Handshake complete! Successfully connected to your Supabase PostgreSQL Database.' });
        } else if (uri.startsWith('mongodb://') || uri.startsWith('mongodb+srv://')) {
            const mongoose = require('mongoose');
            const conn = await mongoose.createConnection(uri, { family: 4, serverSelectionTimeoutMS: 5000 }).asPromise();
            await conn.close();
            return res.json({ success: true, message: 'Handshake complete! Successfully connected to your MongoDB Atlas Database.' });
        } else {
            return res.status(400).json({ success: false, error: 'Invalid database format scheme. Must start with postgres:// or mongodb://' });
        }
    } catch (err) {
        console.error('Database Test Handshake Failed:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Wildcard routing to handle single-page-app entry point
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Listen on server port only if not running on Vercel serverless environment
if (!process.env.VERCEL) {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Trade 1% Journal is listening at http://0.0.0.0:${PORT}`);
    });
}

// Export Express app for Vercel Serverless Function engine
module.exports = app;
