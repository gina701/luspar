# Luspa Barbershop Management System

A mobile-friendly installable PWA built with HTML, CSS, vanilla JavaScript, Node.js and Express. It includes owner-only sign-in, JSON-file or MongoDB data storage, double-entry journals, services and sales, expenses, account balances, financial reports, English/Chichewa interface, light/dark mode, export/restore and automatic rolling backups.

## Important accounting scope

- Posted journals require at least two lines and total debits must equal total credits.
- Posted entries are not deleted. Use **Reverse** to create a reversing journal and preserve history.
- Reports are based on posted journals. This is a starter accounting application, not a substitute for professional accounting/tax advice.
- The cash-flow screen is currently a cash-account summary, not a full operating/investing/financing cash flow statement.
- Configure opening balances carefully before relying on financial statements. Confirm tax, depreciation and reporting treatment with a qualified accountant.

## Requirements

- Node.js 20.6 or later
- Windows PowerShell or Command Prompt
- A browser such as Chrome or Edge

## Windows local setup

1. Extract the ZIP to a new folder, for example `C:\LuspaBarbershop`. Do not extract over an existing project folder.
2. Install Node.js 20.6+ from https://nodejs.org if not already installed.
3. Open Command Prompt in the extracted folder.
4. Install dependencies:

   ```bat
   npm install
   ```

5. Copy `.env.example` to `.env`.
6. Generate a strong password hash. In the project folder run:

   ```bat
   node -e "require('bcryptjs').hash('ChangeThisToYourOwnStrongPassword',12).then(console.log)"
   ```

   Copy the printed hash into `.env` as `ADMIN_PASSWORD_HASH=...`. Replace the example password with your own before running the command. Set a long random `SESSION_SECRET` too.
7. Start the app:

   ```bat
   npm start
   ```

8. Open http://localhost:3000 and sign in using the username in `.env` (default `owner`) and the password you hashed.

After signing in, use **Settings → Change owner password** to set a new password. The form asks for the current password and requires the new one to be at least 12 characters. Updated credentials are stored in MongoDB when configured, or in the ignored `data/owner-auth.json` file for local JSON storage, and take effect after restarts. Changing the password invalidates existing sessions.

### Quick Windows setup script

`setup.bat` installs packages and creates `.env` from `.env.example` if needed. It does not overwrite an existing `.env`. You must still edit `.env`, set a password hash and a strong session secret before using the system.

## Data persistence and backups

- Main data file without MongoDB: `data/luspa-data.json`
- Rolling backups: `backups/`
- Automatic backup is created on startup and approximately every 24 hours; the latest 30 automatic backup files are retained.
- When MongoDB is configured, it is the primary data store and local rolling backups still contain snapshots of the records.
- Use Settings → Export all records to download an off-site JSON backup.
- Restore is destructive to the active dataset; the server first attempts a backup, then replaces active records with the selected backup. Only restore a trusted file.
- Do **not** commit `.env`, `data/*.json`, or backups to a public GitHub repository.

### MongoDB Atlas storage

The app uses MongoDB for business records and login sessions when `MONGODB_URI` is set. On the first MongoDB startup, existing records in `data/luspa-data.json` are copied into MongoDB if the app's `luspa_data` collection does not already contain data. MongoDB becomes the primary store after that; the app also creates local rolling JSON backups.

In MongoDB Atlas:

1. Open the cluster and select **Connect → Drivers**. The hostname for this cluster is `cluster0.mfr5lfx.mongodb.net`.
2. Under **Database Access**, create or select the database user. Under **Network Access**, allow the IP address of the computer/server running this app.
3. Copy `.env.example` to `.env`, then set `MONGODB_URI` using this form (replace the placeholder with your newly rotated, URL-encoded password):

   ```text
   mongodb+srv://sichalikelvin52_db_user:<URL_ENCODED_NEW_PASSWORD>@cluster0.mfr5lfx.mongodb.net/ruspa?retryWrites=true&w=majority
   ```

4. Keep `.env` private and restart the app with `npm start`. Do not send or commit the URI; it contains the database password.

The password shared in chat should be changed in Atlas before using the connection. If a password contains URI-reserved characters, URL-encode it before inserting it into the URI.

### Hosting on Render

The repository includes a `render.yaml` Blueprint for a Node web service. MongoDB Atlas is the primary store for business records and sessions in this setup, so a Render disk is not required. Render's local rolling JSON backups are ephemeral; use **Settings → Export all records** to keep an off-site backup.

1. Change the temporary owner password in **Settings → Change owner password** to a unique password of at least 12 characters before making the app public.
2. Create a **private** GitHub repository and push this project to it. Do not add `.env`, database exports, or backup files; they are excluded by `.gitignore`.
3. In Render, choose **New → Blueprint**, connect the private repository, and apply the `render.yaml` Blueprint. Keep the service in one region.
4. When prompted for `MONGODB_URI`, enter the Atlas URI privately in Render. For `ADMIN_PASSWORD_HASH`, copy the bcrypt hash from your local `.env` privately; this is only a fallback for initial authentication setup because the existing owner credential is stored in the `luspa_auth` MongoDB collection.
5. After Render creates the service, open its **Connect → Outbound** details and copy its outbound IP ranges. Add those ranges in Atlas under **Network Access**. Avoid allowing all IPs (`0.0.0.0/0`) when possible.
6. Wait for the deployment to become live, then open the `onrender.com` URL. Check `/api/health` returns `"storage":"mongodb"` and sign in with username `owner` and the new owner password.

Render provides HTTPS automatically. `SESSION_SECRET` is generated by the Blueprint; `PORT` is supplied by Render. Do not put secrets in `render.yaml` or commit `.env`.

## PWA notes

The service worker caches the static interface for app-shell loading. Business records and all API calls require a live connection to the server. This is **not** a fully offline accounting app.

## Included modules

- Dashboard, sales and services
- Add haircut styles as separate services with individual prices from Services & prices or the dashboard shortcut.
- Expense entry and advanced manual journal entries
- Standard chart of accounts
- Income statement / profit and loss
- Balance sheet summary and trial balance
- Cash and mobile-money balances
- English and Chichewa UI selection
- Dark, light and system appearance
- Export, restore, automatic backups and reversal trail
