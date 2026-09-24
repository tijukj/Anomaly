# 🌐 How to Deploy ANOMALY to the Internet (Free)

This step-by-step guide walks you through putting ANOMALY online so anyone can join with their phone from anywhere (Wi-Fi, 4G, or 5G), and you can display the big screen on a laptop or TV.

**No coding or server administration required! Everything used here is 100% free.**

---

## 📋 Overview of Steps
1. Push this folder to a private **GitHub** repository.
2. Connect your GitHub repository to **Render.com** (Free cloud hosting).
3. Set the `PUBLIC_URL` environment variable.
4. Open the game and play!

---

## 🚀 Step 1: Create a GitHub Account & Repository

1. Go to [github.com](https://github.com) and sign up for a free account if you don't already have one.
2. In the top right corner, click the **`+`** icon and select **New repository**.
3. Fill in:
   - **Repository name**: `anomaly-game`
   - Choose **Private** (or Public).
   - Leave "Add a README file" **unchecked** (we already have our files).
4. Click the green **Create repository** button.

---

## 💻 Step 2: Push Your Game Files to GitHub

The easiest visual way on Windows is using **GitHub Desktop**:

### Using GitHub Desktop:
1. Download and install [GitHub Desktop](https://desktop.github.com/).
2. Log in with your GitHub account.
3. In GitHub Desktop, click **File** $\rightarrow$ **Add Local Repository...**
4. Click **Choose...**, select your project folder (`E:\Projects\Anomaly`), and click **Add Repository**.
5. Click the **Publish repository** button at the top.
6. Make sure the name is `anomaly-game` and click **Publish Repository**.

*(Alternatively, from your PowerShell terminal inside this folder):*
```powershell
git remote add origin https://github.com/<YOUR-USERNAME>/anomaly-game.git
git branch -M main
git push -u origin main
```

---

## ☁️ Step 3: Deploy for Free on Render

1. Go to [render.com](https://render.com) and sign up for a free account (choose **Sign in with GitHub**).
2. On your Render dashboard, click the blue **New +** button in the top right and select **Web Service**.
3. Choose **Build and deploy from a Git repository** $\rightarrow$ click **Next**.
4. Find your `anomaly-game` repository and click **Connect**.
5. Fill in the deployment details:
   - **Name**: `anomaly-game` (or any name you like)
   - **Region**: Select **Singapore (Southeast Asia)** (or the closest region to your players for minimum latency).
   - **Branch**: `master` (or `main`)
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Select **Free** ($0/month).
6. Scroll down and click **Deploy Web Service**.
7. Render will build and deploy your game. Within 1–2 minutes, you will see a green **"Live"** badge!

---

## 🔗 Step 4: Set the `PUBLIC_URL`

1. Look at the top of your Render dashboard page to find your live application URL. It looks like:
   👉 `https://anomaly-game-xxxx.onrender.com`
2. In the left sidebar of your service, click **Environment**.
3. Under **Environment Variables**, click **Add Environment Variable**:
   - **Key**: `PUBLIC_URL`
   - **Value**: `https://anomaly-game-xxxx.onrender.com` *(paste your exact URL without a trailing slash)*
4. Click **Save Changes**. Render will automatically restart your app with the updated URL.

---

## 🧪 Step 5: How to Test

1. **Host Screen (Laptop)**:
   Open Google Chrome on your laptop and go to:
   👉 `https://anomaly-game-xxxx.onrender.com/host`
   - You will see the glowing ANOMALY lobby with the QR code pointing directly to your live cloud URL.
2. **Phone Controller**:
   - Disconnect your phone from Wi-Fi and turn on **Mobile Data (4G/5G)** to test true internet access.
   - Scan the QR code on your laptop screen (or visit `https://anomaly-game-xxxx.onrender.com/play`).
   - Enter your racer name and tap **ENTER MATCH**.
   - Your name will instantly appear on the host screen!

---

## 🎉 Game-Day & Party Tips

- ⏰ **Open the Host 3 Minutes Early**: Free cloud services on Render go to sleep after 15 minutes of inactivity. The first person visiting the site takes ~45 seconds to wake the server up. Open `https://your-url.onrender.com/host` a few minutes before starting your match so it's warm and fast.
- 📺 **Connect Laptop to TV / Projector**:
  - Connect your laptop to a big TV using an **HDMI cable** for zero lag.
  - Or click the Chrome menu ($\vdots$) $\rightarrow$ **Cast...** to mirror the tab onto an Android TV or Chromecast.
- 🖥️ **Full Screen View**:
  - On Windows, press **`F11`** inside Google Chrome to hide the address bar and enter full-screen arcade mode.
- 🎮 **Start Match**:
  - When everyone is ready, press **SPACEBAR** on your laptop keyboard or click **START MATCH**!

---

## ❓ Troubleshooting (5 Most Common Issues)

### 1. The page says "Waking up..." or takes 45 seconds to load the first time.
- **Cause**: Free cloud instances sleep when inactive.
- **Fix**: Simply wait ~45 seconds for the server to wake up. Once awake, it remains responsive for the entire game session.

### 2. The QR code points to `localhost` instead of the public link.
- **Cause**: The `PUBLIC_URL` environment variable is missing on Render.
- **Fix**: Go to your Render Dashboard $\rightarrow$ **Environment** $\rightarrow$ Add `PUBLIC_URL` = `https://your-app-name.onrender.com` and click **Save Changes**.

### 3. A phone player gets disconnected during the match.
- **Cause**: Phone locked or switched apps.
- **Fix**: When the player re-opens the browser, ANOMALY automatically restores their racer handle, color, and spot.

### 4. Player actions feel slightly delayed.
- **Cause**: Selected a server region far from your location.
- **Fix**: On Render, make sure your Web Service region is set to the closest geographical region (e.g. **Singapore** for Asia / Oceania, or **Frankfurt / Oregon / Ohio**).

### 5. Render build error: "Cannot find package".
- **Cause**: A dependency was missing from `package.json`.
- **Fix**: All dependencies are locked in `package.json` and `render.yaml`. Check that `npm install` and `npm start` are set as the build and start commands.
