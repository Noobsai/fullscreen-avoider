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
			this.fix_trayIconsReloaded();
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
			{ from: 'Main.', to: 'imports.ui.main.' },
			{ from: 'State.', to: 'imports.ui.messageTray.State.' },
			{ from: 'Urgency.', to: 'imports.ui.messageTray.Urgency.' },
		];
	
		const func = this._original_updateState.toString();
		MT._updateState = this.patch_function(func, patches);
	}
	
	// To grab a window from the second screen after moving the panel (fixes #5)
	patch_getDraggableWindowForPosition() {
		const patches = [
			{ from: 'metaWindow.is_on_primary_monitor()', to: 'true' },
			{ from: 'Main.', to: 'imports.ui.main.' },
			{ from: 'Meta.', to: 'imports.gi.Meta.' },
		];
	
		const func = this._original_getDraggableWindowForPosition.toString();
		Main.panel._getDraggableWindowForPosition = this.patch_function(func, patches);
	}
	
	patch_function(func, patches) {
		let args = func.substring(func.indexOf('(') + 1, func.indexOf(')')).split(', ');
		let body = func.substring(func.indexOf('{') + 1, func.lastIndexOf('}'));
		for (const { from, to } of patches) {
			body = body.replaceAll(from, to);
		}
	
		return new Function(args, body);
	}

	// Rebuild tray icons to fix the problem with a icon placement when the top panel has been moved
	fix_trayIconsReloaded() {
		const extension = Main.extensionManager.lookup('trayIconsReloaded@selfmade.pl');
		if (extension && extension.state === ExtensionUtils.ExtensionState.ENABLED) {
			if (!extension.stateObj._rebuild) {
				extension.stateObj._rebuild = function() {
					this.TrayIcons._destroy();
					this.TrayIcons = new extension.imports.extension.TrayIconsClass(this._settings);
					this._setTrayMargin();
					this._setIconSize();
					this._setTrayArea();
				};
			}
	
			extension.stateObj._rebuild();
		}
	}
	
	enable() {
		this._original_updateState = MT._updateState;
		this._original_getDraggableWindowForPosition = Main.panel._getDraggableWindowForPosition;
		this._settings = ExtensionUtils.getSettings();
		this._panel_monitor_index = LM.primaryIndex;
		this._on_fullscreen = Display.connect('in-fullscreen-changed', this.fullscreen_changed.bind(this));
		this.create_notifications_constraint(LM.primaryMonitor);
		this.patch_updateState();
		this.patch_getDraggableWindowForPosition();
	}
	
	disable() {
		Display.disconnect(this._on_fullscreen);
		MT._updateState = this._original_updateState;
		Main.panel._getDraggableWindowForPosition = this._original_getDraggableWindowForPosition;
		delete MT._constraint;
		this._settings.run_dispose();
	}
}

function init() {
	ExtensionUtils.initTranslations();
	return new Extension();
}