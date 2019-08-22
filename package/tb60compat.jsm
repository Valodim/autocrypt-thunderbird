/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

"use strict";

/**
 *  TB 60-68 compatibility Module
 */

var EXPORTED_SYMBOLS = ["AutocryptTb60Compat"];

const MailUtils = ChromeUtils.import("resource:///modules/MailUtils.jsm").MailUtils;

var gCompFields, gPgpMimeObj;

var AutocryptTb60Compat = {
  generateQI: function(aCid) {
    if ("generateQI" in ChromeUtils) {
      // TB > 60
      return ChromeUtils.generateQI(aCid);
    } else {
      let XPCOMUtils = ChromeUtils.import("resource://gre/modules/XPCOMUtils.jsm").XPCOMUtils;
      return XPCOMUtils.generateQI(aCid);
    }
  },

  getSecurityField: function() {
    if (!gCompFields) {
      gCompFields = Cc["@mozilla.org/messengercompose/composefields;1"].createInstance(Ci.nsIMsgCompFields);
    }
    return ("securityInfo" in gCompFields ? /* TB < 64 */ "securityInfo" : "composeSecure");
  },

  getExistingFolder: function(folderUri) {
    if ("getExistingFolder" in MailUtils) {
      // TB >= 65
      return MailUtils.getExistingFolder(folderUri);
    } else {
      return MailUtils.getFolderForURI(folderUri, false);
    }
  },

  isMessageUriInPgpMime: function() {
    if (!gPgpMimeObj) {
      gPgpMimeObj = Cc["@mozilla.org/mime/pgp-mime-js-decrypt;1"].createInstance(Ci.nsIPgpMimeProxy);
    }

    return ("messageURI" in gPgpMimeObj);
  },

  /**
   * return true, if platform is newer than or equal a given version
   */
  isPlatformNewerThan: function(requestedVersion) {
    let vc = Cc["@mozilla.org/xpcom/version-comparator;1"].getService(Ci.nsIVersionComparator);
    let appVer = Cc["@mozilla.org/xre/app-info;1"].getService(Ci.nsIXULAppInfo).platformVersion;

    return vc.compare(appVer, requestedVersion) >= 0;
  }
};