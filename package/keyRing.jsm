/*global Components: false*/
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

"use strict";

/**
 *  Module for dealing with received Autocrypt headers, level 0
 *  See details at https://github.com/mailencrypt/autocrypt
 */

var EXPORTED_SYMBOLS = ["AutocryptKeyRing"];

const Cr = Components.results;

const sqlite = ChromeUtils.import("chrome://autocrypt/content/modules/sqliteDb.jsm").AutocryptSqliteDb;
const AutocryptMasterpass = ChromeUtils.import("chrome://autocrypt/content/modules/masterpass.jsm").AutocryptMasterpass;
const AutocryptCryptoAPI = ChromeUtils.import("chrome://autocrypt/content/modules/cryptoAPI.jsm").AutocryptCryptoAPI;
const AutocryptLog = ChromeUtils.import("chrome://autocrypt/content/modules/log.jsm").AutocryptLog;

var gCachedPublicKeysByFpr = false;
var gCachedPublicKeyList = false;

var gCachedSecretKeyMap = false;
var gCachedSecretKeyList = false;

var AutocryptKeyRing = {
  getAllPublicKeys: async function() {
    await this.ensurePublicKeyCache();
    return gCachedPublicKeyList;
  },

  getAllPublicKeysMap: async function() {
    await this.ensurePublicKeyCache();
    return gCachedPublicKeysByFpr;
  },

  clearPublicKeyCache: function() {
    gCachedPublicKeysByFpr = false;
    gCachedPublicKeyList = false;
  },

  ensurePublicKeyCache: async function () {
    if (gCachedPublicKeysByFpr && gCachedPublicKeyList) {
      return;
    }

    AutocryptLog.DEBUG("ensurePublicKeyCache(): loading keys...\n");
    const cApi = AutocryptCryptoAPI();

    let startTime = new Date();
    let public_key_rows = await sqlite.retrieveAllPublicKeys();
    const public_key_map = {};
    const public_key_list = [];
    await Promise.all(public_key_rows.map(async row => {
      let openpgp_public_key = await cApi.parseOpenPgpKey(row.key_data, false);
      public_key_map[row.fpr_primary] = openpgp_public_key;
      public_key_list.push(openpgp_public_key);
    }));

    gCachedPublicKeysByFpr = public_key_map;
    gCachedPublicKeyList = public_key_list;

    let time_diff_ms = new Date() - startTime;
    AutocryptLog.DEBUG(`ensurePublicKeyCache(): loaded ${public_key_list.length} keys in ${time_diff_ms}ms\n`);
  },

  getAllSecretKeys: async function() {
    await this.ensureSecretKeyCache();
    return gCachedSecretKeyList;
  },

  getAllSecretKeysMap: async function() {
    await this.ensureSecretKeyCache();
    return gCachedSecretKeyMap;
  },

  getSecretKeyByFingerprint: async function(fpr_primary) {
    let key_map = await this.getAllSecretKeysMap();
    if (fpr_primary in key_map) {
      return key_map[fpr_primary];
    } else {
      return null;
    }
  },

  getPublicKeyByKeyId: async function(key_id) {
    let fpr_primary = await sqlite.findPrimaryFprByKeyId(key_id);
    if (!fpr_primary) {
      return null;
    }
    let public_key_map = await this.getAllPublicKeysMap();
    return public_key_map[fpr_primary];
  },

  getPublicKeyByEmail: async function(email) {
    AutocryptLog.DEBUG(`keyRing.jsm: getPublicKeyByEmail(): ${email}\n`);
    let public_key_map = await this.getAllPublicKeysMap();
    let autocrypt_row = await sqlite.retrieveAutocryptRows([email]);
    if (autocrypt_row && autocrypt_row.length && autocrypt_row[0].fpr_primary) {
      let public_key = public_key_map[autocrypt_row[0].fpr_primary];
      if (public_key) {
        AutocryptLog.DEBUG(`keyRing.jsm: getPublicKeyByEmail(): ok\n`);
        return public_key;
      }
      AutocryptLog.DEBUG(`keyRing.jsm: getPublicKeyByEmail(): no key?\n`);
      return null;
    }
    AutocryptLog.DEBUG(`keyRing.jsm: getPublicKeyByEmail(): no data\n`);
    return null;
  },

  getPublicKeyBase64ForEmail: async function(email) {
    AutocryptLog.DEBUG(`keyRing.jsm: getPublicKeyBase64ForEmail(): ${email}\n`);
    let public_key = await this.getPublicKeyByEmail(email);
    if (public_key) {
        AutocryptLog.DEBUG(`keyRing.jsm: getPublicKeyBase64ForEmail(): ok\n`);
        let public_key_data = public_key.toPacketlist().write();
        return btoa(String.fromCharCode.apply(null, public_key_data));
    }
    AutocryptLog.DEBUG(`keyRing.jsm: getPublicKeyBase64ForEmail(): no key?\n`);
    return null;
  },

  clearSecretKeyCache: function() {
    gCachedSecretKeyMap = false;
    gCachedSecretKeyList = false;
  },

  ensureSecretKeyCache: async function () {
    if (gCachedSecretKeyMap && gCachedSecretKeyList) {
      return;
    }

    AutocryptLog.DEBUG("ensureSecretKeyCache(): loading keys...\n");
    const cApi = AutocryptCryptoAPI();

    let master_password = AutocryptMasterpass.retrieveAutocryptPassword();

    let startTime = new Date();
    let secret_key_rows = await sqlite.retrieveAllSecretKeys();
    const secret_key_map = {};
    const secret_key_list = [];
    await Promise.all(secret_key_rows.map(async row => {
      let openpgp_secret_key = await cApi.parseOpenPgpKey(row.key_data_secret, false);
      if (!openpgp_secret_key.isPrivate()) {
        AutocryptLog.ERROR(`ensureSecretKeyCache(): expected secret key, found public!\n`);
        return;
      }
      if (!openpgp_secret_key.isDecrypted()) {
        await openpgp_secret_key.decrypt(master_password);
        AutocryptLog.DEBUG(`ensureSecretKeyCache(): decrypt ok for ${row.fpr_primary}\n`);
      }
      secret_key_map[row.fpr_primary] = openpgp_secret_key;
      secret_key_list.push(openpgp_secret_key);
    }));

    gCachedSecretKeyMap  = secret_key_map;
    gCachedSecretKeyList = secret_key_list;

    let time_diff_ms = new Date() - startTime;
    AutocryptLog.DEBUG(`ensureSecretKeyCache(): loaded ${secret_key_list.length} keys in ${time_diff_ms}ms\n`);
  },

  insertOrUpdate: async function(key_data) {
    const cApi = AutocryptCryptoAPI();

    let parsed_key = await cApi.parseOpenPgpKeyInfo(key_data);

    // TODO update, not just replace
    if (parsed_key) {
      await sqlite.replacePublicKey(parsed_key.fpr_primary, parsed_key.key_data, parsed_key.key_fprs, parsed_key.key_ids);
    }

    // TODO update in-place
    this.clearPublicKeyCache();

    return {
      fpr_primary: parsed_key.fpr_primary,
      addresses: parsed_key.addresses
    };
  },

  insertSecretKey: async function(openpgp_secret_key) {
    AutocryptLog.DEBUG(`keyRing.jsm: insertSecretKey()\n`);
    if (!openpgp_secret_key.isPrivate()) {
      AutocryptLog.ERROR(`keyRing.jsm: insertSecretKey(): key is not secret!\n`);
      return;
    }

    let master_password = AutocryptMasterpass.retrieveAutocryptPassword();
    await openpgp_secret_key.encrypt(master_password);

    let fpr_primary = openpgp_secret_key.getFingerprint().toUpperCase();
    let key_data_secret = openpgp_secret_key.toPacketlist().write();
    let key_data_public = openpgp_secret_key.toPublic().toPacketlist().write();

    await sqlite.storeSecretKeyData(fpr_primary, key_data_secret);
    await this.insertOrUpdate(key_data_public);

    this.clearSecretKeyCache();
  },

  forgetSecretKey: async function(fpr_primary) {
    await sqlite.removeSecretKeyData(fpr_primary);
    if (gCachedSecretKeyMap && fpr_primary in gCachedSecretKeyMap) {
      this.clearSecretKeyCache();
      await this.ensureSecretKeyCache();
    }
  },

  reencryptSecretKeys: async function() {
    AutocryptLog.DEBUG(`reencryptSecretKeys()\n`);
    let openpgp_secret_keys = await this.getAllSecretKeys();
    let startTime = new Date();
    for (let openpgp_secret_key of openpgp_secret_keys) {
      await this.insertSecretKey(openpgp_secret_key);
    }
    let time_diff_ms = new Date() - startTime;
    AutocryptLog.DEBUG(`reencryptSecretKeys(): reencrypted ${openpgp_secret_keys.length} keys in ${time_diff_ms}ms\n`);
  }
};
