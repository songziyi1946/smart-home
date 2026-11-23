# MiCloud protocol references

`backend/providers/mijia/cloud.mjs` implements a server-only personal MiCloud adapter in Node.js. It does not include Xiaomi's `ha_xiaomi_home` implementation, or GPL code from `Do1e/mijia-api`.

The password, CAPTCHA and SMS/email verification flow was adapted from the publicly documented implementation in **Xiaomi Miot for Home Assistant**, by al-one and contributors:

- Source: <https://github.com/al-one/hass-xiaomi-miot/blob/master/custom_components/xiaomi_miot/core/xiaomi_cloud.py>
- License: **Apache License 2.0**, copied to [licenses/al-one-hass-xiaomi-miot-APACHE-2.0.txt](licenses/al-one-hass-xiaomi-miot-APACHE-2.0.txt).
- Changes: rewritten for Node.js native fetch/crypto; fixed upstream origins and redirect checks; server-only transient challenges; no persisted password/hash, raw upstream logging or Home Assistant dependency.

The `xiaomiio` cloud request framing and RC4-drop1024 protocol were informed by **homebridge-miot**, copyright (c) 2025 Marcin, licensed under MIT:

- Source: <https://github.com/merdok/homebridge-miot/blob/main/lib/protocol/MiCloud.js>
- License: [licenses/homebridge-miot-MIT.txt](licenses/homebridge-miot-MIT.txt).
- Changes: native ESM implementation; bounded requests and response sizes; encrypted credential handling belongs to the application; no Homebridge SDK, logger or raw cloud object is exposed to clients.

These are third-party protocol implementations, not an official universal Xiaomi developer API. Device capability/state support depends on the account region, device MIoT specification and cloud responses. This adapter uses server-side reads and command readback, not Xiaomi push subscriptions. Future distribution or commercial use must separately verify current Xiaomi service authorization and applicable terms.

Protocol ciphertext is required only for communication with Xiaomi. Local secrets use the application's authenticated encrypted storage, not RC4.
