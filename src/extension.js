'use strict';

const Main = imports.ui.main;
const LM = Main.layoutManager;
const Layout = imports.ui.layout;
const Display = global.display;

const ExtensionUtils = imports.misc.extensionUtils;

let _settings = null;
let _on_fullscreen;

function get_unfullscreen_monitor() {
	for (const monitor of LM.monitors) {
		if (!monitor.inFullscreen) {
			return monitor;
		}
	}
}

function fullscreen_changed() {
	if (LM.monitors.length < 2) {
		return;
	}

	let primary_monitor = LM.primaryMonitor;
	let unfullscreen_monitor = get_unfullscreen_monitor();
	if (!unfullscreen_monitor) {
		return;
	}

	if (primary_monitor.inFullscreen) {
		move_panel(unfullscreen_monitor);
		move_hotcorners(unfullscreen_monitor);
	} else {
		move_panel(primary_monitor);
		move_hotcorners(primary_monitor);
	}
}

function move_panel(monitor) {
	LM.panelBox.set_position(monitor.x, monitor.y);
	LM.panelBox.set_size(monitor.width, -1);
	LM.panelBox.visible = true;
}

function move_hotcorners(monitor) {
	if (!_settings.get_boolean('move-hot-corners')) {
		return;
	}

	let oldIndex = LM.primaryIndex;
	LM.primaryIndex = monitor.index;
	LM._updateHotCorners();
	LM.primaryIndex = oldIndex;
}

function enable() {
	_settings = ExtensionUtils.getSettings();
	_on_fullscreen = Display.connect('in-fullscreen-changed', fullscreen_changed);
}

function disable() {
	Display.disconnect(_on_fullscreen);
	_settings.run_dispose();
}

function init() {
	ExtensionUtils.initTranslations();
}
