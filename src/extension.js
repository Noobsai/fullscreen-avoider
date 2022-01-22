'use strict';

const GObject = imports.gi.GObject;
const Layout = imports.ui.layout;
const Main = imports.ui.main;
const LM = Main.layoutManager;
const MT = Main.messageTray;
const Display = global.display;
const { State, Urgency } = imports.ui.messageTray; // used in _updateState()

const ExtensionUtils = imports.misc.extensionUtils;

const _original_updateState = MT._updateState;
let _panel_monitor_index = null;
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

	const primary_monitor = LM.primaryMonitor;
	const unfullscreen_monitor = get_unfullscreen_monitor();
	if (!unfullscreen_monitor) {
		return;
	}

	if (primary_monitor.inFullscreen) {
		move_all(unfullscreen_monitor);
	} else {
		move_all(primary_monitor);
	}
}

function move_all(monitor) {
	if (_panel_monitor_index !== monitor.index) {
		_panel_monitor_index = monitor.index;
		move_panel(monitor);
		move_hotcorners(monitor);
		move_notifications(monitor);
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

	const old_index = LM.primaryIndex;
	LM.primaryIndex = monitor.index;
	LM._updateHotCorners();
	LM.primaryIndex = old_index;
}

function move_notifications(monitor) {
	if (!_settings.get_boolean('move-notifications')) {
		return;
	}

	MT._constraint.index = monitor.index;
}

function create_notifications_constraint(monitor) {
	MT.clear_constraints();
	const constraint = new Layout.MonitorConstraint({ 'index': monitor.index });
	LM.panelBox.bind_property('visible', constraint, 'work-area', GObject.BindingFlags.SYNC_CREATE);
	MT.add_constraint(constraint);
	MT._constraint = constraint;
}

function enable() {
	_settings = ExtensionUtils.getSettings();
	_panel_monitor_index = LM.primaryIndex;
	_on_fullscreen = Display.connect('in-fullscreen-changed', fullscreen_changed);
	create_notifications_constraint(LM.primaryMonitor);
	patch_updateState();
}

function disable() {
	Display.disconnect(_on_fullscreen);
	MT._updateState = _original_updateState;
	delete MT._constraint;
	_settings.run_dispose();
}

function init() {
	ExtensionUtils.initTranslations();
}

const patches = [
	{ from: 'Main.layoutManager.primaryMonitor.', to: 'Main.layoutManager.monitors[this._constraint.index].' },
];

function patch_updateState() {
    let func = _original_updateState.toString();
	for (const { from, to } of patches) {
		func = func.replaceAll(from, to);
	}

    func = func.replace('_updateState(', 'function(');
	eval(`MT._updateState = ${func}`);
}