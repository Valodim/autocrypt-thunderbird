/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */


"use strict";

var EXPORTED_SYMBOLS = ["AutocryptDialog"];

const AutocryptLocale = ChromeUtils.import("chrome://autocrypt/content/modules/locale.jsm").AutocryptLocale;
const AutocryptLog = ChromeUtils.import("chrome://autocrypt/content/modules/log.jsm").AutocryptLog;
const AutocryptWindows = ChromeUtils.import("chrome://autocrypt/content/modules/windows.jsm").AutocryptWindows;
const AutocryptPrefs = ChromeUtils.import("chrome://autocrypt/content/modules/prefs.jsm").AutocryptPrefs;
const AutocryptConstants = ChromeUtils.import("chrome://autocrypt/content/modules/constants.jsm").AutocryptConstants;

const BUTTON_POS_0 = 1;
const BUTTON_POS_1 = 1 << 8;
const BUTTON_POS_2 = 1 << 16;

const gPromptSvc = Cc["@mozilla.org/embedcomp/prompt-service;1"].getService(Ci.nsIPromptService);

const LOCAL_FILE_CONTRACTID = "@mozilla.org/file/local;1";

var AutocryptDialog = {

  /***
   * Confirmation dialog with OK / Cancel buttons (both customizable)
   *
   * @win:         nsIWindow - parent window to display modal dialog; can be null
   * @mesg:        String    - message text
   * @okLabel:     String    - OPTIONAL label for OK button
   * @cancelLabel: String    - OPTIONAL label for cancel button
   *
   * @return:      Boolean   - true: OK pressed / false: Cancel or ESC pressed
   */
  confirmDlg: function(win, mesg, okLabel, cancelLabel) {

    let buttonPressed = AutocryptDialog.msgBox(win, {
        msgtext: mesg,
        button1: okLabel ? okLabel : AutocryptLocale.getString("dlg.button.ok"),
        cancelButton: cancelLabel ? cancelLabel : AutocryptLocale.getString("dlg.button.cancel"),
        iconType: AutocryptConstants.ICONTYPE_QUESTION,
        dialogTitle: AutocryptLocale.getString("enigConfirm")
      },
      null);

    return (buttonPressed === 0);
  },

  /**
   * Displays an alert dialog.
   *
   * @win:         nsIWindow - parent window to display modal dialog; can be null
   * @mesg:        String    - message text
   *
   * no return value
   */
  alert: function(win, mesg) {
    AutocryptDialog.msgBox(win, {
        msgtext: mesg,
        button1: AutocryptLocale.getString("dlg.button.close"),
        iconType: AutocryptConstants.ICONTYPE_ALERT,
        dialogTitle: AutocryptLocale.getString("enigAlert")
      },
      null);
  },

  /**
   * Displays an information dialog.
   *
   * @win:         nsIWindow - parent window to display modal dialog; can be null
   * @mesg:        String    - message text
   *
   * no return value
   */
  info: function(win, mesg) {
    AutocryptDialog.msgBox(win, {
        msgtext: mesg,
        button1: AutocryptLocale.getString("dlg.button.close"),
        iconType: AutocryptConstants.ICONTYPE_INFO,
        dialogTitle: AutocryptLocale.getString("enigInfo")
      },
      null);
  },

  /**
   * Displays an alert dialog with 1-3 optional buttons.
   *
   * @win:           nsIWindow - parent window to display modal dialog; can be null
   * @mesg:          String    - message text
   * @checkboxLabel: String    - if not null, display checkbox with text; the
   *                             checkbox state is returned in checkedObj.value
   * @button-Labels: String    - use "&" to indicate access key
   *     use "buttonType:label" or ":buttonType" to indicate special button types
   *        (buttonType is one of cancel, help, extra1, extra2)
   * @checkedObj:    Object    - holding the checkbox value
   *
   * @return: 0-2: button Number pressed
   *          -1: ESC or close window button pressed
   *
   */
  longAlert: function(win, mesg, checkboxLabel, okLabel, labelButton2, labelButton3, checkedObj) {
    var result = {
      value: -1,
      checked: false
    };

    if (!win) {
      win = AutocryptWindows.getBestParentWin();
    }

    win.openDialog("chrome://autocrypt/content/ui/enigmailMsgBox.xul", "_blank",
      "chrome,dialog,modal,centerscreen,resizable,titlebar", {
        msgtext: mesg,
        checkboxLabel: checkboxLabel,
        iconType: AutocryptConstants.ICONTYPE_ALERT,
        button1: okLabel,
        button2: labelButton2,
        button3: labelButton3
      },
      result);

    if (checkboxLabel) {
      checkedObj.value = result.checked;
    }
    return result.value;
  },

  /**
   * Displays a message box with 1-3 optional buttons.
   *
   * @win:           nsIWindow - parent window to display modal dialog; can be null
   * @argsObj:       Object:
   *   - msgtext:       String    - message text
   *   - dialogTitle:   String    - title of the dialog
   *   - checkboxLabel: String    - if not null, display checkbox with text; the
   *                                checkbox state is returned in checkedObj.value
   *   - iconType:      Number    - Icon type: 1=Message / 2=Question / 3=Alert / 4=Error
   *
   *   - buttonX:       String    - Button label (button 1-3) [button1 = "accept" button]
   *                                use "&" to indicate access key
   *   - cancelButton   String    - Label for cancel button
   *     use "buttonType:label" or ":buttonType" to indicate special button types
   *        (buttonType is one of cancel, help, extra1, extra2)
   *     if no button is provided, OK will be displayed
   *
   * @checkedObj:    Object    - holding the checkbox value
   *
   * @return: 0-2: button Number pressed
   *          -1: cancel button, ESC or close window button pressed
   *
   */
  msgBox: function(win, argsObj, checkedObj) {
    var result = {
      value: -1,
      checked: false
    };

    if (!win) {
      win = AutocryptWindows.getBestParentWin();
    }

    win.openDialog("chrome://autocrypt/content/ui/enigmailMsgBox.xul", "",
      "chrome,dialog,modal,centerscreen,resizable", argsObj, result);

    if (argsObj.checkboxLabel) {
      checkedObj.value = result.checked;
    }
    return result.value;
  },

  /**
   * Display a dialog with a message and a text entry field
   *
   * @win:      nsIWindow - parent window to display modal dialog; can be null
   * @mesg:     String    - message text
   * @valueObj: Object    - object to hold the entered text in .value
   *
   * @return:   Boolean - true if OK was pressed / false otherwise
   */
  promptValue: function(win, mesg, valueObj) {
    return gPromptSvc.prompt(win, AutocryptLocale.getString("enigPrompt"),
      mesg, valueObj, "", {});
  },

  /**
   * Display an alert message with an OK button and a checkbox to hide
   * the message in the future.
   * In case the checkbox was pressed in the past, the dialog is skipped
   *
   * @win:      nsIWindow - the parent window to hold the modal dialog
   * @mesg:     String    - the localized message to display
   * @prefText: String    - the name of the Autocrypt preference to read/store the
   *                        the future display status
   */
  alertPref: function(win, mesg, prefText) {
    const display = true;
    const dontDisplay = false;

    let prefValue = AutocryptPrefs.getPref(prefText);
    if (prefValue === display) {
      let checkBoxObj = {
        value: false
      };

      let buttonPressed = AutocryptDialog.msgBox(win, {
          msgtext: mesg,
          dialogTitle: AutocryptLocale.getString("enigInfo"),
          iconType: AutocryptConstants.ICONTYPE_INFO,
          checkboxLabel: AutocryptLocale.getString("dlgNoPrompt")
        },
        checkBoxObj);

      if (checkBoxObj.value && buttonPressed === 0) {
        AutocryptPrefs.setPref(prefText, dontDisplay);
      }
    }
  },

  /**
   * Display an alert dialog together with the message "this dialog will be
   * displayed |counter| more times".
   * If |counter| is 0, the dialog is not displayed.
   *
   * @win:           nsIWindow - the parent window to hold the modal dialog
   * @countPrefName: String    - the name of the Autocrypt preference to read/store the
   *                             the |counter| value
   * @mesg:          String    - the localized message to display
   *
   */
  alertCount: function(win, countPrefName, mesg) {
    let alertCount = AutocryptPrefs.getPref(countPrefName);

    if (alertCount <= 0)
      return;

    alertCount--;
    AutocryptPrefs.setPref(countPrefName, alertCount);

    if (alertCount > 0) {
      mesg += AutocryptLocale.getString("repeatPrefix", [alertCount]) + " ";
      mesg += (alertCount == 1) ? AutocryptLocale.getString("repeatSuffixSingular") : AutocryptLocale.getString("repeatSuffixPlural");
    }
    else {
      mesg += AutocryptLocale.getString("noRepeat");
    }

    AutocryptDialog.alert(win, mesg);
  },

  /**
   * Display a confirmation dialog with OK / Cancel buttons (both customizable) and
   * a checkbox to remember the selected choice.
   *
   *
   * @win:         nsIWindow - parent window to display modal dialog; can be null
   * @mesg:        String    - message text
   * @prefText     String    - the name of the Autocrypt preference to read/store the
   *                           the future display status.
   *                           the default action is chosen
   * @okLabel:     String    - OPTIONAL label for OK button
   * @cancelLabel: String    - OPTIONAL label for cancel button
   *
   * @return:      Boolean   - true: 1 pressed / 0: Cancel pressed / -1: ESC pressed
   *
   * If the dialog is not displayed:
   *  - if @prefText is type Boolean: return 1
   *  - if @prefText is type Number:  return the last choice of the user
   */
  confirmPref: function(win, mesg, prefText, okLabel, cancelLabel) {
    const notSet = 0;
    const yes = 1;
    const no = 2;
    const display = true;
    const dontDisplay = false;

    var prefValue = AutocryptPrefs.getPref(prefText);

    if (typeof(prefValue) != "boolean") {
      // number: remember user's choice
      switch (prefValue) {
        case notSet:
          {
            let checkBoxObj = {
              value: false
            };
            let buttonPressed = AutocryptDialog.msgBox(win, {
              msgtext: mesg,
              button1: okLabel ? okLabel : AutocryptLocale.getString("dlg.button.ok"),
              cancelButton: cancelLabel ? cancelLabel : AutocryptLocale.getString("dlg.button.cancel"),
              checkboxLabel: AutocryptLocale.getString("dlgKeepSetting"),
              iconType: AutocryptConstants.ICONTYPE_QUESTION,
              dialogTitle: AutocryptLocale.getString("enigConfirm")
            }, checkBoxObj);

            if (checkBoxObj.value) {
              AutocryptPrefs.setPref(prefText, (buttonPressed === 0 ? yes : no));
            }
            return (buttonPressed === 0 ? 1 : 0);
          }
        case yes:
          return 1;
        case no:
          return 0;
        default:
          return -1;
      }
    }
    else {
      // boolean: "do not show this dialog anymore" (and return default)
      switch (prefValue) {
        case display:
          {
            let checkBoxObj = {
              value: false
            };
            let buttonPressed = AutocryptDialog.msgBox(win, {
              msgtext: mesg,
              button1: okLabel ? okLabel : AutocryptLocale.getString("dlg.button.ok"),
              cancelButton: cancelLabel ? cancelLabel : AutocryptLocale.getString("dlg.button.cancel"),
              checkboxLabel: AutocryptLocale.getString("dlgNoPrompt"),
              iconType: AutocryptConstants.ICONTYPE_QUESTION,
              dialogTitle: AutocryptLocale.getString("enigConfirm")
            }, checkBoxObj);

            if (checkBoxObj.value) {
              AutocryptPrefs.setPref(prefText, false);
            }
            return (buttonPressed === 0 ? 1 : 0);
          }
        case dontDisplay:
          return 1;
        default:
          return -1;
      }
    }
  },

  /**
   *  Display a "open file" or "save file" dialog
   *
   *  win:              nsIWindow - parent window
   *  title:            String    - window title
   *  displayDir:       String    - optional: directory to be displayed
   *  save:             Boolean   - true = Save file / false = Open file
   *  defaultExtension: String    - optional: extension for the type of files to work with, e.g. "asc"
   *  defaultName:      String    - optional: filename, incl. extension, that should be suggested to
   *                                the user as default, e.g. "keys.asc"
   *  filterPairs:      Array     - optional: [title, extension], e.g. ["Pictures", "*.jpg; *.png"]
   *
   *  return value:     nsIFile object representing the file to load or save
   */
  filePicker: function(win, title, displayDir, save, defaultExtension, defaultName, filterPairs) {
    AutocryptLog.DEBUG("enigmailCommon.jsm: filePicker: " + save + "\n");

    let filePicker = Cc["@mozilla.org/filepicker;1"].createInstance();
    filePicker = filePicker.QueryInterface(Ci.nsIFilePicker);

    let mode = save ? Ci.nsIFilePicker.modeSave : Ci.nsIFilePicker.modeOpen;

    filePicker.init(win, title, mode);

    if (displayDir) {
      var localFile = Cc[LOCAL_FILE_CONTRACTID].createInstance(Ci.nsIFile);

      try {
        localFile.initWithPath(displayDir);
        filePicker.displayDirectory = localFile;
      }
      catch (ex) {}
    }

    if (defaultExtension) {
      filePicker.defaultExtension = defaultExtension;
    }

    if (defaultName) {
      filePicker.defaultString = defaultName;
    }

    let nfilters = 0;
    if (filterPairs && filterPairs.length) {
      nfilters = filterPairs.length / 2;
    }

    for (let index = 0; index < nfilters; index++) {
      filePicker.appendFilter(filterPairs[2 * index], filterPairs[2 * index + 1]);
    }

    filePicker.appendFilters(Ci.nsIFilePicker.filterAll);

    let inspector = Cc["@mozilla.org/jsinspector;1"].createInstance(Ci.nsIJSInspector);
    let gotFile = null;
    filePicker.open(res => {
      if (res != Ci.nsIFilePicker.returnOK && res != Ci.nsIFilePicker.returnReplace) {
        inspector.exitNestedEventLoop();
        return;
      }

      gotFile = filePicker.file.QueryInterface(Ci.nsIFile);
      inspector.exitNestedEventLoop();
    });

    inspector.enterNestedEventLoop(0); // wait for async process to terminate

    return gotFile;
  },

  /**
   * return a pre-initialized prompt service
   */
  getPromptSvc: function() {
    return gPromptSvc;
  }
};

AutocryptWindows.alert = AutocryptDialog.alert;
