# Rewards Adviser

A local Microsoft Rewards dashboard for **up to three accounts** on Microsoft Edge, Chrome and Brave. The extension shows detected balances, daily activities, bonuses and search progress, with optional reminders every ten minutes.

**Windows 10/11 and Python 3.11+ are required.** No Node.js installation is needed to use the extension. This is an independent project, unaffiliated with Microsoft.

## Install

1. Download this repository using **Code → Download ZIP**, then extract it into a permanent folder.
2. Run **AVVIA.cmd**. A local service starts in the background and prepares the connection automatically.
3. Open `edge://extensions`, `chrome://extensions` or `brave://extensions` in each browser profile you want to connect. Enable developer mode, choose **Load unpacked**, and select the extracted folder containing `manifest.json`.
4. Open Rewards Adviser → **Settings**. Choose **Reader 1**, **Reader 2** or **Reader 3**, select your browser and enter your Microsoft email. The email may also be left blank to detect it from a signed-in Rewards page. Set an optional account name and choose **Save and connect**.
5. Open Rewards and Bing in that same browser profile and sign in yourself to the corresponding Microsoft account. The extension does not log in using an email address and never asks for your password.
6. Repeat for additional accounts, using a separate signed-in browser profile for each. You may use one, two or three accounts.
7. Optionally install another copy as **Dashboard and reminders**. Enable the reminder coordinator in **one browser profile only**.

Keep the source browsers and a Rewards tab open. The dashboard can collect the readings from all three profiles on the same PC. Run **FERMA.cmd** to stop the local service; run **AVVIA.cmd** again after restarting Windows.

## Language

The interface follows the browser's UI language, which normally follows the operating system. **Italian and English** are included; other languages fall back to English. Dates and number formatting follow that choice. User account names, emails and activity titles from Microsoft are preserved.

This version uses the **Europe/Rome Rewards day**. Changing the interface language does not change the day boundary.

## Local key and privacy

At first launch, a cryptographically random key is generated for the current Windows user on this PC. It is saved in `%LOCALAPPDATA%\RewardsAdviser\connection.json` and reused after restarts and across project folders. A different PC generates a different key. No hardware fingerprint is used. Existing local installations retain their key during migration.

The extension receives the key through the generated local connection file. Account emails, progress and private phone calibration stay in `.state`. The relay listens only on `127.0.0.1:18743`. Microsoft sessions remain in their own browsers; the extension does not export Microsoft cookies or tokens.

**Share the original repository ZIP or the generated public ZIP, never a folder you have already run.** An active installation contains your private local files. Generated connection files, state, phone images and working files are excluded from the source export and ignored by Git.

## Phone points

PC/phone searches are used only when Bing exposes authenticated, identity-checked counters. Missing data remains unknown; it never means zero or complete.

Article reading and check-in can be confirmed manually from the Bing app. The optional **Galaxy / Phone Link screen reader is experimental and off by default**. It needs a private calibration for the device, font and three account identities; that calibration is not distributed, and there is currently no automatic calibration wizard. Full unattended reading across all three real accounts has not yet passed acceptance. Do not enable it expecting immediate automatic setup.

When calibrated, the reader attempts a cycle every 120 seconds after 15 seconds of PC inactivity. The phone must stay connected, awake and unlocked, with Bing on a recognized profile screen. A cycle may temporarily bring Phone Link forward and switch saved Bing accounts; desktop input interrupts it. It reads counters only and does not perform searches, read articles, claim rewards or redeem points.

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

Avvia **AVVIA.cmd**, carica la cartella principale come estensione non pacchettizzata e apri **Impostazioni**. Scegli un lettore da 1 a 3, il browser e la tua email Microsoft, poi premi **Salva e collega**. Ogni account deve essere già connesso a Rewards e Bing nel proprio profilo del browser. Puoi usare anche un solo account.

La lingua segue automaticamente quella del browser: italiano o inglese, con inglese come alternativa per le altre lingue. La chiave viene generata sul tuo PC e non contiene dati hardware. Il progetto pubblico non contiene account, chiavi, letture o calibrazioni personali. Le letture degli articoli restano manuali finché non viene preparata e verificata la calibrazione privata del lettore sperimentale.
