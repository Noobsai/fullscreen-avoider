'use strict';

const GObject = imports.gi.GObject;
const Main = imports.ui.main;
const LM = Main.layoutManager;
const Layout = imports.ui.layout;
const Display = global.display;

const ExtensionUtils = imports.misc.extensionUtils;

const Extension = ExtensionUtils.getCurrentExtension();
const FaMessageTray = Extension.imports.faMessageTray;

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
		move_notifications(unfullscreen_monitor);
	} else {
		move_panel(primary_monitor);
		move_hotcorners(primary_monitor);
		move_notifications(primary_monitor);
	}
}

function move_panel(monitor) {
	LM.panelBox.x = monitor.x;
	LM.panelBox.y = monitor.y;
	LM.panelBox.width = monitor.width;
	LM.panelBox.visible = true;
}

function move_notifications(monitor) {
	//Main.messageTray.clear_constraints();

	//let constraint = new Layout.MonitorConstraint({ 'index': monitor.index });
	//LM.panelBox.bind_property('visible', constraint, 'work-area', GObject.BindingFlags.SYNC_CREATE);
	//Main.messageTray.add_constraint(constraint);
	Main.messageTray._monitorConstraint.index = monitor.index;
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

let _originalMT;
function enable() {
	_settings = ExtensionUtils.getSettings();
	_on_fullscreen = Display.connect('in-fullscreen-changed', fullscreen_changed);
	_originalMT = Main.messageTray;
	Main.messageTray = new FaMessageTray.FaMessageTray();
}

function disable() {
	Display.disconnect(_on_fullscreen);
	_settings.run_dispose();
	Main.messageTray = _originalMT;
}

function init() {
	ExtensionUtils.initTranslations();
}
