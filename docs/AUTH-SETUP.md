# Firebase sign-in and private backups

Rewards Adviser 1.5 uses Firebase Authentication and Cloud Firestore. Keep the project on the free Spark plan; no billing account or payment integration is required. If a free quota is reached, cloud features can become unavailable; local Rewards collection continues.

1. Create a Firebase project without Analytics or Gemini. Register a web app.
2. Enable Authentication providers Google and Email/Password. Set the Google support email in the console. Do not embed an OAuth client secret, service-account JSON or admin credentials in this repository.
3. Create a default Firestore database in an appropriate European region, with production rules. Deploy `firestore.rules` before any real backup. Unauthenticated access and access to another user's documents must remain denied. Verified email is required for backup operations.
4. Fill the public web configuration in `extension/auth-config.json` and `docs/auth/config.js`. An app API key identifies the Firebase project; Firestore rules enforce user access. The private 48-character relay key is unrelated and must never be committed.
5. Host `docs/auth/` on HTTPS, and set its exact URL as `bridgeUrl`. This page alone loads the Firebase web SDK. Extension pages load only packaged JavaScript. Add the hosting domain to Firebase Authentication authorized domains. Configure the bridge's extension-origin allowlist.
6. The extension needs `offscreen`, network access to the Identity Toolkit, Secure Token and Firestore endpoints, and an allowed frame origin for the hosted bridge. These support the documented Firebase Manifest V3 offscreen authentication pattern.
7. Test Google login interactively. For email registration use a dedicated password; verify the email before backup. Test reset and verification only with the user's own requested account.
8. Test two different Firebase users: each must see only their own backups. Check anonymous access is denied. Check the export contains no sessions or photos from development.

## What is stored

Firebase Authentication processes login email/password or Google identity. Passwords are not stored by this extension. Firebase ID and refresh tokens stay in trusted browser extension storage. They never enter diagnostic dumps, the Rewards relay or shared source packages.

A verified user's private Firestore path is `users/{uid}/devices/{deviceId}`. Its backup contains the current PC's relay key, up to three reader emails/names/browser choices, selected photo, banner, display name and gradient theme. The device identifier derives from the random local relay key, not hardware IDs. Repeated unchanged settings do not cause repeated writes.

Restoring another PC's reader configuration keeps the current PC's independently generated relay key. A user can explicitly download a private backup containing the saved key for recovery. Such files are personal, ignored by Git and must not be redistributed. No Microsoft passwords, Microsoft cookies, Rewards captures or progress counters are included in cloud backups.

This is not end-to-end encryption: Firebase service encryption and strict per-user Firestore permissions protect the backup. Keep the Google/Firebase account secure. Signing out clears the app session and returns to the neutral theme; local Microsoft readers keep working.

## Donations

The user is considering optional GBP 3 PayPal support in the future. Version 1.5 does not create a payment, subscription, paywall or checkout link. A real recipient URL must be supplied before a support button is enabled.

## Official documentation

- https://firebase.google.com/docs/auth/web/chrome-extension
- https://firebase.google.com/docs/reference/rest/auth
- https://firebase.google.com/docs/firestore/security/rules-conditions

## Profile artwork and badges

Banners accept raster JPG, PNG or WebP uploads. The browser crops and recompresses images before saving; remote URLs and SVG are rejected. Photo and banner data together are limited to 230,000 characters, leaving room for account settings within the private Firestore payload limit. Badges are derived from the theme and are decorative; they are not access-control roles.
