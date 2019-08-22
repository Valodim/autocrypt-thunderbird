/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

"use strict";

const AutocryptLog = ChromeUtils.import("chrome://autocrypt/content/modules/log.jsm").AutocryptLog;
const AutocryptCryptoAPI = ChromeUtils.import("chrome://autocrypt/content/modules/cryptoAPI.jsm").AutocryptCryptoAPI;
const AutocryptMasterpass = ChromeUtils.import("chrome://autocrypt/content/modules/masterpass.jsm").AutocryptMasterpass;

var EXPORTED_SYMBOLS = ["AutocryptSessionKeyCache"];

const HEADER_KEY = "autocrypt-sessionkey-v1";
const SALT = "session-key-cache";

var AutocryptSessionKeyCache = {
  disabled: false,

  setDisabled(disabled) {
    this.disabled = disabled;
  },

  getCachedSessionKey: function(uri) {
    AutocryptLog.DEBUG(`sessionKeyCache.jsm: getCachedSessionKey(): ${uri}\n`);

    if (this.disabled) {
      AutocryptLog.DEBUG(`sessionKeyCache.jsm: getCachedSessionKey(): cache is disabled\n`);
      return null;
    }

    AutocryptLog.DEBUG(`sessionKeyCache.jsm: getCachedSessionKey(): ${uri}\n`);
    if (!uri || !uri.spec || uri.spec.search(/[&?]header=enigmailConvert/) >= 0) {
      return null;
    }

    let msgDbHdr = uri.QueryInterface(Ci.nsIMsgMessageUrl).messageHeader;
    if (!msgDbHdr) {
      AutocryptLog.DEBUG(`sessionKeyCache.jsm: getCachedSessionKey(): error retrieving header for uri\n`);
      return null;
    }

    let session_key_encrypted = msgDbHdr.getStringProperty(HEADER_KEY);
    if (!session_key_encrypted) {
      AutocryptLog.DEBUG(`sessionKeyCache.jsm: getCachedSessionKey(): session key not cached\n`);
      return null;
    }

    let session_key_string = this.decryptString(session_key_encrypted);
    let session_key = this.deserializeSessionKey(session_key_string);
    if (!session_key) {
      return null;
    }

    AutocryptLog.DEBUG(`sessionKeyCache.jsm: getCachedSessionKey(): ok`);
    return session_key;
  },

  putCachedSessionKey: function(uri, session_key) {
    AutocryptLog.DEBUG(`sessionKeyCache.jsm: putCachedSessionKey(): ${uri}\n`);
    if (!uri || !uri.spec || uri.spec.search(/[&?]header=enigmailConvert/) >= 0) {
      return;
    }

    if (!session_key || !session_key.algorithm || !session_key.data) {
      AutocryptLog.ERROR(`sessionKeyCache.jsm: putCachedSessionKey(): malformed session key!\n`);
      return;
    }

    let msgDbHdr = uri.QueryInterface(Ci.nsIMsgMessageUrl).messageHeader;
    if (!msgDbHdr) {
      AutocryptLog.DEBUG(`sessionKeyCache.jsm: getCachedSessionKey(): error retrieving header for uri\n`);
      return;
    }

    let session_key_string = this.serializeSessionKey(session_key);
    let session_key_encrypted = this.encryptString(session_key_string);
    AutocryptLog.DEBUG(`sessionKeyCache.jsm: putCachedSessionKey()\n`);

    msgDbHdr.setStringProperty(HEADER_KEY, session_key_encrypted);

    AutocryptLog.DEBUG(`sessionKeyCache.jsm: putCachedSessionKey(): ok\n`);
  },

  encryptString: function(plaintext) {
    const password = AutocryptMasterpass.retrieveAutocryptPassword();
    const cApi = AutocryptCryptoAPI();
    const ciphertext = cApi.wrap(password + SALT, plaintext);
    return ciphertext;
  },

  decryptString: function(ciphertext) {
    const password = AutocryptMasterpass.retrieveAutocryptPassword();
    const cApi = AutocryptCryptoAPI();
    const plaintext = cApi.unwrap(password + SALT, ciphertext);
    return plaintext;
  },

  serializeSessionKey: function(session_key) {
    return JSON.stringify({
      data: btoa(String.fromCharCode.apply(null, session_key.data)),
      algorithm: session_key.algorithm
    });
  },

  deserializeSessionKey: function(session_key_string) {
    let session_key = JSON.parse(session_key_string);
    let data = atob(session_key.data);
    session_key.data = Uint8Array.from(data, c => c.charCodeAt(0));
    return session_key;
  }
};
