/*global Components: false */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

"use strict";

var EXPORTED_SYMBOLS = ["EnigmailMimeDecrypt"];

/**
 *  Module for handling PGP/MIME encrypted messages
 *  implemented as an XPCOM object
 */

/*global atob: false */

const EnigmailCore = ChromeUtils.import("chrome://autocrypt/content/modules/core.jsm").EnigmailCore;
const EnigmailVerify = ChromeUtils.import("chrome://autocrypt/content/modules/mimeVerify.jsm").EnigmailVerify;
const EnigmailLog = ChromeUtils.import("chrome://autocrypt/content/modules/log.jsm").EnigmailLog;
const EnigmailLocale = ChromeUtils.import("chrome://autocrypt/content/modules/locale.jsm").EnigmailLocale;
const EnigmailData = ChromeUtils.import("chrome://autocrypt/content/modules/data.jsm").EnigmailData;
const EnigmailDecryption = ChromeUtils.import("chrome://autocrypt/content/modules/decryption.jsm").EnigmailDecryption;
const EnigmailFuncs = ChromeUtils.import("chrome://autocrypt/content/modules/funcs.jsm").EnigmailFuncs;
var EnigmailMime = ChromeUtils.import("chrome://autocrypt/content/modules/mime.jsm").EnigmailMime;
const EnigmailURIs = ChromeUtils.import("chrome://autocrypt/content/modules/uris.jsm").EnigmailURIs;
const EnigmailConstants = ChromeUtils.import("chrome://autocrypt/content/modules/constants.jsm").EnigmailConstants;
const EnigmailSingletons = ChromeUtils.import("chrome://autocrypt/content/modules/singletons.jsm").EnigmailSingletons;
const EnigmailCryptoAPI = ChromeUtils.import("chrome://autocrypt/content/modules/cryptoAPI.jsm").EnigmailCryptoAPI;
const EnigmailAutocrypt = ChromeUtils.import("chrome://autocrypt/content/modules/autocrypt.jsm").EnigmailAutocrypt;
const EnigmailTb60Compat = ChromeUtils.import("chrome://autocrypt/content/modules/tb60compat.jsm").EnigmailTb60Compat;
const EnigmailKeyRing = ChromeUtils.import("chrome://autocrypt/content/modules/keyRing.jsm").EnigmailKeyRing;
const AutocryptMessageCache = ChromeUtils.import("chrome://autocrypt/content/modules/messageCache.jsm").AutocryptMessageCache;
const MessageCryptoStatus = ChromeUtils.import("chrome://autocrypt/content/modules/verifyStatus.jsm").MessageCryptoStatus;
const AutocryptHelper = ChromeUtils.import("chrome://autocrypt/content/modules/autocryptHelper.jsm").AutocryptHelper;
const AutocryptSessionKeyCache = ChromeUtils.import("chrome://autocrypt/content/modules/sessionKeyCache.jsm").AutocryptSessionKeyCache;

const APPSHELL_MEDIATOR_CONTRACTID = "@mozilla.org/appshell/window-mediator;1";
const PGPMIME_JS_DECRYPTOR_CONTRACTID = "@mozilla.org/mime/pgp-mime-js-decrypt;1";
const PGPMIME_JS_DECRYPTOR_CID = Components.ID("{7514cbeb-2bfd-4b2c-829b-1a4691fa0ac8}");

const ENCODING_DEFAULT = 0;
const ENCODING_BASE64 = 1;
const ENCODING_QP = 2;

var EnigmailMimeDecrypt = {
  /**
   * create a new instance of a PGP/MIME decryption handler
   */
  newPgpMimeHandler: function() {
    return new MimeDecryptHandler();
  },

  /**
   * Return a fake empty attachment with information that the message
   * was not decrypted
   *
   * @return {String}: MIME string (HTML text)
   */
  emptyAttachment: function() {
    EnigmailLog.DEBUG("mimeDecrypt.jsm: emptyAttachment()\n");

    let encPart = EnigmailLocale.getString("mimeDecrypt.encryptedPart.attachmentLabel");
    let concealed = EnigmailLocale.getString("mimeDecrypt.encryptedPart.concealedData");
    let retData =
      `Content-Type: message/rfc822; name="${encPart}.eml"
Content-Transfer-Encoding: 7bit
Content-Disposition: attachment; filename="${encPart}.eml"

Content-Type: text/html

<p><i>${concealed}</i></p>
`;
    return retData;
  },

  /**
   * Wrap the decrypted output into a message/rfc822 attachment
   *
   * @param {String} decryptingMimePartNum: requested MIME part number
   * @param {Object} uri: nsIURI object of the decrypted message
   *
   * @return {String}: prefix for message data
   */
  pretendAttachment: function(decryptingMimePartNum, uri) {
    if (decryptingMimePartNum === "1" || !uri) return "";

    let msg = "";
    let mimePartNumber = EnigmailMime.getMimePartNumber(uri.spec);

    if (mimePartNumber === decryptingMimePartNum + ".1") {
      msg = 'Content-Type: message/rfc822; name="attachment.eml"\r\n' +
        'Content-Transfer-Encoding: 7bit\r\n' +
        'Content-Disposition: attachment; filename="attachment.eml"\r\n\r\n';

      try {
        let dbHdr = uri.QueryInterface(Ci.nsIMsgMessageUrl).messageHeader;
        if (dbHdr.subject) msg += `Subject: ${dbHdr.subject}\r\n`;
        if (dbHdr.author) msg += `From: ${dbHdr.author}\r\n`;
        if (dbHdr.recipients) msg += `To: ${dbHdr.recipients}\r\n`;
        if (dbHdr.ccList) msg += `Cc: ${dbHdr.ccList}\r\n`;
      } catch (x) {}
    }

    return msg;
  }
};

////////////////////////////////////////////////////////////////////
// handler for PGP/MIME encrypted messages
// data is processed from libmime -> nsPgpMimeProxy

function MimeDecryptHandler() {

  EnigmailLog.DEBUG("mimeDecrypt.jsm: MimeDecryptHandler()\n"); // always log this one
  this.mimeSvc = null;
  this.initOk = false;
  this.boundary = "";
  this.statusStr = "";
  this.outQueue = "";
  this.dataLength = 0;
  this.bytesWritten = 0;
  this.mimePartCount = 0;
  this.headerMode = 0;
  this.xferEncoding = ENCODING_DEFAULT;
  this.matchedPgpDelimiter = 0;
  this.msgWindow = null;
  this.msgUriSpec = null;
  this.proc = null;
  this.statusDisplayed = false;
  this.uri = null;
  this.backgroundJob = false;
  this.mimePartNumber = "";
  this.dataIsBase64 = null;
  this.base64Cache = "";

  if (EnigmailTb60Compat.isMessageUriInPgpMime()) {
    this.onDataAvailable = this.onDataAvailable68;
  } else {
    this.onDataAvailable = this.onDataAvailable60;
  }
}

MimeDecryptHandler.prototype = {
  inStream: Cc["@mozilla.org/scriptableinputstream;1"].createInstance(Ci.nsIScriptableInputStream),

  onStartRequest: function(request, uri) {
    if (!EnigmailCore.getService()) // Ensure Enigmail is initialized
      return;
    EnigmailLog.DEBUG("mimeDecrypt.jsm: onStartRequest\n"); // always log this one

    this.initOk = true;
    this.mimeSvc = request.QueryInterface(Ci.nsIPgpMimeProxy);
    if ("mimePart" in this.mimeSvc) {
      this.mimePartNumber = this.mimeSvc.mimePart;
    } else {
      this.mimePartNumber = "";
    }

    if ("messageURI" in this.mimeSvc) {
      this.uri = this.mimeSvc.messageURI;
      if (this.uri) {
        EnigmailLog.DEBUG("mimeDecrypt.jsm: onStartRequest: uri='" + this.uri.spec + "'\n");
      }
      else {
        EnigmailLog.DEBUG("mimeDecrypt.jsm: onStartRequest: uri=null\n");
      }
    } else {
      if (uri) {
        this.uri = uri.QueryInterface(Ci.nsIURI);
        EnigmailLog.DEBUG("mimeDecrypt.jsm: onStartRequest: uri='" + this.uri.spec + "'\n");
      }
    }

    this.msgWindow = EnigmailVerify.lastMsgWindow;
    this.msgUriSpec = EnigmailVerify.lastMsgUri;

    this.statusDisplayed = false;
    this.dataLength = 0;
    this.mimePartCount = 0;
    this.bytesWritten = 0;
    this.matchedPgpDelimiter = 0;
    this.dataIsBase64 = null;
    this.base64Cache = "";
    this.outQueue = "";
    this.statusStr = "";
    this.headerMode = 0;
    this.xferEncoding = ENCODING_DEFAULT;
    this.boundary = EnigmailMime.getBoundary(this.mimeSvc.contentType);
  },

  processData: function(data) {
    // detect MIME part boundary
    if (data.indexOf(this.boundary) >= 0) {
      LOCAL_DEBUG("mimeDecrypt.jsm: processData: found boundary\n");
      ++this.mimePartCount;
      this.headerMode = 1;
      return;
    }

    // found PGP/MIME "body"
    if (this.mimePartCount == 2) {

      if (this.headerMode == 1) {
        // we are in PGP/MIME main part headers
        if (data.search(/\r|\n/) === 0) {
          // end of Mime-part headers reached
          this.headerMode = 2;
          return;
        } else {
          if (data.search(/^content-transfer-encoding:\s*/i) >= 0) {
            // extract content-transfer-encoding
            data = data.replace(/^content-transfer-encoding:\s*/i, "");
            data = data.replace(/;.*/, "").toLowerCase().trim();
            if (data.search(/base64/i) >= 0) {
              this.xferEncoding = ENCODING_BASE64;
            } else if (data.search(/quoted-printable/i) >= 0) {
              this.xferEncoding = ENCODING_QP;
            }

          }
        }
      } else {
        // PGP/MIME main part body
        if (this.xferEncoding == ENCODING_QP) {
          this.cacheData(EnigmailData.decodeQuotedPrintable(data));
        } else {
          this.cacheData(data);
        }
      }
    }
  },

  /**
   * onDataAvailable for TB <= 66
   */
  onDataAvailable60: function(req, dummy, stream, offset, count) {

    // get data from libmime
    if (!this.initOk) return;
    this.inStream.init(stream);

    if (count > 0) {
      var data = this.inStream.read(count);

      if (this.mimePartCount == 0 && this.dataIsBase64 === null) {
        // try to determine if this could be a base64 encoded message part
        this.dataIsBase64 = this.isBase64Encoding(data);
      }

      if (!this.dataIsBase64) {
        if (data.search(/[\r\n][^\r\n]+[\r\n]/) >= 0) {
          // process multi-line data line by line
          let lines = data.replace(/\r\n/g, "\n").split(/\n/);

          for (let i = 0; i < lines.length; i++) {
            this.processData(lines[i] + "\r\n");
          }
        } else
          this.processData(data);
      } else {
        this.base64Cache += data;
      }
    }
  },

  /**
   * onDataAvailable for TB >= 68
   */
  onDataAvailable68: function(req, stream, offset, count) {

    // get data from libmime
    if (!this.initOk) return;
    this.inStream.init(stream);

    if (count > 0) {
      var data = this.inStream.read(count);

      if (this.mimePartCount == 0 && this.dataIsBase64 === null) {
        // try to determine if this could be a base64 encoded message part
        this.dataIsBase64 = this.isBase64Encoding(data);
      }

      if (!this.dataIsBase64) {
        if (data.search(/[\r\n][^\r\n]+[\r\n]/) >= 0) {
          // process multi-line data line by line
          let lines = data.replace(/\r\n/g, "\n").split(/\n/);

          for (let i = 0; i < lines.length; i++) {
            this.processData(lines[i] + "\r\n");
          }
        } else
          this.processData(data);
      } else {
        this.base64Cache += data;
      }
    }
  },

  /**
   * Try to determine if data is base64 endoded
   */
  isBase64Encoding: function(str) {
    let ret = false;

    str = str.replace(/[\r\n]/, "");
    if (str.search(/^[A-Za-z0-9+/=]+$/) === 0) {
      let excess = str.length % 4;
      str = str.substring(0, str.length - excess);

      try {
        let s = atob(str);
        // if the conversion succeds, we have a base64 encoded message
        ret = true;
      } catch (ex) {
        // not a base64 encoded
      }
    }

    return ret;
  },

  // cache encrypted data for writing to subprocess
  cacheData: function(str) {
    this.outQueue += str;
  },

  processBase64Message: function() {
    LOCAL_DEBUG("mimeDecrypt.jsm: processBase64Message\n");

    try {
      this.base64Cache = EnigmailData.decodeBase64(this.base64Cache);
    } catch (ex) {
      // if decoding failed, try non-encoded version
    }

    let lines = this.base64Cache.replace(/\r\n/g, "\n").split(/\n/);

    for (let i = 0; i < lines.length; i++) {
      this.processData(lines[i] + "\r\n");
    }
  },

  isUrlEnigmailConvert: function() {
    if (!this.uri) return false;

    return (this.uri.spec.search(/[&?]header=enigmailConvert/) >= 0);
  },

  onStopRequest: function(request, status, dummy) {
    LOCAL_DEBUG("mimeDecrypt.jsm: onStopRequest\n");
    if (!this.initOk) return;

    if (this.dataIsBase64) {
      this.processBase64Message();
    }

    this.msgWindow = EnigmailVerify.lastMsgWindow;
    this.msgUriSpec = EnigmailVerify.lastMsgUri;

    this.backgroundJob = (this.uri && this.uri.spec.search(/[&?]header=(print|quotebody|enigmailConvert)/) >= 0);

    // return if not decrypting currently displayed message (except if
    // printing, replying, etc)
    if (!this.checkShouldDecryptUri(this.uri, this.msgUriSpec)) {
      return;
    }

    let spec = this.uri ? this.uri.spec : null;
    EnigmailLog.DEBUG(`mimeDecrypt.jsm: checking MIME structure for ${this.mimePartNumber} / ${spec}\n`);

    if (!EnigmailMime.isRegularMimeStructure(this.mimePartNumber, spec, false)) {
      if (!this.isUrlEnigmailConvert()) {
        this.returnDataToLibMime(EnigmailMimeDecrypt.emptyAttachment());
      } else {
        throw "mimeDecrypt.jsm: Cannot decrypt messages with mixed (encrypted/non-encrypted) content";
      }
      return;
    }

    const cached_message = AutocryptMessageCache.getCachedMessage(this.uri);
    if (cached_message) {
      this.mimePartNumber = "1";
      this.displayStatus(cached_message.verify_status, cached_message.decrypted_headers);
      this.returnDataToLibMime(cached_message.decrypted_plaintext);
      return;
    }

    if (this.xferEncoding == ENCODING_BASE64) {
      this.outQueue = EnigmailData.decodeBase64(this.outQueue) + "\n";
    }

    let win = this.msgWindow;

    if (!EnigmailDecryption.isReady(win)) return;

    // discover the pane
    var pane = Cc["@mozilla.org/appshell/window-mediator;1"]
        .getService(Components.interfaces.nsIWindowMediator)
        .getMostRecentWindow("mail:3pane");
    let sender_address = EnigmailDecryption.getFromAddr(pane);

    this.displayLoadingProgress();

    EnigmailLog.DEBUG(`mimeDecrypt.jsm: starting decryption\n`);

    let uri = this.uri;
    let pgpBlock = this.outQueue;
    const cApi = EnigmailCryptoAPI();
    let [decrypted_plaintext, verify_status] = cApi.sync((async function() {
      await AutocryptHelper.processAutocryptForMessage(uri);

      let cached_session_key = AutocryptSessionKeyCache.getCachedSessionKey(uri);
      let openpgp_secret_keys = await EnigmailKeyRing.getAllSecretKeys();
      let openpgp_public_key = await EnigmailKeyRing.getPublicKeyByEmail(sender_address);

      try {
        let return_status = await cApi.decrypt(pgpBlock, openpgp_secret_keys,
          openpgp_public_key, cached_session_key, async (key_id) => await EnigmailKeyRing.getPublicKeyByKeyId(key_id));
        let verify_status = MessageCryptoStatus.createDecryptOkStatus(sender_address, return_status.sig_ok, return_status.sig_key_id, return_status.sig_openpgp_key);

        if (!cached_session_key && return_status.session_key) {
          AutocryptSessionKeyCache.putCachedSessionKey(uri, return_status.session_key);
        }

        return [return_status.plaintext, verify_status];
      } catch (e) {
        EnigmailLog.DEBUG(`mimeDecrypt.jsm: decrypt error: ${e}\n`);
        let verify_status = MessageCryptoStatus.createDecryptErrorStatus(sender_address);
        return ["", verify_status];
      }
    })());

    LOCAL_DEBUG("mimeDecrypt.jsm: decryption ok\n");

    // ensure newline at the end of the stream
    if (!decrypted_plaintext.endsWith("\n")) {
      decrypted_plaintext += "\r\n";
    }

    // this is async, but we don't have to wait
    this.extractAutocryptGossip(decrypted_plaintext);

    let decrypted_headers;
    const extractResult = this.extractEncryptedHeaders(decrypted_plaintext);
    if (extractResult) {
      decrypted_plaintext = extractResult[0];
      decrypted_headers = extractResult[1];
    }

    {
      let replacedPlaintext = this.maybeAddWrapperToDecryptedResult(decrypted_plaintext);
      if (replacedPlaintext) decrypted_plaintext = replacedPlaintext;
    }

    // HACK: remove filename from 1st HTML and plaintext parts to make TB display message without attachment
    decrypted_plaintext = decrypted_plaintext.replace(/^Content-Disposition: inline; filename="[^"]+"/m, "Content-Disposition: inline");

    this.displayStatus(verify_status, decrypted_headers);

    let prefix = EnigmailMimeDecrypt.pretendAttachment(this.mimePartNumber, this.uri);
    this.returnDataToLibMime(prefix + decrypted_plaintext);

    // don't remember the last message if it contains an embedded PGP/MIME message
    // to avoid ending up in a loop
    if (this.mimePartNumber === "1" &&
      AutocryptMessageCache.shouldCacheByStatus(verify_status) &&
      decrypted_plaintext.search(/^Content-Type:[\t ]+multipart\/encrypted/mi) < 0) {
      const cached_message = {
        decrypted_plaintext: decrypted_plaintext,
        decrypted_headers: decrypted_headers,
        verify_status: verify_status
      };
      AutocryptMessageCache.putCachedMessage(this.uri, cached_message);
    }
    EnigmailLog.DEBUG("mimeDecrypt.jsm: onStopRequest: process terminated\n"); // always log this one
    this.proc = null;
  },

  displayLoadingProgress: function() {
      EnigmailLog.DEBUG("mimeDecrypt.jsm: displayLoadingProgress()\n");
      let headerSink = EnigmailSingletons.messageReader;
      if (headerSink && this.uri && !this.backgroundJob) {
        headerSink.showLoading();
      }
  },

  displayStatus: function(verify_status, decrypted_headers) {
    EnigmailLog.DEBUG("mimeDecrypt.jsm: displayStatus\n");

    if (this.msgWindow === null || this.statusDisplayed)
      return;

    let uriSpec = (this.uri ? this.uri.spec : null);

    try {
      EnigmailLog.DEBUG("mimeDecrypt.jsm: displayStatus for uri " + uriSpec + "\n");
      let headerSink = EnigmailSingletons.messageReader;

      if (headerSink && this.uri && !this.backgroundJob) {
        headerSink.processDecryptionResult(this.uri, "modifyMessageHeaders", JSON.stringify(decrypted_headers), this.mimePartNumber);

        headerSink.updateSecurityStatus(
          verify_status,
          this.uri,
          this.mimePartNumber);
      } else {
        this.updateHeadersInMsgDb(decrypted_headers);
      }
      this.statusDisplayed = true;
    } catch (ex) {
      EnigmailLog.writeException("mimeDecrypt.jsm", ex);
    }
    LOCAL_DEBUG("mimeDecrypt.jsm: displayStatus done\n");
  },

  checkShouldDecryptUri: function(uri, msgUriSpec) {
    if (!uri) {
      return true;
    }

    try {
      var messenger = Cc["@mozilla.org/messenger;1"].getService(Ci.nsIMessenger);

      let url = {};
      if (msgUriSpec) {
        let msgSvc = messenger.messageServiceFromURI(msgUriSpec);

        msgSvc.GetUrlForUri(msgUriSpec, url, null);
      }

      if (uri.spec.search(/[&?]header=[^&]+/) > 0 &&
        uri.spec.search(/[&?]examineEncryptedParts=true/) < 0) {

        if (uri.spec.search(/[&?]header=(filter|enigmailFilter)(&.*)?$/) > 0) {
          EnigmailLog.DEBUG("mimeDecrypt.jsm: onStopRequest: detected incoming message processing\n");
          return false;
        }
      }

      if (uri.spec.search(/[&?]header=[^&]+/) < 0 &&
        uri.spec.search(/[&?]part=[.0-9]+/) < 0 &&
        uri.spec.search(/[&?]examineEncryptedParts=true/) < 0) {

        if (uri && url && url.value) {

          if ("path" in url) {
            // TB < 57
            if (url.value.host !== uri.host ||
              url.value.path !== uri.path)
              return false;
          } else {
            // TB >= 57
            if (url.value.host !== uri.host ||
              url.value.pathQueryRef !== uri.pathQueryRef)
              return false;
          }
        }
      }
    } catch (ex) {
      EnigmailLog.writeException("mimeDecrypt.js", ex);
      EnigmailLog.DEBUG("mimeDecrypt.jsm: error while processing " + msgUriSpec + "\n");
    }

    return true;
  },

  maybeAddWrapperToDecryptedResult: function(decrypted_plaintext) {
    let i = decrypted_plaintext.search(/\n\r?\n/);
    if (!i) {
      return null;
    }

    var hdr = decrypted_plaintext.substr(0, i).split(/\r?\n/);
    for (let j = 0; j < hdr.length; j++) {
      if (hdr[j].search(/^\s*content-type:\s+text\/(plain|html)/i) >= 0) {
        continue;
      }

      LOCAL_DEBUG("mimeDecrypt.jsm: done: adding multipart/mixed around " + hdr[j] + "\n");
      if (!this.isUrlEnigmailConvert()) {
        let wrapper = EnigmailMime.createBoundary();

        return 'Content-Type: multipart/mixed; boundary="' + wrapper + '"\r\n' +
          'Content-Disposition: inline\r\n\r\n' +
          '--' + wrapper + '\r\n' +
          decrypted_plaintext + '\r\n' +
          '--' + wrapper + '--\r\n';
      }
    }
    return null;
  },

  extractContentType: function(data) {
    let i = data.search(/\n\r?\n/);
    if (i <= 0) return null;

    let headers = Cc["@mozilla.org/messenger/mimeheaders;1"].createInstance(Ci.nsIMimeHeaders);
    headers.initialize(data.substr(0, i));
    return headers.extractHeader("content-type", false);
  },

  // return data to libMime
  returnDataToLibMime: function(data) {
    EnigmailLog.DEBUG("mimeDecrypt.jsm: returnDataToLibMime: " + data.length + " bytes\n");

    let proto = null;
    let ct = this.extractContentType(data);
    if (ct && ct.search(/multipart\/signed/i) >= 0) {
      proto = EnigmailMime.getProtocol(ct);
    }

    try {
      if (proto && proto.search(/application\/(pgp|pkcs7|x-pkcs7)-signature/i) >= 0) {
        EnigmailLog.DEBUG("mimeDecrypt.jsm: returnDataToLibMime: using direct verification\n");
        this.mimeSvc.contentType = ct;
        if ("mimePart" in this.mimeSvc) {
          this.mimeSvc.mimePart = this.mimeSvc.mimePart + ".1";
        }
        let veri = EnigmailVerify.newVerifier(proto);
        veri.onStartRequest(this.mimeSvc, this.uri);
        veri.onTextData(data);
        veri.onStopRequest(null, 0);
      } else {
        if ("outputDecryptedData" in this.mimeSvc) {
          // TB >= 57
          this.mimeSvc.outputDecryptedData(data, data.length);
        } else {
          let gConv = Cc["@mozilla.org/io/string-input-stream;1"].createInstance(Ci.nsIStringInputStream);
          gConv.setData(data, data.length);
          this.mimeSvc.onStartRequest(null, null);
          this.mimeSvc.onDataAvailable(null, null, gConv, 0, data.length);
          this.mimeSvc.onStopRequest(null, null, 0);
        }
      }
    } catch (ex) {
      EnigmailLog.ERROR("mimeDecrypt.jsm: returnDataToLibMime(): mimeSvc.onDataAvailable failed:\n" + ex.toString());
    }
  },

  updateHeadersInMsgDb: function(decrypted_headers) {
    if (this.mimePartNumber !== "1") return;
    if (!this.uri) return;

    if (decrypted_headers && ("subject" in decrypted_headers)) {
      try {
        let msgDbHdr = this.uri.QueryInterface(Ci.nsIMsgMessageUrl).messageHeader;
        msgDbHdr.subject = EnigmailData.convertFromUnicode(decrypted_headers.subject, "utf-8");
      } catch (x) {}
    }
  },

  extractEncryptedHeaders: function(decrypted_plaintext) {
    try {
      let r = EnigmailMime.extractProtectedHeaders(decrypted_plaintext);
      if (!r) return null;

      const decrypted_headers = r.newHeaders;
      if (r.startPos >= 0 && r.endPos > r.startPos) {
        return [decrypted_plaintext.substr(0, r.startPos) + decrypted_plaintext.substr(r.endPos), decrypted_headers];
      }
    } catch (ex) {
      EnigmailLog.DEBUG(`mimeDecrypt.jsm: extractEncryptedHeaders: Error: ${ex}\n`);
    }
    return null;
  },

  extractAutocryptGossip: async function(decrypted_plaintext) {
    try {
      const m = decrypted_plaintext.search(/^--/m);
      const hdr = Cc["@mozilla.org/messenger/mimeheaders;1"].createInstance(Ci.nsIMimeHeaders);
      hdr.initialize(decrypted_plaintext.substr(0, m));

      const gossip = hdr.getHeader("autocrypt-gossip") || [];
      EnigmailLog.DEBUG(`mimeDecrypt.jsm: extractAutocryptGossip: found ${gossip.length} headers\n`);

      const msgHdr = this.uri.QueryInterface(Ci.nsIMsgMessageUrl).messageHeader;

      let msgDate = null;
      try {
        msgDate = msgHdr.dateInSeconds;
      } catch (x) {}

      const recipients = EnigmailFuncs.getDistinctNonSelfRecipients(msgHdr.recipients, msgHdr.ccList);
      EnigmailLog.DEBUG(`mimeDecrypt.jsm: allowed addresses: ${recipients.join(', ')}\n`);

      await EnigmailAutocrypt.processAutocryptGossipHeaders(gossip, recipients, msgDate);
    } catch (ex) {
      EnigmailLog.DEBUG(`mimeDecrypt.jsm: extractAutocryptGossip: Error: ${ex}\n`);
    }
  }
};


////////////////////////////////////////////////////////////////////
// General-purpose functions, not exported

function LOCAL_DEBUG(str) {
  EnigmailLog.DEBUG(str);
}

// Note: cache should not be re-used by repeated calls to JSON.stringify.
function stringify(o) {
  const cache = [];
  return JSON.stringify(o, function(key, value) {
      if (typeof value === 'object' && value !== null) {
          if (cache.indexOf(value) !== -1) {
              // Duplicate reference found, discard key
              return undefined;
          }
          // Store value in our collection
          cache.push(value);
      }
      return value;
  });
}
