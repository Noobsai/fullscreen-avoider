'use strict';

import { Extension, InjectionManager } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
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

	patch_updateState() {
		this._injections.overrideMethod(Object.getPrototypeOf(MT), '_updateState', original => function (...parameters) {
			const primaryMonitor = LM.primaryMonitor;
			const monitor = this._constraint?.primary
				? primaryMonitor
				: LM.monitors[this._constraint?.index] ?? primaryMonitor;
			if (!primaryMonitor || monitor === primaryMonitor)
				return original.apply(this, parameters);

			const descriptor = Object.getOwnPropertyDescriptor(primaryMonitor, 'inFullscreen');
			Object.defineProperty(primaryMonitor, 'inFullscreen', {
				value: monitor.inFullscreen,
				configurable: true,
			});
			try {
				return original.apply(this, parameters);
			} finally {
				if (descriptor)
					Object.defineProperty(primaryMonitor, 'inFullscreen', descriptor);
				else
					delete primaryMonitor.inFullscreen;
			}
		});
	}

	patch_getDraggableWindowForPosition() {
		this._injections.overrideMethod(Main.panel, '_getDraggableWindowForPosition', () => function (stageX) {
			const monitor = LM.findMonitorForActor(LM.panelBox) ?? LM.primaryMonitor;
			const windows = global.workspace_manager.get_active_workspace().list_windows();
			return global.display.sort_windows_by_stacking(windows).reverse().find(window => {
				const rectangle = window.get_frame_rect();
				return window.get_monitor() === monitor?.index &&
					window.showing_on_its_workspace() &&
					window.get_window_type() !== Meta.WindowType.DESKTOP &&
					window.maximized_vertically &&
					stageX > rectangle.x && stageX < rectangle.x + rectangle.width;
			});
		});
	}

	enable() {
		this._injections = new InjectionManager();
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
		this._injections.clear();
		delete MT._constraint;

		delete this._injections;
		delete this._settings;
		delete this._panel_monitor_index;
		delete this._on_fullscreen;
	}
}
