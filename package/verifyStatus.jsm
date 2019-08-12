/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

"use strict";

/**
 *  Module for dealing with received Autocrypt headers, level 0
 *  See details at https://github.com/mailencrypt/autocrypt
 */

var EXPORTED_SYMBOLS = ["MessageCryptoStatus", "COLUMN_STATUS"];

const SIGNATURE_STATUS = {
  NONE: -1,
  INVALID: 0,
  KEY_MISSING: 1,
  OK: 2
};

const SIGNATURE_KEY_STATUS = {
  NONE: 0,
  OK: 1,
  INVALID_KEY_REVOKED: 2,
  INVALID_KEY_EXPIRED: 3,
  INVALID_KEY_INSECURE: 4
};

const SIGNATURE_TRUST_STATUS = {
  NONE: 0,
  TRUSTED: 1
};

const DECRYPTION_STATUS = {
  NONE: -1,
  ERROR: 0,
  OK: 1
};

const COLUMN_STATUS = {
  NONE: 0,
  E2E: 1,
  SIGNED: 2
};

function MessageCryptoStatus(signature_status, sig_key_status, sig_trust_status, decryption_status, sender_address, sig_key_id, public_key) {
  this.signature_status = signature_status;
  this.sig_key_status = sig_key_status;
  this.sig_trust_status = sig_trust_status;
  this.decryption_status = decryption_status;
  this.sig_key_id = sig_key_id;
  this.sender_address = sender_address;
  this.public_key = public_key;
}

MessageCryptoStatus.prototype.wasEncrypted = function() {
  return this.decryption_status != DECRYPTION_STATUS.NONE;
};

MessageCryptoStatus.prototype.isDecryptOk = function() {
  return this.decryption_status == DECRYPTION_STATUS.OK;
};

MessageCryptoStatus.prototype.wasSigned = function() {
  return this.signature_status != SIGNATURE_STATUS.NONE;
};

MessageCryptoStatus.prototype.isSignOk = function() {
  return this.signature_status == SIGNATURE_STATUS.OK;
};

MessageCryptoStatus.prototype.isSignKeyKnown = function() {
  return this.signature_status != SIGNATURE_STATUS.NONE &&
    this.signature_status != SIGNATURE_STATUS.KEY_MISSING;
};

MessageCryptoStatus.prototype.getColumnStatusInt = function() {
  if (this.isDecryptOk() && this.isSignOk()) {
    return COLUMN_STATUS.E2E;
  } else if (this.isSignOk()) {
    return COLUMN_STATUS.SIGNED;
  }
  return COLUMN_STATUS.NONE;
};

MessageCryptoStatus.prototype.getSignKeyId = function() {
  return this.sig_key_id;
};

MessageCryptoStatus.prototype.isSignKeyTrusted = function() {
  return this.sig_trust_status == SIGNATURE_TRUST_STATUS.TRUSTED;
};

MessageCryptoStatus.prototype.combineWith = function(verify_status) {
  return new MessageCryptoStatus(
    verify_status.signature_status,
    verify_status.sig_key_status,
    verify_status.sig_trust_status,
    this.decryption_status,
    verify_status.sender_address,
    verify_status.sig_key_id,
    verify_status.public_key
  );
};

MessageCryptoStatus.createDecryptOkStatus = function(sender_address, sig_ok, sig_key_id, public_key) {
  return new MessageCryptoStatus(
    sig_ok ? SIGNATURE_STATUS.OK : (sig_key_id ? (public_key ? SIGNATURE_STATUS.ERROR : SIGNATURE_STATUS.KEY_MISSING) : SIGNATURE_STATUS.NONE),
    public_key ? SIGNATURE_KEY_STATUS.OK : SIGNATURE_KEY_STATUS.NONE,
    SIGNATURE_TRUST_STATUS.NONE,
    DECRYPTION_STATUS.OK,
    sender_address,
    sig_key_id,
    public_key
  );
};

MessageCryptoStatus.createDecryptErrorStatus = function(sender_address) {
  return new MessageCryptoStatus(
    SIGNATURE_STATUS.NONE,
    SIGNATURE_KEY_STATUS.NONE,
    SIGNATURE_TRUST_STATUS.NONE,
    DECRYPTION_STATUS.ERROR,
    sender_address
  );
};

MessageCryptoStatus.createVerifyOkStatus = function(sender_address, sig_key_id, public_key) {
  return new MessageCryptoStatus(
    SIGNATURE_STATUS.OK,
    SIGNATURE_KEY_STATUS.OK,
    SIGNATURE_TRUST_STATUS.NONE,
    DECRYPTION_STATUS.NONE,
    sender_address,
    sig_key_id,
    public_key
  );
};

MessageCryptoStatus.createVerifyErrorStatus = function(sender_address, sig_key_id, public_key) {
  return new MessageCryptoStatus(
    public_key ? SIGNATURE_STATUS.INVALID : SIGNATURE_STATUS.KEY_MISSING,
    SIGNATURE_KEY_STATUS.NONE,
    SIGNATURE_TRUST_STATUS.NONE,
    DECRYPTION_STATUS.NONE,
    sender_address,
    sig_key_id,
    public_key
  );
};
