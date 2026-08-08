# 🐘 Supabase (Cloud PostgreSQL) - Ultimate Management Guide

Welcome to your **100% Free Forever Cloud SQL Database**! 

Supabase is a high-performance, modern, open-source alternative to Google Firebase, powered by a native **PostgreSQL Relational Database**. 

Because your **Trade 1% Trading Journal** is integrated with Supabase, your database connects instantly to Vercel and your Android app, has **zero firewall/IP whitelisting restrictions**, is 100% stable, and will never charge you any monthly fees.

---

## 📂 1. How to View and Edit Your Database Tables (Visual Grid)

Supabase has a built-in **Table Editor** that acts like a beautiful, secure, cloud-hosted Excel sheet. You can visually inspect, search, edit, or delete any trade logs, user accounts, and setups directly in your browser:

1. Log into your [Supabase Dashboard](https://supabase.com/).
2. Click on your **`trade-journal`** project.
3. Click on the **Table Editor** icon in the far-left vertical toolbar (it looks like a grid of tables ▦).
4. Under the list, you will see your 3 core trading journal tables:
   * 👥 **`users`**: Contains all of your registered trader accounts, passwords, and custom premium access flags.
   * 📖 **`user_datas`**: Stores the complete trade logs, custom setups, and compounding stages of each user inside secure, optimized `JSONB` document rows.
   * 📢 **`global_config`**: Stores your broadcast announcement message (and its start/stop status), master setups lists, and published "News & Trends" articles.
5. **How to edit values directly:** Double-click on any cell inside the grid, type the new value (like manually changing a user's password or toggling their status to `deactivated`), and click Save!

---

## 💾 2. How to Back Up Your Database

Supabase takes care of your database's safety automatically!

### A. Automatic Daily Backups (No Setup Needed!)
* Supabase automatically takes a **complete snapshot backup of your database every single day** and stores it securely on their servers for free.
* If you ever make a mistake or want to revert to yesterday's data, simply open your project dashboard, go to **Database -> Backups**, and click **Restore** on the backup you want.

### B. Manual Instant Backup (1-Click SQL Download)
If you want to download a physical backup copy of your database to your local computer:
1. Go to your Supabase project dashboard.
2. In the far-left toolbar, click on the **Database** icon (three stacked cylinders 🛢️).
3. Click on **Backups** inside the sub-menu.
4. Click the green **Download Backup** button. This will download a `.sql` file containing your entire database structure and logs.

---

## 🔑 3. How to Rotate/Change Your Database Password
If you ever want to change your database master password for security:

1. In your Supabase dashboard, click on the **Project Settings** (gear icon ⚙️) in the bottom-left corner of the sidebar.
2. Click on **Database** under settings.
3. Scroll down to the **Database Password** section.
4. Click **Reset database password**, type in your new secure password, and click Save.
5. **Crucial:** Remember to update your connection string inside your website settings (under Settings -> Cloud Database) with your new password so your app stays connected!

---

## 🧹 4. How to Reset Your Database (Wipeout/Fresh Start)
If you ever want to completely delete all trade logs and users to start 100% fresh, you can execute a clean SQL reset:

1. Go to your Supabase dashboard.
2. Click on the **SQL Editor** icon in the left toolbar (looks like a command terminal icon `>_`).
3. Click **New query** in the top left.
4. Paste the following SQL script inside the editor:
   ```sql
   -- WIPE ALL JOURNAL DATA & RESET TO FRESH DEFAULT
   DROP TABLE IF EXISTS user_datas;
   DROP TABLE IF EXISTS global_config;
   DROP TABLE IF EXISTS users;
   ```
5. Click the green **Run** button.
6. Open your live website `https://tradeonepercent.vercel.app/`—the backend will instantly notice the tables are gone, recreate fresh empty tables, and auto-generate your clean default `admin` profile in 1 millisecond!

---

## 📈 5. Monitoring Your Database Usage
Your free Supabase tier provides a massive **500 MB of database storage** completely free. 
* Because trade logs are simple text documents, **500 MB can easily store over 5,000,000 trade entries permanently!**
* To check how much storage you have used, go to **Project Settings ⚙️ -> Usage** in your Supabase dashboard. You will see a beautiful graph showing your exact storage consumption in real-time.
