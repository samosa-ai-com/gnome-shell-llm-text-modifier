import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';

export default class LLMTextPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage();
        window.add(page);

        // --- API Settings Group ---
        const apiGroup = new Adw.PreferencesGroup({
            title: 'API Configuration',
            description: 'Set your local LLM API details.',
        });
        page.add(apiGroup);

        // API Endpoint
        const endpointRow = new Adw.EntryRow({
            title: 'API Endpoint',
            text: settings.get_string('api-endpoint'),
        });
        apiGroup.add(endpointRow);
        endpointRow.connect('notify::text', (entry) => {
            settings.set_string('api-endpoint', entry.get_text());
        });

        // Model Name
        const modelRow = new Adw.EntryRow({
            title: 'Model Name',
            text: settings.get_string('model-name'),
        });
        apiGroup.add(modelRow);
        modelRow.connect('notify::text', (entry) => {
            settings.set_string('model-name', entry.get_text());
        });

        // API Key
        const apiKeyRow = new Adw.PasswordEntryRow({
            title: 'API Key',
            text: settings.get_string('api-key'),
        });
        apiGroup.add(apiKeyRow);
        apiKeyRow.connect('notify::text', (entry) => {
            settings.set_string('api-key', entry.get_text());
        });

        // --- Hotkey Settings Group ---
        const hotkeyGroup = new Adw.PreferencesGroup({
            title: 'Hotkey Configuration',
            description: 'Set your custom hotkeys. Use formats like <Control><Super>o',
        });
        page.add(hotkeyGroup);

        hotkeyGroup.add(this._createHotkeyRow(
            'Fix Grammar',
            'hotkey-fix',
            settings
        ));
        hotkeyGroup.add(this._createHotkeyRow(
            'Improve Text',
            'hotkey-improve',
            settings
        ));
        hotkeyGroup.add(this._createSwitchRow(
            'Show Panel Icon',
            'Display the extension icon in the GNOME top bar for mouse-driven actions.',
            'show-panel-icon',
            settings
        ));

        // --- NEW: Prompt Settings Group ---
        const promptGroup = new Adw.PreferencesGroup({
            title: 'Prompt Configuration',
            description: 'Set the system prompts for the AI.',
        });
        page.add(promptGroup);

        promptGroup.add(this._createPromptRow(
            'Fix Grammar Prompt',
            'prompt-fix-grammar',
            settings
        ));
        promptGroup.add(this._createPromptRow(
            'Improve Text Prompt',
            'prompt-improve-text',
            settings
        ));
    }

    // Helper for Hotkeys
    _createHotkeyRow(title, settingsKey, settings) {
        const row = new Adw.ActionRow({ title: title });

        const entry = new Gtk.Entry({
            text: settings.get_strv(settingsKey)[0] || '',
            valign: Gtk.Align.CENTER,
            hexpand: true,
        });

        entry.connect('changed', () => {
            const [key, mods] = Gtk.accelerator_parse(entry.get_text());
            if (Gtk.accelerator_valid(key, mods)) {
                entry.remove_css_class('error');
                settings.set_strv(settingsKey, [entry.get_text()]);
            } else {
                entry.add_css_class('error');
            }
        });

        row.add_suffix(entry);
        row.set_activatable_widget(entry);
        return row;
    }

    _createSwitchRow(title, subtitle, settingsKey, settings) {
        const row = new Adw.SwitchRow({
            title: title,
            subtitle: subtitle,
            active: settings.get_boolean(settingsKey),
        });

        row.connect('notify::active', switchRow => {
            settings.set_boolean(settingsKey, switchRow.get_active());
        });

        return row;
    }

    // NEW: Helper for Prompts (uses a multi-line TextView)
    _createPromptRow(title, settingsKey, settings) {
        const row = new Adw.ExpanderRow({
            title: title,
            show_enable_switch: false,
        });

        const buffer = new Gtk.TextBuffer();
        buffer.set_text(settings.get_string(settingsKey), -1);

        buffer.connect('changed', () => {
            const [start, end] = buffer.get_bounds();
            const text = buffer.get_text(start, end, false);
            settings.set_string(settingsKey, text);
        });

        const textView = new Gtk.TextView({
            buffer: buffer,
            wrap_mode: Gtk.WrapMode.WORD_CHAR,
            vexpand: true,
            hexpand: true,
            height_request: 100,
        });

        const scrolledWindow = new Gtk.ScrolledWindow({
            child: textView,
            has_frame: true,
            hscrollbar_policy: Gtk.PolicyType.NEVER,
	    vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
        });
        row.add_row(scrolledWindow);
        return row;
    }
}
