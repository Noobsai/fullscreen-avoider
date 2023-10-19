'use strict';

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class FullscreenAvoiderPreferences extends ExtensionPreferences {
	fillPreferencesWindow(window) {
		let settings = this.getSettings();
		const page = Adw.PreferencesPage.new();

		const group = Adw.PreferencesGroup.new();
        group.set_title(_("Settings"));

        page.add(group);

		group.add(buildSwitcher(settings, 'move-hot-corners', _('Move Hot Corners:')));
		group.add(buildSwitcher(settings, 'move-notifications', _('Move Notifications:')));

		window.add(page)
	}
}


function buildSwitcher(settings, key, labeltext) {
	let adwrow = new Adw.ActionRow({
		title: labeltext,
	});
	const switcher = new Gtk.Switch({
		active: settings.get_boolean(key),
		valign: Gtk.Align.CENTER,
	});

	settings.bind(key, switcher, 'active', Gio.SettingsBindFlags.DEFAULT);

	adwrow.add_suffix(switcher);
	adwrow.activatable_widget = switcher;

	return adwrow;
}
