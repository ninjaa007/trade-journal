const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS and increase body size limit (important if users upload base64 images of trade setups!)
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Determine database mode
const MONGODB_URI = process.env.MONGODB_URI || process.env.MANGODB_URI;
let dbMode = 'json'; // default to JSON file fallback

if (MONGODB_URI) {
    const mongoose = require('mongoose');
    mongoose.connect(MONGODB_URI, { family: 4 })
        .then(() => {
            console.log('✅ Connected to MongoDB Atlas Cloud Database!');
            dbMode = 'mongodb';
            ensureAdminExists();
        })
        .catch(err => {
            console.error('❌ MongoDB Connection Error. Falling back to JSON database.', err.message);
            dbMode = 'json';
        });
} else {
    console.log('ℹ️ No MONGODB_URI found in environment variables. Running in local JSON database mode (local-db.json).');
}

// ----------------------------------------------------
// DATABASE STRUCTURE & FALLBACK (local-db.json)
// ----------------------------------------------------
const JSON_DB_PATH = process.env.VERCEL 
    ? path.join('/tmp', 'local-db.json') 
    : path.join(__dirname, 'local-db.json');

// Initialize local JSON file if not exists
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

// Helper to read JSON DB
function readJsonDb() {
    try {
        const raw = fs.readFileSync(JSON_DB_PATH, 'utf8');
        return JSON.parse(raw);
    } catch (e) {
        console.error('Error reading JSON DB, restoring default structures', e);
        return { users: [], userDatas: {}, gurukul: [], premium: {}, globalConfig: { broadcast: '', customFields: [], news: [] } };
    }
}

// Helper to write JSON DB
function writeJsonDb(data) {
    try {
        fs.writeFileSync(JSON_DB_PATH, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('Error writing to JSON DB', e);
    }
}

// ----------------------------------------------------
// MONGODB SCHEMAS (if MONGODB_URI is provided)
// ----------------------------------------------------
let User, UserData, Gurukul, Premium, GlobalConfig;

if (process.env.MONGODB_URI || MONGODB_URI) {
    const mongoose = require('mongoose');

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

    User = mongoose.model('User', UserSchema);
    UserData = mongoose.model('UserData', UserDataSchema);
    Gurukul = mongoose.model('Gurukul', GurukulSchema);
    Premium = mongoose.model('Premium', PremiumSchema);
    GlobalConfig = mongoose.model('GlobalConfig', GlobalConfigSchema);
}

// Ensure at least one admin exists in MongoDB
async function ensureAdminExists() {
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
            console.log('✅ Default admin user successfully created in MongoDB (Username: admin, Password: admin)');
        }
    } catch (e) {
        console.error('Error creating default admin user', e);
    }
}

// Default layout for new users' journal settings
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
 * Authenticates the user and returns their full state and relevant caches.
 */
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Username and password required.' });
    }

    try {
        let user, userData, gurukulData = [], premiumData = null, globalConfig = null, users = [], allUserDatas = null;

        if (dbMode === 'mongodb') {
            user = await User.findOne({ username: username.toLowerCase().trim() });
            if (!user || user.password !== password) {
                return res.status(401).json({ success: false, message: 'Invalid username or password.' });
            }

            // Load user data or create default
            let uData = await UserData.findOne({ username: user.username });
            if (!uData) {
                uData = await UserData.create({ username: user.username, ...getDefaultUserData() });
            }
            userData = uData;

            // Load global Gurukul knowledge entries
            let g = await Gurukul.findOne({});
            if (!g) {
                g = await Gurukul.create({ items: [] });
            }
            gurukulData = g.items;

            // Load Premium features locked screen content
            let p = await Premium.findOne({});
            if (!p) {
                p = await Premium.create({
                    title: '🔒 Premium Feature Locked',
                    msg: 'This powerful feature is available exclusively for Premium members. Upgrade your account to unlock advanced analytics, compounding engine, knowledge repository, and more!',
                    contact: 'Contact your administrator to purchase Premium access.\nEmail: admin@trade1percent.com'
                });
            }
            premiumData = p;

            // Load Global Configuration (News, Broadcast, Custom Fields)
            let gConfig = await GlobalConfig.findOne({ key: 'settings' });
            if (!gConfig) {
                gConfig = await GlobalConfig.create({
                    key: 'settings',
                    broadcast: '',
                    customFields: [],
                    news: []
                });
            }
            globalConfig = gConfig;

            // Fetch list of all users
            users = await User.find({}, '-password'); // exclude password from standard sync list for safety

            // If Admin, load all users' journal databases
            if (user.role === 'admin') {
                const allUDs = await UserData.find({});
                allUserDatas = {};
                allUDs.forEach(u => {
                    allUserDatas[u.username] = u;
                });
            }

        } else {
            // JSON Database Fallback
            const db = readJsonDb();
            const lowerUser = username.toLowerCase().trim();
            user = db.users.find(u => u.username.toLowerCase() === lowerUser);
            if (!user || user.password !== password) {
                return res.status(401).json({ success: false, message: 'Invalid username or password.' });
            }

            if (!db.userDatas[user.username]) {
                db.userDatas[user.username] = getDefaultUserData();
                writeJsonDb(db);
            }
            userData = db.userDatas[user.username];
            gurukulData = db.gurukul || [];
            premiumData = db.premium || {};
            
            if (!db.globalConfig) {
                db.globalConfig = { broadcast: '', customFields: [], news: [] };
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
 * Re-authenticates user and returns active states upon page refresh.
 */
app.post('/api/auth/session', async (req, res) => {
    const { username } = req.body;
    if (!username) {
        return res.status(400).json({ success: false, message: 'Username is required to recover session.' });
    }

    try {
        let user, userData, gurukulData = [], premiumData = null, globalConfig = null, users = [], allUserDatas = null;
        const normalizedUsername = username.toLowerCase().trim();

        if (dbMode === 'mongodb') {
            user = await User.findOne({ username: normalizedUsername });
            if (!user) {
                return res.status(404).json({ success: false, message: 'Session user account not found.' });
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

            // Load Global Configuration
            let gConfig = await GlobalConfig.findOne({ key: 'settings' });
            if (!gConfig) {
                gConfig = await GlobalConfig.create({
                    key: 'settings',
                    broadcast: '',
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

            if (!db.userDatas[user.username]) {
                db.userDatas[user.username] = getDefaultUserData();
                writeJsonDb(db);
            }
            userData = db.userDatas[user.username];
            gurukulData = db.gurukul || [];
            premiumData = db.premium || {};
            
            if (!db.globalConfig) {
                db.globalConfig = { broadcast: '', customFields: [], news: [] };
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
 * 3. Sync Users list (Admin only action)
 * Synchronizes the list of users and automatically prunes any deleted accounts.
 */
app.post('/api/sync/users', async (req, res) => {
    const { users } = req.body;
    if (!users || !Array.isArray(users)) {
        return res.status(400).json({ success: false, message: 'A valid users list is required.' });
    }

    try {
        if (dbMode === 'mongodb') {
            const currentUsers = users.map(u => u.username.toLowerCase().trim());

            // 1. Delete users from database who have been deleted in the UI (except standard admin)
            await User.deleteMany({ username: { $nin: currentUsers, $ne: 'admin' } });
            await UserData.deleteMany({ username: { $nin: currentUsers, $ne: 'admin' } });

            // 2. Perform bulk upsert for all active users
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

            // Sync user data deletions
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
 * Saves all user parameters: trades, customized setups, compounding calculations, settings, etc.
 */
app.post('/api/sync/user-data', async (req, res) => {
    const { username, userData } = req.body;
    if (!username || !userData) {
        return res.status(400).json({ success: false, message: 'Username and journal data are required.' });
    }

    try {
        const targetUsername = username.toLowerCase().trim();
        if (dbMode === 'mongodb') {
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
 * 5. Sync Knowledge Base (Gurukul) (Admin only action)
 * Saves global repository items.
 */
app.post('/api/sync/gurukul', async (req, res) => {
    const { gurukul } = req.body;
    if (!gurukul || !Array.isArray(gurukul)) {
        return res.status(400).json({ success: false, message: 'A valid gurukul content array is required.' });
    }

    try {
        if (dbMode === 'mongodb') {
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
 * 6. Sync Premium locking configurations (Admin only action)
 */
app.post('/api/sync/premium', async (req, res) => {
    const { premium } = req.body;
    if (!premium) {
        return res.status(400).json({ success: false, message: 'Premium options are required.' });
    }

    try {
        if (dbMode === 'mongodb') {
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
 * 7. Sync Global Configuration (Admin only)
 * Updates broadcast message, custom fields list, and news/trends articles.
 */
app.post('/api/sync/global-config', async (req, res) => {
    const { broadcast, broadcastActive, customFields, news } = req.body;
    
    try {
        if (dbMode === 'mongodb') {
            await GlobalConfig.findOneAndUpdate(
                { key: 'settings' },
                {
                    broadcast: broadcast !== undefined ? broadcast : '',
                    broadcastActive: broadcastActive !== undefined ? broadcastActive : false,
                    customFields: customFields || [],
                    news: news || []
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
        console.error('Sync Global Config Endpoint Error:', err);
        res.status(500).json({ success: false, message: 'Failed to sync global configurations.' });
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
