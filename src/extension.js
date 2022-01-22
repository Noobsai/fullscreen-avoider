'use strict';

const GObject = imports.gi.GObject;
const Layout = imports.ui.layout;
const Main = imports.ui.main;
const LM = Main.layoutManager;
const MT = Main.messageTray;
const Display = global.display;
const ExtensionUtils = imports.misc.extensionUtils;

class Extension {
	get_unfullscreen_monitor() {
		for (const monitor of LM.monitors) {
			if (!monitor.inFullscreen) {
				return monitor;
			}
		}
	}
	
	fullscreen_changed() {
		if (LM.monitors.length < 2) {
			return;
		}
	
		const primary_monitor = LM.primaryMonitor;
		const unfullscreen_monitor = this.get_unfullscreen_monitor();
		if (!unfullscreen_monitor) {
			return;
		}
	
		if (primary_monitor.inFullscreen) {
			this.move_all(unfullscreen_monitor);
		} else {
			this.move_all(primary_monitor);
		}
	}
	
	move_all(monitor) {
		if (this._panel_monitor_index !== monitor.index) {
			this._panel_monitor_index = monitor.index;
			this.move_panel(monitor);
			this.move_hotcorners(monitor);
			this.move_notifications(monitor);
		}
	}
	
	move_panel(monitor) {
		LM.panelBox.set_position(monitor.x, monitor.y);
		LM.panelBox.set_size(monitor.width, -1);
		LM.panelBox.visible = true;
	}
	
	move_hotcorners(monitor) {
		if (!this._settings.get_boolean('move-hot-corners')) {
			return;
		}
	
		const old_index = LM.primaryIndex;
		LM.primaryIndex = monitor.index;
		LM._updateHotCorners();
		LM.primaryIndex = old_index;
	}
	
	move_notifications(monitor) {
		if (!this._settings.get_boolean('move-notifications')) {
			return;
		}
	
		MT._constraint.index = monitor.index;
	}
	
	create_notifications_constraint(monitor) {
		const constraint = MT.get_constraints()[0];
		if (constraint) {
			constraint.index = monitor.index;
			MT._constraint = constraint;
		}
	}

	patch_updateState() {
		const patches = [
			{ from: 'Main.layoutManager.primaryMonitor.', to: 'Main.layoutManager.monitors[this._constraint.index].' },
		];

		const { State, Urgency } = imports.ui.messageTray; // used in _updateState(), do not remove

		let func = this._original_updateState.toString();
		for (const { from, to } of patches) {
			func = func.replaceAll(from, to);
		}
	
		func = func.replace('_updateState(', 'function(');
		eval(`MT._updateState = ${func}`);
	}
	
	enable() {
		this._original_updateState = MT._updateState;
		this._settings = ExtensionUtils.getSettings();
		this._panel_monitor_index = LM.primaryIndex;
		this._on_fullscreen = Display.connect('in-fullscreen-changed', this.fullscreen_changed.bind(this));
		this.create_notifications_constraint(LM.primaryMonitor);
		this.patch_updateState();
	}
	
	disable() {
		Display.disconnect(this._on_fullscreen);
		MT._updateState = this._original_updateState;
		delete MT._constraint;
		this._settings.run_dispose();
	}
}

function init() {
	ExtensionUtils.initTranslations();
    return new Extension();
}