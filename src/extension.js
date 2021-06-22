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
		if (!Display.get_monitor_in_fullscreen(monitor.index)) {
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

	if (Display.get_monitor_in_fullscreen(primary_monitor.index)) {
		move_panel(unfullscreen_monitor);
		move_hotcorners(unfullscreen_monitor);
	} else {
		move_panel(primary_monitor);
		move_hotcorners(primary_monitor);
	}
}

function move_panel(monitor) {
	LM.panelBox.x = monitor.x;
	LM.panelBox.width = monitor.width;
	LM.panelBox.visible = true;
}

function move_hotcorners(monitor) {
	if (!_settings.get_boolean('move-hot-corners')) {
		return;
	}

	LM.hotCorners.forEach((corner) => {
		if (corner)
			corner.destroy();
	});
	LM.hotCorners = [];

	if (!LM._interfaceSettings.get_boolean('enable-hot-corners')) {
		LM.emit('hot-corners-changed');
		return;
	}

	let size = LM.panelBox.height;

	let corner = new Layout.HotCorner(LM, monitor, monitor.x, monitor.y);
	corner.setBarrierSize(size);
	LM.hotCorners.push(corner);

	LM.emit('hot-corners-changed');
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