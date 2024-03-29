'use strict';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { State, Urgency } from 'resource:///org/gnome/shell/ui/messageTray.js';
import Meta from 'gi://Meta';
const LM = Main.layoutManager;
const MT = Main.messageTray;
const Display = global.display;

export default class FullscreenAvoider extends Extension {
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

	// To show notification on the second screen after moving the panel
	patch_updateState() {
		const patches = [
			{ from: 'Main.layoutManager.primaryMonitor.', to: 'Main.layoutManager.monitors[this._constraint.index].' },
		];

		const func = this._original_updateState.toString();
		MT._updateState = this.patch_function(func, patches, 'Main, State, Urgency', [Main, State, Urgency]);
	}

	// To grab a window from the second screen after moving the panel (fixes #5)
	patch_getDraggableWindowForPosition() {
		const patches = [
			{ from: 'metaWindow.is_on_primary_monitor()', to: 'true' },
		];

		const func = this._original_getDraggableWindowForPosition.toString();
		Main.panel._getDraggableWindowForPosition = this.patch_function(func, patches, 'Main, Meta', [Main, Meta]);
	}

	patch_function(func, patches, import_names='', import_refs=[]) {
		let args = func.substring(func.indexOf('(') + 1, func.indexOf(')')).split(', ');
		let body = func.substring(func.indexOf('{') + 1, func.lastIndexOf('}'));
		for (const { from, to } of patches) {
			body = body.replaceAll(from, to);
		}

		return new Function(import_names, `return function(${args}){ ${body} };`)(...import_refs);
	}

	enable() {
		this._original_updateState = MT._updateState;
		this._original_getDraggableWindowForPosition = Main.panel._getDraggableWindowForPosition;
		this._settings = this.getSettings();
		this._panel_monitor_index = LM.primaryIndex;
		this._on_fullscreen = Display.connect('in-fullscreen-changed', this.fullscreen_changed.bind(this));
		this.create_notifications_constraint(LM.primaryMonitor);
		this.patch_updateState();
		this.patch_getDraggableWindowForPosition();
		this.fullscreen_changed();
	}

	disable() {
		this.move_all(LM.primaryMonitor);
		Display.disconnect(this._on_fullscreen);
		MT._updateState = this._original_updateState;
		Main.panel._getDraggableWindowForPosition = this._original_getDraggableWindowForPosition;
		delete MT._constraint;

		delete this._original_updateState;
		delete this._original_getDraggableWindowForPosition;
		delete this._settings;
		delete this._panel_monitor_index;
		delete this._on_fullscreen;
	}
}
