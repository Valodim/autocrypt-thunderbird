/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

// Uses: chrome://autocrypt/content/ui/enigmailCommon.js
/* global Components: false, EnigInitCommon: false */
/* global EnigInitCommon: false, GetAutocryptSvc: false, EnigGetString: false, EnigHelpWindow: false */
/* global EnigConfirm: false, AutocryptLog: false, AutocryptKeyRing: false, AutocryptDialog: false */
/* global AutocryptWindows: false, AutocryptFuncs: false, EnigFilePicker: false, EnigAlert: false */
/* global AutocryptFiles: false */

"use strict";

const AutocryptAutocrypt = ChromeUtils.import("chrome://autocrypt/content/modules/autocrypt.jsm").AutocryptAutocrypt;
const AutocryptAutocryptSetup = ChromeUtils.import("chrome://autocrypt/content/modules/autocryptSetup.jsm").AutocryptAutocryptSetup;
const AutocryptSetupImport = ChromeUtils.import("chrome://autocrypt/content/modules/autocryptSetupImport.jsm").AutocryptSetupImport;

// Initialize enigmailCommon
EnigInitCommon("manageAllKeys");

const views = { };

async function onLoad() {
  AutocryptLog.DEBUG("manageAllKeys.js: onLoad()\n");

  views.dialog = document.getElementById("manageAllKeys");
  views.labelKeyStatus = document.getElementById("labelKeyStatus");
  views.labelKeyFpr = document.getElementById("labelKeyFpr");
  views.labelKeyCreated = document.getElementById("labelKeyCreated");
  views.labelKeyCreatedFor = document.getElementById("labelKeyCreatedFor");
  views.labelKeyCreatedForAll = document.getElementById("labelKeyCreatedForAll");
  views.labelKeyUsedFor = document.getElementById("labelKeyUsedFor");
  views.labelKeyUsedForAll = document.getElementById("labelKeyUsedForAll");

  views.buttonForget = document.getElementById("buttonForget");
  views.buttonBackup = document.getElementById("buttonBackup");

  views.keyList = document.getElementById("treeAllKeys");
  views.treeChildren = views.keyList.getElementsByAttribute("id", "treechildrenAllKeys")[0];

  views.dialog.getButton("extra1").label = "Import";
  views.buttonBackup.setAttribute("disabled", "true");
  views.buttonForget.setAttribute("disabled", "true");

  await refreshKeyList();
}

async function refreshKeyList() {
  let secret_keys = await AutocryptKeyRing.getAllSecretKeys();
  await buildTreeView(secret_keys);
}

async function buildTreeView(secret_keys) {
  AutocryptLog.DEBUG("manageAllKeys.js: buildTreeView\n");

  clearTreeView();

  let key_infos = await Promise.all(secret_keys.map(secret_key => getKeyInfo(secret_key)));
  key_infos.sort(function(a, b) {
    if (a.is_active == b.is_active) {
      return a.created < b.created ? -1 : +1;
    }
    return a.is_active ? -1 : +1;
  });

  for (let i = 0; i < key_infos.length; i++) {
    const key_info = key_infos[i];
    let treeItem = buildTreeRow(key_info);
    views.treeChildren.appendChild(treeItem);
  }
}

function clearTreeView() {
  while (views.treeChildren.firstChild) {
    views.treeChildren.removeChild(views.treeChildren.firstChild);
  }
}

async function getKeyInfo(secret_key) {
  const fingerprint = secret_key.getFingerprint().toString().toUpperCase();

  const autocrypt_infos = await AutocryptAutocrypt.getAutocryptSettingsByFingerprint(fingerprint);

  let used_for_all = autocrypt_infos.map(info => info.email);
  let used_for = used_for_all.length ? used_for_all[0] : null;

  let created_for_all = secret_key.getUserIds().map(addr => AutocryptFuncs.stripEmail(addr));
  created_for_all.sort();
  let created_for = created_for_all.length ? created_for_all[0] : null;

  const creation = secret_key.getCreationTime();
  return {
    'identifier': fingerprint,
    'fpr_short': fingerprint,
    'fpr': AutocryptFuncs.formatFpr(fingerprint),
    'created': creation,
    'created_date': creation.toLocaleDateString(),
    'created_full': creation.toLocaleString(),
    'used_for': used_for ? used_for : 'None',
    'used_for_all': used_for_all,
    'created_for': created_for ? created_for : 'None',
    'created_for_all': created_for_all,
    'is_active': autocrypt_infos.length > 0
  };
}

function buildTreeRow(key_info) {
  let keyFpCol = document.createXULElement("treecell");
  let createdCol = document.createXULElement("treecell");
  let inUseCol = document.createXULElement("treecell");

  keyFpCol.setAttribute("id", "key");
  createdCol.setAttribute("id", "created");
  inUseCol.setAttribute("id", "inuse");

  keyFpCol.setAttribute("label", key_info.fpr);
  createdCol.setAttribute("label", key_info.created_date);
  inUseCol.setAttribute("label", key_info.is_active ? "Yes" : "");

  let keyRow = document.createXULElement("treerow");
  keyRow.appendChild(inUseCol);
  keyRow.appendChild(keyFpCol);
  keyRow.appendChild(createdCol);
  let treeItem = document.createXULElement("treeitem");
  treeItem.appendChild(keyRow);
  treeItem.setAttribute("identifier", key_info.identifier);
  return treeItem;
}

async function onKeySelect() {
  AutocryptLog.DEBUG("manageAllKeys.js: onKeySelect\n");

  const identifier = views.keyList.view.getItemAtIndex(views.keyList.currentIndex).getAttribute("identifier");

  const secret_keys = await AutocryptKeyRing.getAllSecretKeysMap();
  const secret_key = secret_keys[identifier];
  const key_info = await getKeyInfo(secret_key);

  views.labelKeyStatus.value = key_info.is_active ? 'Active' : 'Archived';
  views.labelKeyFpr.value = key_info.fpr;
  views.labelKeyCreated.value = key_info.created_full;

  views.labelKeyUsedFor.value = key_info.used_for;
  if (key_info.used_for_all.length > 1) {
    views.labelKeyUsedForAll.setAttribute("hidden", "false");
    views.labelKeyUsedForAll.value = `and ${key_info.used_for_all.length-1} more`;
    views.labelKeyUsedForAll.setAttribute("tooltiptext", key_info.used_for_all.join('\n'));
  } else {
    views.labelKeyUsedForAll.setAttribute("hidden", "true");
  }

  views.labelKeyCreatedFor.value = key_info.created_for;
  if (key_info.created_for_all.length > 1) {
    views.labelKeyCreatedForAll.setAttribute("hidden", "false");
    views.labelKeyCreatedForAll.value = `and ${key_info.created_for_all.length-1} more`;
    views.labelKeyCreatedForAll.setAttribute("tooltiptext", key_info.created_for_all.join('\n'));
  } else {
    views.labelKeyCreatedForAll.setAttribute("hidden", "true");
  }

  views.buttonForget.setAttribute("disabled", key_info.is_active ? 'true' : 'false');
  views.buttonBackup.setAttribute("disabled", false);
}

async function onClickBackup() {
  AutocryptLog.DEBUG("manageAllKeys.js: onClickBackup\n");

  const identifier = views.keyList.view.getItemAtIndex(views.keyList.currentIndex).getAttribute("identifier");
  if (!identifier) {
    return;
  }

  const secret_keys = await AutocryptKeyRing.getAllSecretKeysMap();
  const secret_key = secret_keys[identifier];
  if (!secret_key) {
    return;
  }

  let outFile = EnigFilePicker('swag', "", true, "*.htm", 'AutocryptKeyBackup.htm', ['Autocrypt key backup', "*.htm"]);
  if (!outFile) return;

  var exitCodeObj = {};
  var errorMsgObj = {};

  let setup_message = await AutocryptAutocryptSetup.createBackupFile(secret_key);

  if (!AutocryptFiles.writeFileContents(outFile, setup_message.msg)) {
    EnigAlert("Failed!");
  } else {
    EnigAlert(`Ok: ${setup_message.passwd}`);
  }
}

async function onClickImport() {
  let outFile = EnigFilePicker(
    'Select file to import', null, false, null, null, [
      'Autocrypt key backup', "*.htm; *.asc; *.sec; *.pgp",
      'OpenPGP Key (.sec, .asc, .pgp)', "*.sec; *.asc; *.pgp"
    ]);
  if (!outFile) return;

  const content = AutocryptFiles.readFile(outFile);
  const importOk = await AutocryptSetupImport.importContent(window, content);

  if (importOk) {
    refreshKeyList();
  } else {
    EnigAlert("File format could not be recognized!");
  }
}

async function onClickForget() {
  const keyList = document.getElementById("treeAllKeys");
  const identifier = keyList.view.getItemAtIndex(keyList.currentIndex).getAttribute("identifier");
  if (!identifier) {
    return;
  }

  let args = {
    confirm_string: identifier.substring(identifier.length -4).toLowerCase()
  };
  var result = {
    confirmed: false
  };

  window.openDialog("chrome://autocrypt/content/ui/dialogDeleteKey.xul", "",
    "chrome,dialog,modal,centerscreen", args, result);

  if (result.confirmed) {
    AutocryptLog.DEBUG(`onClickForget(): ok\n`);

    views.labelKeyStatus.value = 'Removing…';
    views.labelKeyFpr.value = '';
    views.labelKeyCreated.value = '';

    views.labelKeyCreatedFor.value = '';
    views.labelKeyUsedFor.value = '';
    views.labelKeyUsedForAll.setAttribute("hidden", "true");
    views.labelKeyCreatedForAll.setAttribute("hidden", "true");

    views.buttonForget.setAttribute("disabled", true);
    views.buttonBackup.setAttribute("disabled", true);

    setTimeout(async function() {
      await AutocryptKeyRing.forgetSecretKey(identifier);
      views.labelKeyStatus.value = 'Key removed!';
      await refreshKeyList();
    }, 100);
  }
}

document.addEventListener("dialogextra1", onClickImport);
