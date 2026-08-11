import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import Soup from 'gi://Soup';

const PROMPT_FIX_GRAMMAR = "You are a grammar correction tool. Correct the following text. Return *only* the corrected text, with no explanation, preamble, or markdown formatting.";
const PROMPT_IMPROVE_TEXT = "You are an editing assistant. Improve the following text for clarity, flow, and impact. Return *only* the improved text, with no explanation, preamble, or markdown formatting.";

const LLMTextIndicator = GObject.registerClass(
class LLMTextIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'LLM Text Modifier');

        this._extension = extension;

        this.add_child(new St.Icon({
            icon_name: 'document-edit-symbolic',
            style_class: 'system-status-icon',
        }));

        const improveItem = new PopupMenu.PopupMenuItem('Improve Selection or Clipboard');
        improveItem.connect('activate', () => {
            this._extension.processSelectionOrClipboard('improve');
        });
        this.menu.addMenuItem(improveItem);

        const fixItem = new PopupMenu.PopupMenuItem('Fix Selection or Clipboard');
        fixItem.connect('activate', () => {
            this._extension.processSelectionOrClipboard('fix');
        });
        this.menu.addMenuItem(fixItem);
    }
});

export default class LLMTextExtension extends Extension {
    constructor(metadata) {
        super(metadata);
        this._httpSession = null;
        this._indicator = null;
        this._panelIconSettingsChangedId = 0;
    }

    enable() {
        console.debug(`[${this.uuid}]: Enabling extension...`);
        
        this._settings = this.getSettings();
        this._httpSession = new Soup.Session();

        this._syncIndicatorVisibility();
        this._panelIconSettingsChangedId = this._settings.connect('changed::show-panel-icon', () => {
            this._syncIndicatorVisibility();
        });
        
        this._bindHotkey('hotkey-fix', () => this._processClipboard('fix'));
        this._bindHotkey('hotkey-improve', () => this._processClipboard('improve'));
    }

    disable() {
        console.debug(`[${this.uuid}]: Disabling extension...`);
        
        Main.wm.removeKeybinding('hotkey-fix');
        Main.wm.removeKeybinding('hotkey-improve');

        if (this._settings && this._panelIconSettingsChangedId) {
            this._settings.disconnect(this._panelIconSettingsChangedId);
            this._panelIconSettingsChangedId = 0;
        }

        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }

        this._settings = null;

        if (this._httpSession) {
            // REVIEW FIX 1: Abort pending requests
            this._httpSession.abort();
            this._httpSession = null;
        }
    }

    _bindHotkey(name, callback) {
        Main.wm.addKeybinding(
            name,
            this._settings,
            Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL,
            callback
        );
    }

    _getPrompt(mode, text) {
        let systemPrompt;
        if (mode === 'fix') {
            systemPrompt = this._settings.get_string('prompt-fix-grammar');
        } else {
            systemPrompt = this._settings.get_string('prompt-improve-text');
        }

        return [
            { "role": "system", "content": systemPrompt },
            { "role": "user", "content": text }
        ];
    }

    _syncIndicatorVisibility() {
        const shouldShowIndicator = this._settings?.get_boolean('show-panel-icon');

        if (shouldShowIndicator && !this._indicator) {
            this._indicator = new LLMTextIndicator(this);
            Main.panel.addToStatusArea(this.uuid, this._indicator);
        } else if (!shouldShowIndicator && this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }

    _readClipboardText(type) {
        const clipboard = St.Clipboard.get_default();

        return new Promise((resolve, reject) => {
            clipboard.get_text(type, (_clip, text) => {
                if (text && text.trim()) {
                    resolve(text);
                } else {
                    reject(new Error('No text available.'));
                }
            });
        });
    }

    async _getPrimarySelectionOrClipboardText() {
        try {
            return await this._readClipboardText(St.ClipboardType.PRIMARY);
        } catch (_primaryError) {
            return this._readClipboardText(St.ClipboardType.CLIPBOARD);
        }
    }

    async _processText(mode, text, completionMessage) {
        console.debug(`[${this.uuid}]: Processing text for mode: ${mode}`);

        if (!this._httpSession) {
            console.error(`[${this.uuid}]: _httpSession is null`);
            Main.notifyError('LLM Text Error', 'Session error. Please restart extension.');
            return;
        }

        try {
            if (!text || !text.trim()) {
                Main.notify('LLM Text', 'No text available to process.');
                return;
            }

            Main.notify('LLM Text', `Processing text (${mode})...`);

            const apiEndpoint = this._settings.get_string('api-endpoint');
            const modelName = this._settings.get_string('model-name');
            const apiKey = this._settings.get_string('api-key');
            const messages = this._getPrompt(mode, text);

            const payload = JSON.stringify({
                model: modelName,
                messages: messages,
                stream: false
            });

            const message = Soup.Message.new('POST', apiEndpoint);

            message.request_headers.append('Authorization', `Bearer ${apiKey}`);

            message.set_request_body_from_bytes(
                'application/json',
                new TextEncoder().encode(payload)
            );

            const bytes = await this._httpSession.send_and_read_async(
                message,
                GLib.PRIORITY_DEFAULT,
                null
            );

            if (message.get_status() !== 200) {
                throw new Error(`API request failed with status ${message.get_status()} ${message.get_reason_phrase()}`);
            }

            const responseStr = new TextDecoder().decode(bytes.get_data());
            const responseJson = JSON.parse(responseStr);

            if (!responseJson.choices || !responseJson.choices[0] || !responseJson.choices[0].message) {
                throw new Error('Invalid API response format.');
            }

            const newText = responseJson.choices[0].message.content.trim();
            const clipboard = St.Clipboard.get_default();

            clipboard.set_text(St.ClipboardType.CLIPBOARD, newText);
            clipboard.set_text(St.ClipboardType.PRIMARY, newText);
            Main.notify('LLM Text', completionMessage);
        } catch (e) {
            Main.notifyError('LLM Text Error', e.message);
            console.error(e);
        }
    }

    async processSelectionOrClipboard(mode) {
        try {
            const text = await this._getPrimarySelectionOrClipboardText();
            await this._processText(mode, text, 'Text processing complete! Result copied to clipboard.');
        } catch (_e) {
            Main.notify('LLM Text', 'No selected text or clipboard text available.');
        }
    }

    async _processClipboard(mode) {
        try {
            const clipboardText = await this._readClipboardText(St.ClipboardType.CLIPBOARD);
            await this._processText(mode, clipboardText, 'Text processing complete!');
        } catch (_e) {
            Main.notify('LLM Text', 'Clipboard is empty.');
        }
    }
}
