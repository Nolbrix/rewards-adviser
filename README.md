# Rewards Adviser

A local Microsoft Rewards dashboard for **up to three accounts** on Microsoft Edge, Chrome and Brave. The extension shows detected balances, daily activities, bonuses and search progress, with optional reminders every ten minutes.

**made by nolbrix** · Version 1.6.3 adds animated GIF profile photos and banners, plus an animated avatar aura that follows your theme. Google/email sign-in, private backups and the three Rewards readers remain available.

**Windows 10/11 and Python 3.11+ are required.** No Node.js installation is needed to use the extension. This is an independent project, unaffiliated with Microsoft.

## Install

1. Download this repository using **Code → Download ZIP**, then extract it into a permanent folder.
2. Run **START.cmd**. A local service starts in the background and prepares the connection automatically.
3. Open `edge://extensions`, `chrome://extensions` or `brave://extensions` in each browser profile you want to connect. Enable developer mode, choose **Load unpacked**, and select the extracted folder containing `manifest.json`.
4. Open Rewards Adviser → **Settings**. Choose **Reader 1**, **Reader 2** or **Reader 3**, select your browser and enter your Microsoft email. The email may also be left blank to detect it from a signed-in Rewards page. Set an optional account name and choose **Save and connect**.
5. Open Rewards and Bing in that same browser profile and sign in yourself to the corresponding Microsoft account. The extension does not log in using an email address and never asks for your password.
6. Repeat for additional accounts, using a separate signed-in browser profile for each. You may use one, two or three accounts.
7. Optionally install another copy as **Dashboard and reminders**. Enable the reminder coordinator in **one browser profile only**.

Keep the source browsers running and signed in to Rewards/Bing. With automatic updates enabled, the extension requests fresh counters about every two minutes, even when Rewards tabs are in the background or frozen. It does not rely on page timers or change tab focus. If needed it reuses a Rewards tab or opens one inactive recovery tab; failed identity checks keep the previous reading marked as stale. The dashboard can collect readings from all three profiles on the same PC. Run **STOP.cmd** to stop the local service; run **START.cmd** again after restarting Windows.

## Language

The interface follows the browser's UI language, which normally follows the operating system. **Italian and English** are included; other languages fall back to English. Dates and number formatting follow that choice. User account names, emails and activity titles from Microsoft are preserved.

This version uses the **Europe/Rome Rewards day**. Changing the interface language does not change the day boundary.

## Local key and privacy

At first launch, a cryptographically random key is generated for the current Windows user on this PC. It is saved in `%LOCALAPPDATA%\RewardsAdviser\connection.json` and reused after restarts and across project folders. A different PC generates a different key. No hardware fingerprint is used. Existing local installations retain their key during migration.

The extension receives the key through the generated local connection file. Account emails, progress and private phone calibration stay in `.state`. The relay listens only on `127.0.0.1:18743`. Microsoft sessions remain in their own browsers; the extension does not export Microsoft cookies or tokens.

**Share the original repository ZIP or the generated public ZIP, never a folder you have already run.** An active installation contains your private local files. Generated connection files, state, phone images and working files are excluded from the source export and ignored by Git.

## Your Rewards Adviser account

Sign in with Google or register using email/password. Verify your email to enable private backups. Your profile can use a chosen photo, a custom banner or a gradient preset, and a blue, red, black, green or purple theme. The corresponding decorative badges are ASTRAL, MYTHIC, ECLIPSE, EMERALD and ARCANE; they do not grant permissions. Signing out returns to the neutral theme and keeps the local Rewards readers working.

Upload JPG/PNG/WebP images or lightweight animated GIFs from your profile editor. GIFs keep all their frames in local saves and private backups; they are never flattened. Static photos can be up to 2 MB and static banners up to 6 MB before compression. GIFs can be about 130 KB for photos or 115 KB for banners; both images share the available profile space, so a large existing image may lower the other limit. The upload message shows the available size when needed. The theme aura appears around your avatar in the profile strip, editor and account button; it stops moving when the system requests reduced motion.

Firebase processes authentication and stores a private backup of the local connection key, up to three reader emails/names/browser choices, your photo, banner and theme. Microsoft passwords, cookies, captured pages and progress counters stay out of this backup. Backups are protected by verified-user Firestore rules and Firebase service encryption; this is not end-to-end encryption. The project administrator operates this Firebase service.

Use **Restore settings** to recover appearance and choose a reader for the current browser profile. A different PC retains its own newly generated connection key. An explicit **Download private backup** includes the saved key: keep that personal file private. Detailed setup and data handling: [Firebase setup](docs/AUTH-SETUP.md). No PayPal payment or subscription is enabled.

## Point totals

Points already earned but still waiting to be claimed appear in **Points to claim**. They are excluded from **Left to do today**, which sums only measured incomplete earning activities. Older captures cannot replace newer readings. A newer identity-checked Bing balance can update the dashboard balance. Missing PC/phone counters remain unknown.

## Phone points

PC/phone searches are used only when Bing exposes authenticated, identity-checked counters. Missing data remains unknown; it never means zero or complete.

Article reading and check-in can be confirmed manually from the Bing app. The Galaxy automatic-reader section has been removed from the interface. Historical screen-reader code remains in the source for compatibility, but it is experimental, off by default and no longer offered by the panel. No automatic phone collection is enabled by this release.

## Development

The runtime uses Python's standard library and Chromium Manifest V3. Windows OCR is used only by the optional phone reader.

```text
npm install
python tools/build_locales.py
npm test
python -m unittest discover -s tests -p "test_*.py"
npm run test:integration
```

Browser tests use disposable profiles and synthetic data. Set `REWARDS_TEST_BROWSER` to an Edge/Chromium executable if necessary. `REWARDS_TEST_PACKAGES` can point to a directory containing Playwright. Test screenshots go to `work/test-artifacts`.

Edit `extension/translations.json`, then run `tools/build_locales.py` to regenerate both manifest catalogs and the preview fallback. To export curated source into an empty destination:

```text
python tools/export_public.py path-to-empty-output-folder
```

See [README.html](README.html) for the Italian installation guide.

## Italiano

Avvia **START.cmd**, carica la cartella principale come estensione non pacchettizzata e apri **Impostazioni**. Scegli un lettore da 1 a 3, il browser e la tua email Microsoft, poi premi **Salva e collega**. Ogni account deve essere già connesso a Rewards e Bing nel proprio profilo del browser. Puoi usare anche un solo account.

La lingua segue automaticamente quella del browser: italiano o inglese, con inglese come alternativa per le altre lingue. La chiave viene generata sul tuo PC e non contiene dati hardware. Il progetto pubblico non contiene account, chiavi, letture o calibrazioni personali. Le letture degli articoli si confermano a mano dall’app Bing; la sezione Galaxy è stata rimossa.
