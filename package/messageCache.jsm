/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

"use strict";

const EnigmailLog = ChromeUtils.import("chrome://enigmail/content/modules/log.jsm").EnigmailLog;
const EnigmailURIs = ChromeUtils.import("chrome://enigmail/content/modules/uris.jsm").EnigmailURIs;

var EXPORTED_SYMBOLS = ["AutocryptMessageCache"];

var AutocryptMessageCache = {
  message_cache: [],

  getCachedMessage: function(uri) {
    if (!uri || uri.spec.search(/[&?]header=enigmailConvert/) >= 0) {
      return null;
    }
    EnigmailLog.DEBUG(`messageCache.jsm: getCachedMessage(): ${uri}\n`);
    let msg_identifier = getMsgIdentifier(uri);
    if (!msg_identifier) {
      return null;
    }
    for (let cache_entry of this.message_cache) {
      if (msg_identifier.folder === cache_entry.msg_identifier.folder && cache_entry.msg_identifier.msgNum === msg_identifier.msgNum) {
        EnigmailLog.DEBUG(`messageCache.jsm: getCachedMessage(): ok\n`);
        return cache_entry.decrypted_message;
      }
    }
    EnigmailLog.DEBUG(`messageCache.jsm: getCachedMessage(): not cached\n`);
    return null;
  },

  putCachedMessage: function(uri, decrypted_message) {
    if (!uri || uri.spec.search(/[&?]header=enigmailConvert/) >= 0) {
      return;
    }
    if (this.getCachedMessage(uri)) {
      return;
    }
    EnigmailLog.DEBUG(`messageCache.jsm: putCachedMessage(): ${uri}\n`);
    let msg_identifier = getMsgIdentifier(uri);
    if (!msg_identifier) {
      return;
    }
    this.message_cache.push({msg_identifier: msg_identifier, decrypted_message: decrypted_message});
  }
};

function getMsgIdentifier(uri) {
  let msg_identifier = EnigmailURIs.msgIdentificationFromUrl(uri);
  EnigmailLog.DEBUG(`messageCache.jsm: getMsgIdentifier(): ${JSON.stringify(msg_identifier)}\n`);
  return msg_identifier;
}