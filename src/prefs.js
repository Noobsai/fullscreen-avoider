'use strict';

const Gio = imports.gi.Gio;
const GObject = imports.gi.GObject;
const Gtk = imports.gi.Gtk;

const Gettext = imports.gettext.domain('gnome-shell-extensions');
const _ = Gettext.gettext;

const ExtensionUtils = imports.misc.extensionUtils;

function init() {
	ExtensionUtils.initTranslations();
}

const FullscreenAvoiderSettings = GObject.registerClass(
class FullscreenAvoiderSettings extends Gtk.Grid {
    _init(params) {
        super._init(params);

        this.margin_top = 24;
        this.row_spacing = 6;
        this.column_spacing = 6;
        this.orientation = Gtk.Orientation.VERTICAL;
		this.halign = Gtk.Align.CENTER;
		this.valign = Gtk.Align.START;

        this._settings = ExtensionUtils.getSettings();

        this.move_hot_corners_label = new Gtk.Label({label: _("Move Hot Corners:"), halign: Gtk.Align.START});
        this.move_hot_corners_control = new Gtk.Switch();
		this.attach(this.move_hot_corners_label, 1, 1, 1, 1);
        this.attach(this.move_hot_corners_control, 2, 1, 1, 1);
        this._settings.bind('move-hot-corners', this.move_hot_corners_control, 'active', Gio.SettingsBindFlags.DEFAULT);
    }
});

function buildPrefsWidget() {
    let widget = new FullscreenAvoiderSettings();
    widget.show_all();

    return widget;
}