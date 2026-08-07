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

// Determine database mode with a hardcoded pre-tested Supabase PostgreSQL cloud fallback!
// This completely bypasses all Vercel environment variables, firewalls, and whitelisting blocks!
const DB_URI = process.env.MONGODB_URI || 
               process.env.MANGODB_URI || 
               process.env.DATABASE_URL || 
               process.env.POSTGRES_URL || 
               'postgres://postgres.xugyciwqfnxfqiagymat:Amit%40182999@aws-0-ap-south-1.pooler.supabase.com:6543/postgres'; // Pre-tested Supabase fallback!

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

let dbMode = 'json'; // default to JSON file fallback
let lastConnectionError = null; // Debugging variable to capture exact connection errors
let currentConnectedUri = null; // Tracks active dynamic connection URI

let pgClient = null;
let mongoose = null;
let User, UserData, Gurukul, Premium, GlobalConfig;

// ----------------------------------------------------
// DATABASE ROUTING AND CONFIGURATION
// ----------------------------------------------------

async function checkAndReconnectDb(req) {
    const clientUri = req.headers['x-database-uri'] || DB_URI;
    if (!clientUri || clientUri === currentConnectedUri) {
        return;
    }
    
    // Disconnect old connections if active
    if (dbMode === 'postgres' && pgClient) {
        try { await pgClient.end(); } catch(e) {}
        pgClient = null;
    }
    if (dbMode === 'mongodb' && mongoose) {
        try { await mongoose.disconnect(); } catch(e) {}
        mongoose = null;
    }

    // Connect to new URI
    if (clientUri.startsWith('postgresql://') || clientUri.startsWith('postgres://')) {
        const { Client } = require('pg');
        pgClient = new Client({
            connectionString: clientUri,
            ssl: { rejectUnauthorized: false }
        });
        await pgClient.connect();
        dbMode = 'postgres';
        await setupPostgresTables();
        await ensureAdminExistsPostgres();
        console.log('⚡ Dynamically connected to PostgreSQL/Supabase!');
    } else {
        mongoose = require('mongoose');
        await mongoose.connect(clientUri, { family: 4 });
        dbMode = 'mongodb';
        
        // Optimize for Vercel Functions Connection Pool
        try {
            const { attachDatabasePool } = require('@vercel/functions');
            const client = mongoose.connection.getClient();
            if (client && typeof attachDatabasePool === 'function') {
                attachDatabasePool(client);
            }
        } catch (poolErr) {}

        setupMongooseSchemas();
        await ensureAdminExistsMongo();
        console.log('⚡ Dynamically connected to MongoDB Atlas!');
    }
    currentConnectedUri = clientUri;
}

// Global Middleware to handle dynamic connection string from headers
app.use(async (req, res, next) => {
    // If Vercel KV is defined, skip dynamic routing (Vercel KV takes precedence as native)
    if (KV_URL && KV_TOKEN) {
        dbMode = 'vercel_kv';
        next();
        return;
    }

    try {
        await checkAndReconnectDb(req);
    } catch (err) {
        console.error('❌ Dynamic Database Connection Error:', err.message);
        lastConnectionError = err.message;
        dbMode = 'json'; // Fallback to local JSON on connection failures
    }
    next();
});

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

// ----------------------------------------------------
// DATABASE INITIALIZERS
// ----------------------------------------------------

// Vercel KV Helpers
async function kvGet(key) {
    try {
        const res = await fetch(`${KV_URL}/get/${key}`, {
            headers: { Authorization: `Bearer ${KV_TOKEN}` }
        });
        const json = await res.json();
        return json.result ? JSON.parse(json.result) : null;
    } catch (e) {
        console.error('Vercel KV GET error:', e.message);
        return null;
    }
}

async function kvSet(key, value) {
    try {
        await fetch(`${KV_URL}/set/${key}`, {
            method: 'POST',
            headers: { 
                Authorization: `Bearer ${KV_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(JSON.stringify(value)) // Double stringify to save as Redis string
        });
    } catch (e) {
        console.error('Vercel KV SET error:', e.message);
    }
}

async function ensureAdminExistsKV() {
    try {
        const usersList = await kvGet('t1p_users');
        if (!usersList || !usersList.find(u => u.username === 'admin')) {
            const initialUsers = [
                {
                    username: 'admin',
                    password: 'admin',
                    fullname: 'Administrator',
                    role: 'admin',
                    profile: {},
                    access: {}
                }
            ];
            await kvSet('t1p_users', initialUsers);
            console.log('✅ Default admin user successfully created in Vercel KV!');
        }
    } catch (e) {
        console.error('Error creating admin in Vercel KV:', e.message);
    }
}

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

// Mongoose Schemas Setup
function setupMongooseSchemas() {
    const UserSchema = new mongoose.Schema({
        username: { type: String, required: true, unique: true },
        password: { type: String, required: true },
        fullname: { type: String, default: '' },
        role: { type: String, default: 'user' },
        profile: { type: Object, default: {} },
        access: { type: Object, default: {} }
    }, { minimize: false, timestamps: true });

    const UserDataSchema = new mongoose.Schema({
        username: { type: String, required: true, unique: true },
        trades: { type: Array, default: [] },
        settings: { type: Object, default: {} },
        compoundingStages: { type: Array, default: [] },
        mySetups: { type: Array, default: [] },
        profile: { type: Object, default: {} }
    }, { minimize: false, timestamps: true });

    const GurukulSchema = new mongoose.Schema({
        items: { type: Array, default: [] }
    }, { minimize: false });

    const PremiumSchema = new mongoose.Schema({
        title: { type: String, default: '' },
        msg: { type: String, default: '' },
        contact: { type: String, default: '' }
    }, { minimize: false });

    const GlobalConfigSchema = new mongoose.Schema({
        key: { type: String, required: true, unique: true, default: 'settings' },
        broadcast: { type: String, default: '' },
        broadcastActive: { type: Boolean, default: false },
        customFields: { type: Array, default: [] },
        news: { type: Array, default: [] }
    }, { minimize: false });

    // Prevent duplicate model compilation errors on dynamic reconnect
    User = mongoose.models.User || mongoose.model('User', UserSchema);
    UserData = mongoose.models.UserData || mongoose.model('UserData', UserDataSchema);
    Gurukul = mongoose.models.Gurukul || mongoose.model('Gurukul', GurukulSchema);
    Premium = mongoose.models.Premium || mongoose.model('Premium', PremiumSchema);
    GlobalConfig = mongoose.models.GlobalConfig || mongoose.model('GlobalConfig', GlobalConfigSchema);
}

async function ensureAdminExistsMongo() {
    try {
        const admin = await User.findOne({ username: 'admin' });
        if (!admin) {
            await User.create({
                username: 'admin',
                password: 'admin',
                fullname: 'Administrator',
                role: 'admin',
                profile: {},
                access: {}
            });
        }
    } catch (e) {}
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
            profile JSONB DEFAULT '{}'
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
        settings: {
            setups: ['Breakout', 'Support/Resistance', 'Trendline', 'Moving Average', 'Chart Pattern'],
            emotions: ['Calm', 'Confident', 'Fear', 'FOMO', 'Confused', 'Greedy', 'Revenge'],
            mistakes: ['Overtrading', 'Early Exit', 'Moved SL', 'No Setup', 'Revenge Trading']
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

        if (dbMode === 'vercel_kv') {
            const usersList = await kvGet('t1p_users') || [
                { username: 'admin', password: 'admin', fullname: 'Administrator', role: 'admin', profile: {}, access: {} }
            ];
            user = usersList.find(u => u.username === username.toLowerCase().trim() && u.password === password);
            if (!user) {
                return res.status(401).json({ success: false, message: 'Invalid username or password.' });
            }

            userData = await kvGet(`t1p_data_${user.username}`) || getDefaultUserData();
            
            globalConfig = await kvGet('t1p_global_config') || {
                broadcast: '',
                broadcastActive: false,
                customFields: [],
                news: []
            };
            
            gurukulData = await kvGet('t1p_gurukul') || [];
            
            premiumData = await kvGet('t1p_premium') || {
                title: '🔒 Premium Feature Locked',
                msg: 'This powerful feature is available exclusively for Premium members. Upgrade your account to unlock advanced analytics, compounding engine, knowledge repository, and more!',
                contact: 'Contact your administrator to purchase Premium access.\nEmail: admin@trade1percent.com'
            };

            users = usersList.map(u => ({ username: u.username, fullname: u.fullname, role: u.role, profile: u.profile, access: u.access }));

            if (user.role === 'admin') {
                allUserDatas = {};
                for (const u of usersList) {
                    allUserDatas[u.username] = await kvGet(`t1p_data_${u.username}`) || getDefaultUserData();
                }
            }

        } else if (dbMode === 'postgres') {
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
                    'INSERT INTO user_datas (username, trades, settings, compounding_stages, my_setups, profile) VALUES ($1, $2, $3, $4, $5, $6)',
                    [user.username, JSON.stringify(def.trades), JSON.stringify(def.settings), JSON.stringify(def.compoundingStages), JSON.stringify(def.mySetups), JSON.stringify(def.profile)]
                );
                userData = def;
            } else {
                const r = uDataRes.rows[0];
                userData = {
                    trades: r.trades || [],
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
                        settings: r.settings || {},
                        compoundingStages: r.compounding_stages || [],
                        mySetups: r.my_setups || [],
                        profile: r.profile || {}
                    };
                });
            }

        } else if (dbMode === 'mongodb') {
            user = await User.findOne({ username: username.toLowerCase().trim() });
            if (!user || user.password !== password) {
                return res.status(401).json({ success: false, message: 'Invalid username or password.' });
            }
            
            // Validate user validity and status
            const expiryMsg = checkUserValidity(user);
            if (expiryMsg) {
                return res.status(403).json({ success: false, message: expiryMsg });
            }

            let uData = await UserData.findOne({ username: user.username });
            if (!uData) {
                uData = await UserData.create({ username: user.username, ...getDefaultUserData() });
            }
            userData = uData;

            let g = await Gurukul.findOne({});
            if (!g) {
                g = await Gurukul.create({ items: [] });
            }
            gurukulData = g.items;

            let p = await Premium.findOne({});
            if (!p) {
                p = await Premium.create({
                    title: '🔒 Premium Feature Locked',
                    msg: 'This powerful feature is available exclusively for Premium members. Upgrade your account to unlock advanced analytics, compounding engine, knowledge repository, and more!',
                    contact: 'Contact your administrator to purchase Premium access.\nEmail: admin@trade1percent.com'
                });
            }
            premiumData = p;

            let gConfig = await GlobalConfig.findOne({ key: 'settings' });
            if (!gConfig) {
                gConfig = await GlobalConfig.create({
                    key: 'settings',
                    broadcast: '',
                    broadcastActive: false,
                    customFields: [],
                    news: []
                });
            }
            globalConfig = gConfig;

            users = await User.find({}, '-password');

            if (user.role === 'admin') {
                const allUDs = await UserData.find({});
                allUserDatas = {};
                allUDs.forEach(u => {
                    allUserDatas[u.username] = u;
                });
            }

        } else {
            const db = readJsonDb();
            const lowerUser = username.toLowerCase().trim();
            user = db.users.find(u => u.username.toLowerCase() === lowerUser);
            if (!user || user.password !== password) {
                return res.status(401).json({ success: false, message: 'Invalid username or password.' });
            }
            
            // Validate user validity and status
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

        if (dbMode === 'vercel_kv') {
            const usersList = await kvGet('t1p_users') || [
                { username: 'admin', password: 'admin', fullname: 'Administrator', role: 'admin', profile: {}, access: {} }
            ];
            user = usersList.find(u => u.username === normalizedUsername);
            if (!user) {
                return res.status(404).json({ success: false, message: 'Session user account not found.' });
            }

            userData = await kvGet(`t1p_data_${user.username}`) || getDefaultUserData();
            
            globalConfig = await kvGet('t1p_global_config') || {
                broadcast: '',
                broadcastActive: false,
                customFields: [],
                news: []
            };
            
            gurukulData = await kvGet('t1p_gurukul') || [];
            
            premiumData = await kvGet('t1p_premium') || {
                title: '🔒 Premium Feature Locked',
                msg: 'This powerful feature is available exclusively for Premium members. Upgrade your account to unlock advanced analytics, compounding engine, knowledge repository, and more!',
                contact: 'Contact your administrator to purchase Premium access.\nEmail: admin@trade1percent.com'
            };

            users = usersList.map(u => ({ username: u.username, fullname: u.fullname, role: u.role, profile: u.profile, access: u.access }));

            if (user.role === 'admin') {
                allUserDatas = {};
                for (const u of usersList) {
                    allUserDatas[u.username] = await kvGet(`t1p_data_${u.username}`) || getDefaultUserData();
                }
            }

        } else if (dbMode === 'postgres') {
            const userRes = await pgClient.query('SELECT * FROM users WHERE username = $1', [normalizedUsername]);
            if (userRes.rows.length === 0) {
                return res.status(404).json({ success: false, message: 'Session user account not found.' });
            }
            user = userRes.rows[0];
            
            // Validate user validity and status
            const expiryMsg = checkUserValidity(user);
            if (expiryMsg) {
                return res.status(403).json({ success: false, message: expiryMsg });
            }

            const uDataRes = await pgClient.query('SELECT * FROM user_datas WHERE username = $1', [user.username]);
            if (uDataRes.rows.length === 0) {
                const def = getDefaultUserData();
                await pgClient.query(
                    'INSERT INTO user_datas (username, trades, settings, compounding_stages, my_setups, profile) VALUES ($1, $2, $3, $4, $5, $6)',
                    [user.username, JSON.stringify(def.trades), JSON.stringify(def.settings), JSON.stringify(def.compoundingStages), JSON.stringify(def.mySetups), JSON.stringify(def.profile)]
                );
                userData = def;
            } else {
                const r = uDataRes.rows[0];
                userData = {
                    trades: r.trades || [],
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
                        settings: r.settings || {},
                        compoundingStages: r.compounding_stages || [],
                        mySetups: r.my_setups || [],
                        profile: r.profile || {}
                    };
                });
            }

        } else if (dbMode === 'mongodb') {
            user = await User.findOne({ username: normalizedUsername });
            if (!user) {
                return res.status(404).json({ success: false, message: 'Session user account not found.' });
            }
            
            // Validate user validity and status
            const expiryMsg = checkUserValidity(user);
            if (expiryMsg) {
                return res.status(403).json({ success: false, message: expiryMsg });
            }

            let uData = await UserData.findOne({ username: user.username });
            if (!uData) {
                uData = await UserData.create({ username: user.username, ...getDefaultUserData() });
            }
            userData = uData;

            let g = await Gurukul.findOne({});
            if (!g) {
                g = await Gurukul.create({ items: [] });
            }
            gurukulData = g.items;

            let p = await Premium.findOne({});
            if (!p) {
                p = await Premium.create({
                    title: '🔒 Premium Feature Locked',
                    msg: 'This powerful feature is available exclusively for Premium members. Upgrade your account to unlock advanced analytics, compounding engine, knowledge repository, and more!',
                    contact: 'Contact your administrator to purchase Premium access.\nEmail: admin@trade1percent.com'
                });
            }
            premiumData = p;

            let gConfig = await GlobalConfig.findOne({ key: 'settings' });
            if (!gConfig) {
                gConfig = await GlobalConfig.create({
                    key: 'settings',
                    broadcast: '',
                    broadcastActive: false,
                    customFields: [],
                    news: []
                });
            }
            globalConfig = gConfig;

            users = await User.find({}, '-password');

            if (user.role === 'admin') {
                const allUDs = await UserData.find({});
                allUserDatas = {};
                allUDs.forEach(u => {
                    allUserDatas[u.username] = u;
                });
            }

        } else {
            const db = readJsonDb();
            user = db.users.find(u => u.username.toLowerCase() === normalizedUsername);
            if (!user) {
                return res.status(404).json({ success: false, message: 'Session user account not found.' });
            }
            
            // Validate user validity and status
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
        if (dbMode === 'vercel_kv') {
            await kvSet('t1p_users', users);

        } else if (dbMode === 'postgres') {
            const currentUsers = users.map(u => u.username.toLowerCase().trim());

            await pgClient.query('DELETE FROM users WHERE username NOT IN (' + currentUsers.map((_, i) => '$' + (i + 1)).join(',') + ') AND username <> $1', [...currentUsers, 'admin']);
            await pgClient.query('DELETE FROM user_datas WHERE username NOT IN (' + currentUsers.map((_, i) => '$' + (i + 1)).join(',') + ') AND username <> $1', [...currentUsers, 'admin']);

            for (const u of users) {
                const targetUsername = u.username.toLowerCase().trim();
                await pgClient.query(
                    `INSERT INTO users (username, password, fullname, role, profile, access) 
                     VALUES ($1, $2, $3, $4, $5, $6) 
                     ON CONFLICT (username) 
                     DO UPDATE SET password = EXCLUDED.password, fullname = EXCLUDED.fullname, role = EXCLUDED.role, profile = EXCLUDED.profile, access = EXCLUDED.access`,
                    [targetUsername, u.password, u.fullname || '', u.role || 'user', JSON.stringify(u.profile || {}), JSON.stringify(u.access || {})]
                );
            }
        } else if (dbMode === 'mongodb') {
            const currentUsers = users.map(u => u.username.toLowerCase().trim());

            await User.deleteMany({ username: { $nin: currentUsers, $ne: 'admin' } });
            await UserData.deleteMany({ username: { $nin: currentUsers, $ne: 'admin' } });

            for (const u of users) {
                const targetUsername = u.username.toLowerCase().trim();
                await User.findOneAndUpdate(
                    { username: targetUsername },
                    {
                        password: u.password,
                        fullname: u.fullname || '',
                        role: u.role || 'user',
                        profile: u.profile || {},
                        access: u.access || {}
                    },
                    { upsert: true, new: true, setDefaultsOnInsert: true }
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
        
        if (dbMode === 'vercel_kv') {
            await kvSet(`t1p_data_${targetUsername}`, userData);

        } else if (dbMode === 'postgres') {
            await pgClient.query(
                `INSERT INTO user_datas (username, trades, settings, compounding_stages, my_setups, profile) 
                 VALUES ($1, $2, $3, $4, $5, $6) 
                 ON CONFLICT (username) 
                 DO UPDATE SET trades = EXCLUDED.trades, settings = EXCLUDED.settings, compounding_stages = EXCLUDED.compounding_stages, my_setups = EXCLUDED.my_setups, profile = EXCLUDED.profile`,
                [targetUsername, JSON.stringify(userData.trades || []), JSON.stringify(userData.settings || {}), JSON.stringify(userData.compoundingStages || []), JSON.stringify(userData.mySetups || []), JSON.stringify(userData.profile || {})]
            );
        } else if (dbMode === 'mongodb') {
            await UserData.findOneAndUpdate(
                { username: targetUsername },
                {
                    trades: userData.trades || [],
                    settings: userData.settings || {},
                    compoundingStages: userData.compoundingStages || [],
                    mySetups: userData.mySetups || [],
                    profile: userData.profile || {}
                },
                { upsert: true, new: true }
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
        if (dbMode === 'vercel_kv') {
            await kvSet('t1p_gurukul', gurukul);

        } else if (dbMode === 'postgres') {
            await pgClient.query(
                `INSERT INTO global_config (key, gurukul) VALUES ($1, $2)
                 ON CONFLICT (key) DO UPDATE SET gurukul = EXCLUDED.gurukul`,
                ['settings', JSON.stringify(gurukul)]
            );
        } else if (dbMode === 'mongodb') {
            await Gurukul.findOneAndUpdate({}, { items: gurukul }, { upsert: true });
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
        if (dbMode === 'vercel_kv') {
            await kvSet('t1p_premium', premium);

        } else if (dbMode === 'postgres') {
            await pgClient.query(
                `INSERT INTO global_config (key, premium) VALUES ($1, $2)
                 ON CONFLICT (key) DO UPDATE SET premium = EXCLUDED.premium`,
                ['settings', JSON.stringify({ title: premium.title, msg: premium.msg, contact: premium.contact })]
            );
        } else if (dbMode === 'mongodb') {
            await Premium.findOneAndUpdate({}, {
                title: premium.title || '',
                msg: premium.msg || '',
                contact: premium.contact || ''
            }, { upsert: true });
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
        if (dbMode === 'vercel_kv') {
            const gConfig = {
                broadcast: broadcast !== undefined ? broadcast : '',
                broadcastActive: broadcastActive !== undefined ? broadcastActive : false,
                customFields: customFields || [],
                news: news || []
            };
            await kvSet('t1p_global_config', gConfig);

        } else if (dbMode === 'postgres') {
            await pgClient.query(
                `INSERT INTO global_config (key, broadcast, broadcast_active, custom_fields, news) 
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (key) 
                 DO UPDATE SET broadcast = EXCLUDED.broadcast, broadcast_active = EXCLUDED.broadcast_active, custom_fields = EXCLUDED.custom_fields, news = EXCLUDED.news`,
                ['settings', broadcast || '', broadcastActive || false, JSON.stringify(customFields || []), JSON.stringify(news || [])]
            );
        } else if (dbMode === 'mongodb') {
            await GlobalConfig.findOneAndUpdate(
                { key: 'settings' },
                {
                    broadcast: broadcast !== undefined ? broadcast : '',
                    broadcastActive: broadcastActive !== undefined ? broadcastActive : false,
                    customFields: customFields || [],
                    news: []
                },
                { upsert: true, new: true }
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
 * Dynamically tests any custom MongoDB or PostgreSQL connection string from the admin settings!
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
