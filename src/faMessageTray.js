const { Clutter, Gio, GLib, GObject, Meta, Shell, St } = imports.gi;


const GnomeSession = imports.misc.gnomeSession;
const Layout = imports.ui.layout;
const Main = imports.ui.main;
const MessageTray = imports.ui.messageTray;


var FaMessageTray = GObject.registerClass({
    Signals: {
        'queue-changed': {},
        'source-added': { param_types: [MessageTray.Source.$gtype] },
        'source-removed': { param_types: [MessageTray.Source.$gtype] },
    },
}, class FaMessageTray extends St.Widget {
    _init() {
        super._init({
            visible: false,
            clip_to_allocation: true,
            layout_manager: new Clutter.BinLayout(),
        });

        this._presence = new GnomeSession.Presence((proxy, _error) => {
            this._onStatusChanged(proxy.status);
        });
        this._busy = false;
        this._bannerBlocked = false;
        this._presence.connectSignal('StatusChanged', (proxy, senderName, [status]) => {
            this._onStatusChanged(status);
        });

        this._monitorConstraint = new Layout.MonitorConstraint({ primary: true });
        Main.layoutManager.panelBox.bind_property('visible',
                                                  this._monitorConstraint, 'work-area',
                                                  GObject.BindingFlags.SYNC_CREATE);
        this.add_constraint(this._monitorConstraint);

        this._bannerBin = new St.Widget({ name: 'notification-container',
                                          reactive: true,
                                          track_hover: true,
                                          y_align: Clutter.ActorAlign.START,
                                          x_align: Clutter.ActorAlign.CENTER,
                                          y_expand: true,
                                          x_expand: true,
                                          layout_manager: new Clutter.BinLayout() });
        this._bannerBin.connect('key-release-event',
                                this._onNotificationKeyRelease.bind(this));
        this._bannerBin.connect('notify::hover',
                                this._onNotificationHoverChanged.bind(this));
        this.add_actor(this._bannerBin);

        this._notificationFocusGrabber = new MessageTray.FocusGrabber(this._bannerBin);
        this._notificationQueue = [];
        this._notification = null;
        this._banner = null;
        this._bannerClickedId = 0;

        this._userActiveWhileNotificationShown = false;

        this.idleMonitor = Meta.IdleMonitor.get_core();

        this._useLongerNotificationLeftTimeout = false;

        // pointerInNotification is sort of a misnomer -- it tracks whether
        // a message tray notification should expand. The value is
        // partially driven by the hover state of the notification, but has
        // a lot of complex state related to timeouts and the current
        // state of the pointer when a notification pops up.
        this._pointerInNotification = false;

        // This tracks this._bannerBin.hover and is used to fizzle
        // out non-changing hover notifications in onNotificationHoverChanged.
        this._notificationHovered = false;

        this._notificationState = MessageTray.State.HIDDEN;
        this._notificationTimeoutId = 0;
        this._notificationRemoved = false;

        Main.layoutManager.addChrome(this, { affectsInputRegion: false });
        Main.layoutManager.trackChrome(this._bannerBin, { affectsInputRegion: true });

        global.display.connect('in-fullscreen-changed', this._updateState.bind(this));

        Main.sessionMode.connect('updated', this._sessionUpdated.bind(this));

        Main.overview.connect('window-drag-begin',
                              this._onDragBegin.bind(this));
        Main.overview.connect('window-drag-cancelled',
                              this._onDragEnd.bind(this));
        Main.overview.connect('window-drag-end',
                              this._onDragEnd.bind(this));

        Main.overview.connect('item-drag-begin',
                              this._onDragBegin.bind(this));
        Main.overview.connect('item-drag-cancelled',
                              this._onDragEnd.bind(this));
        Main.overview.connect('item-drag-end',
                              this._onDragEnd.bind(this));

        Main.xdndHandler.connect('drag-begin',
                                 this._onDragBegin.bind(this));
        Main.xdndHandler.connect('drag-end',
                                 this._onDragEnd.bind(this));

        Main.wm.addKeybinding('focus-active-notification',
                              new Gio.Settings({ schema_id: MessageTray.SHELL_KEYBINDINGS_SCHEMA }),
                              Meta.KeyBindingFlags.NONE,
                              Shell.ActionMode.NORMAL |
                              Shell.ActionMode.OVERVIEW,
                              this._expandActiveNotification.bind(this));

        this._sources = new Map();

        this._sessionUpdated();
    }

    _sessionUpdated() {
        this._updateState();
    }

    _onDragBegin() {
        Shell.util_set_hidden_from_pick(this, true);
    }

    _onDragEnd() {
        Shell.util_set_hidden_from_pick(this, false);
    }

    get bannerAlignment() {
        return this._bannerBin.get_x_align();
    }

    set bannerAlignment(align) {
        this._bannerBin.set_x_align(align);
    }

    _onNotificationKeyRelease(actor, event) {
        if (event.get_key_symbol() == Clutter.KEY_Escape && event.get_state() == 0) {
            this._expireNotification();
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    _expireNotification() {
        this._notificationExpired = true;
        this._updateState();
    }

    get queueCount() {
        return this._notificationQueue.length;
    }

    set bannerBlocked(v) {
        if (this._bannerBlocked == v)
            return;
        this._bannerBlocked = v;
        this._updateState();
    }

    contains(source) {
        return this._sources.has(source);
    }

    add(source) {
        if (this.contains(source)) {
            log('Trying to re-add source %s'.format(source.title));
            return;
        }

        // Register that we got a notification for this source
        source.policy.store();

        source.policy.connect('notify::enable', () => {
            this._onSourceEnableChanged(source.policy, source);
        });
        source.policy.connect('notify', this._updateState.bind(this));
        this._onSourceEnableChanged(source.policy, source);
    }

    _addSource(source) {
        let obj = {
            showId: 0,
            destroyId: 0,
        };

        this._sources.set(source, obj);

        obj.showId = source.connect('notification-show', this._onNotificationShow.bind(this));
        obj.destroyId = source.connect('destroy', this._onSourceDestroy.bind(this));

        this.emit('source-added', source);
    }

    _removeSource(source) {
        let obj = this._sources.get(source);
        this._sources.delete(source);

        source.disconnect(obj.showId);
        source.disconnect(obj.destroyId);

        this.emit('source-removed', source);
    }

    getSources() {
        return [...this._sources.keys()];
    }

    _onSourceEnableChanged(policy, source) {
        let wasEnabled = this.contains(source);
        let shouldBeEnabled = policy.enable;

        if (wasEnabled != shouldBeEnabled) {
            if (shouldBeEnabled)
                this._addSource(source);
            else
                this._removeSource(source);
        }
    }

    _onSourceDestroy(source) {
        this._removeSource(source);
    }

    _onNotificationDestroy(notification) {
        this._notificationRemoved = this._notification === notification;

        if (this._notificationRemoved) {
            if (this._notificationState === MessageTray.State.SHOWN ||
                this._notificationState === MessageTray.State.SHOWING) {
                this._updateNotificationTimeout(0);
                this._updateState();
            }
        } else {
            const index = this._notificationQueue.indexOf(notification);
            if (index !== -1) {
                this._notificationQueue.splice(index, 1);
                this.emit('queue-changed');
            }
        }
    }

    _onNotificationShow(_source, notification) {
        if (this._notification == notification) {
            // If a notification that is being shown is updated, we update
            // how it is shown and extend the time until it auto-hides.
            // If a new notification is updated while it is being hidden,
            // we stop hiding it and show it again.
            this._updateShowingNotification();
        } else if (!this._notificationQueue.includes(notification)) {
            // If the queue is "full", we skip banner mode and just show a small
            // indicator in the panel; however do make an exception for CRITICAL
            // notifications, as only banner mode allows expansion.
            let bannerCount = this._notification ? 1 : 0;
            let full = this.queueCount + bannerCount >= MessageTray.MAX_NOTIFICATIONS_IN_QUEUE;
            if (!full || notification.urgency == MessageTray.Urgency.CRITICAL) {
                notification.connect('destroy',
                                     this._onNotificationDestroy.bind(this));
                this._notificationQueue.push(notification);
                this._notificationQueue.sort(
                    (n1, n2) => n2.urgency - n1.urgency);
                this.emit('queue-changed');
            }
        }
        this._updateState();
    }

    _resetNotificationLeftTimeout() {
        this._useLongerNotificationLeftTimeout = false;
        if (this._notificationLeftTimeoutId) {
            GLib.source_remove(this._notificationLeftTimeoutId);
            this._notificationLeftTimeoutId = 0;
            this._notificationLeftMouseX = -1;
            this._notificationLeftMouseY = -1;
        }
    }

    _onNotificationHoverChanged() {
        if (this._bannerBin.hover == this._notificationHovered)
            return;

        this._notificationHovered = this._bannerBin.hover;
        if (this._notificationHovered) {
            this._resetNotificationLeftTimeout();

            if (this._showNotificationMouseX >= 0) {
                let actorAtShowNotificationPosition =
                    global.stage.get_actor_at_pos(Clutter.PickMode.ALL, this._showNotificationMouseX, this._showNotificationMouseY);
                this._showNotificationMouseX = -1;
                this._showNotificationMouseY = -1;
                // Don't set this._pointerInNotification to true if the pointer was initially in the area where the notification
                // popped up. That way we will not be expanding notifications that happen to pop up over the pointer
                // automatically. Instead, the user is able to expand the notification by mousing away from it and then
                // mousing back in. Because this is an expected action, we set the boolean flag that indicates that a longer
                // timeout should be used before popping down the notification.
                if (this._bannerBin.contains(actorAtShowNotificationPosition)) {
                    this._useLongerNotificationLeftTimeout = true;
                    return;
                }
            }

            this._pointerInNotification = true;
            this._updateState();
        } else {
            // We record the position of the mouse the moment it leaves the tray. These coordinates are used in
            // this._onNotificationLeftTimeout() to determine if the mouse has moved far enough during the initial timeout for us
            // to consider that the user intended to leave the tray and therefore hide the tray. If the mouse is still
            // close to its previous position, we extend the timeout once.
            let [x, y] = global.get_pointer();
            this._notificationLeftMouseX = x;
            this._notificationLeftMouseY = y;

            // We wait just a little before hiding the message tray in case the user quickly moves the mouse back into it.
            // We wait for a longer period if the notification popped up where the mouse pointer was already positioned.
            // That gives the user more time to mouse away from the notification and mouse back in in order to expand it.
            let timeout = this._useLongerNotificationLeftTimeout ? MessageTray.LONGER_HIDE_TIMEOUT : MessageTray.HIDE_TIMEOUT;
            this._notificationLeftTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, timeout, this._onNotificationLeftTimeout.bind(this));
            GLib.Source.set_name_by_id(this._notificationLeftTimeoutId, '[gnome-shell] this._onNotificationLeftTimeout');
        }
    }

    _onStatusChanged(status) {
        if (status == GnomeSession.PresenceStatus.BUSY) {
            // remove notification and allow the summary to be closed now
            this._updateNotificationTimeout(0);
            this._busy = true;
        } else if (status != GnomeSession.PresenceStatus.IDLE) {
            // We preserve the previous value of this._busy if the status turns to IDLE
            // so that we don't start showing notifications queued during the BUSY state
            // as the screensaver gets activated.
            this._busy = false;
        }

        this._updateState();
    }

    _onNotificationLeftTimeout() {
        let [x, y] = global.get_pointer();
        // We extend the timeout once if the mouse moved no further than MessageTray.MOUSE_LEFT_ACTOR_THRESHOLD to either side.
        if (this._notificationLeftMouseX > -1 &&
            y < this._notificationLeftMouseY + MessageTray.MOUSE_LEFT_ACTOR_THRESHOLD &&
            y > this._notificationLeftMouseY - MessageTray.MOUSE_LEFT_ACTOR_THRESHOLD &&
            x < this._notificationLeftMouseX + MessageTray.MOUSE_LEFT_ACTOR_THRESHOLD &&
            x > this._notificationLeftMouseX - MessageTray.MOUSE_LEFT_ACTOR_THRESHOLD) {
            this._notificationLeftMouseX = -1;
            this._notificationLeftTimeoutId = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                MessageTray.LONGER_HIDE_TIMEOUT,
                this._onNotificationLeftTimeout.bind(this));
            GLib.Source.set_name_by_id(this._notificationLeftTimeoutId, '[gnome-shell] this._onNotificationLeftTimeout');
        } else {
            this._notificationLeftTimeoutId = 0;
            this._useLongerNotificationLeftTimeout = false;
            this._pointerInNotification = false;
            this._updateNotificationTimeout(0);
            this._updateState();
        }
        return GLib.SOURCE_REMOVE;
    }

    _escapeTray() {
        this._pointerInNotification = false;
        this._updateNotificationTimeout(0);
        this._updateState();
    }

    // All of the logic for what happens when occurs here; the various
    // event handlers merely update variables such as
    // 'this._pointerInNotification', 'this._traySummoned', etc, and
    // _updateState() figures out what (if anything) needs to be done
    // at the present time.
    _updateState() {
        if (!this._monitorConstraint || !Main.layoutManager.monitors) 
            return;

        let currentMonitor = null;
        if (this._monitorConstraint.primary) {
            currentMonitor =  Main.layoutManager.primaryMonitor;
        } else if (this._monitorConstraint.index > -1) {
            currentMonitor = Main.layoutManager.monitors[this._monitorConstraint.index];
        }

        let hasMonitor = currentMonitor != null;
        this.visible = !this._bannerBlocked && hasMonitor && this._banner != null;
        if (this._bannerBlocked || !hasMonitor)
            return;

        // If our state changes caused _updateState to be called,
        // just exit now to prevent reentrancy issues.
        if (this._updatingState)
            return;

        this._updatingState = true;

        // Filter out acknowledged notifications.
        let changed = false;
        this._notificationQueue = this._notificationQueue.filter(n => {
            changed = changed || n.acknowledged;
            return !n.acknowledged;
        });

        if (changed)
            this.emit('queue-changed');

        let hasNotifications = Main.sessionMode.hasNotifications;

        if (this._notificationState == MessageTray.State.HIDDEN) {
            let nextNotification = this._notificationQueue[0] || null;
            if (hasNotifications && nextNotification) {
                let limited = this._busy || currentMonitor.inFullscreen;
                let showNextNotification = !limited || nextNotification.forFeedback || nextNotification.urgency == MessageTray.Urgency.CRITICAL;
                if (showNextNotification)
                    this._showNotification();
            }
        } else if (this._notificationState == MessageTray.State.SHOWN) {
            let expired = (this._userActiveWhileNotificationShown &&
                           this._notificationTimeoutId == 0 &&
                           this._notification.urgency != MessageTray.Urgency.CRITICAL &&
                           !this._banner.focused &&
                           !this._pointerInNotification) || this._notificationExpired;
            let mustClose = this._notificationRemoved || !hasNotifications || expired;

            if (mustClose) {
                let animate = hasNotifications && !this._notificationRemoved;
                this._hideNotification(animate);
            } else if (this._pointerInNotification && !this._banner.expanded) {
                this._expandBanner(false);
            } else if (this._pointerInNotification) {
                this._ensureBannerFocused();
            }
        }

        this._updatingState = false;

        // Clean transient variables that are used to communicate actions
        // to updateState()
        this._notificationExpired = false;
    }

    _onIdleMonitorBecameActive() {
        this._userActiveWhileNotificationShown = true;
        this._updateNotificationTimeout(2000);
        this._updateState();
    }

    _showNotification() {
        this._notification = this._notificationQueue.shift();
        this.emit('queue-changed');

        this._userActiveWhileNotificationShown = this.idleMonitor.get_idletime() <= MessageTray.IDLE_TIME;
        if (!this._userActiveWhileNotificationShown) {
            // If the user isn't active, set up a watch to let us know
            // when the user becomes active.
            this.idleMonitor.add_user_active_watch(this._onIdleMonitorBecameActive.bind(this));
        }

        this._banner = this._notification.createBanner();
        this._bannerClickedId = this._banner.connect('done-displaying',
                                                     this._escapeTray.bind(this));
        this._bannerUnfocusedId = this._banner.connect('unfocused', () => {
            this._updateState();
        });

        this._bannerBin.add_actor(this._banner);

        this._bannerBin.opacity = 0;
        this._bannerBin.y = -this._banner.height;
        this.show();

        Meta.disable_unredirect_for_display(global.display);
        this._updateShowingNotification();

        let [x, y] = global.get_pointer();
        // We save the position of the mouse at the time when we started showing the notification
        // in order to determine if the notification popped up under it. We make that check if
        // the user starts moving the mouse and _onNotificationHoverChanged() gets called. We don't
        // expand the notification if it just happened to pop up under the mouse unless the user
        // explicitly mouses away from it and then mouses back in.
        this._showNotificationMouseX = x;
        this._showNotificationMouseY = y;
        // We save the coordinates of the mouse at the time when we started showing the notification
        // and then we update it in _notificationTimeout(). We don't pop down the notification if
        // the mouse is moving towards it or within it.
        this._lastSeenMouseX = x;
        this._lastSeenMouseY = y;

        this._resetNotificationLeftTimeout();
    }

    _updateShowingNotification() {
        this._notification.acknowledged = true;
        this._notification.playSound();

        // We auto-expand notifications with CRITICAL urgency, or for which the relevant setting
        // is on in the control center.
        if (this._notification.urgency == MessageTray.Urgency.CRITICAL ||
            this._notification.source.policy.forceExpanded)
            this._expandBanner(true);

        // We tween all notifications to full opacity. This ensures that both new notifications and
        // notifications that might have been in the process of hiding get full opacity.
        //
        // We tween any notification showing in the banner mode to the appropriate height
        // (which is banner height or expanded height, depending on the notification state)
        // This ensures that both new notifications and notifications in the banner mode that might
        // have been in the process of hiding are shown with the correct height.
        //
        // We use this._showNotificationCompleted() onComplete callback to extend the time the updated
        // notification is being shown.

        this._notificationState = MessageTray.State.SHOWING;
        this._bannerBin.remove_all_transitions();
        this._bannerBin.ease({
            opacity: 255,
            duration: MessageTray.ANIMATION_TIME,
            mode: Clutter.AnimationMode.LINEAR,
        });
        this._bannerBin.ease({
            y: 0,
            duration: MessageTray.ANIMATION_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_BACK,
            onComplete: () => {
                this._notificationState = MessageTray.State.SHOWN;
                this._showNotificationCompleted();
                this._updateState();
            },
        });
    }

    _showNotificationCompleted() {
        if (this._notification.urgency != MessageTray.Urgency.CRITICAL)
            this._updateNotificationTimeout(MessageTray.NOTIFICATION_TIMEOUT);
    }

    _updateNotificationTimeout(timeout) {
        if (this._notificationTimeoutId) {
            GLib.source_remove(this._notificationTimeoutId);
            this._notificationTimeoutId = 0;
        }
        if (timeout > 0) {
            this._notificationTimeoutId =
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, timeout,
                    this._notificationTimeout.bind(this));
            GLib.Source.set_name_by_id(this._notificationTimeoutId, '[gnome-shell] this._notificationTimeout');
        }
    }

    _notificationTimeout() {
        let [x, y] = global.get_pointer();
        if (y < this._lastSeenMouseY - 10 && !this._notificationHovered) {
            // The mouse is moving towards the notification, so don't
            // hide it yet. (We just create a new timeout (and destroy
            // the old one) each time because the bookkeeping is
            // simpler.)
            this._updateNotificationTimeout(1000);
        } else if (this._useLongerNotificationLeftTimeout && !this._notificationLeftTimeoutId &&
                  (x != this._lastSeenMouseX || y != this._lastSeenMouseY)) {
            // Refresh the timeout if the notification originally
            // popped up under the pointer, and the pointer is hovering
            // inside it.
            this._updateNotificationTimeout(1000);
        } else {
            this._notificationTimeoutId = 0;
            this._updateState();
        }

        this._lastSeenMouseX = x;
        this._lastSeenMouseY = y;
        return GLib.SOURCE_REMOVE;
    }

    _hideNotification(animate) {
        this._notificationFocusGrabber.ungrabFocus();

        if (this._bannerClickedId) {
            this._banner.disconnect(this._bannerClickedId);
            this._bannerClickedId = 0;
        }
        if (this._bannerUnfocusedId) {
            this._banner.disconnect(this._bannerUnfocusedId);
            this._bannerUnfocusedId = 0;
        }

        this._resetNotificationLeftTimeout();
        this._bannerBin.remove_all_transitions();

        if (animate) {
            this._notificationState = MessageTray.State.HIDING;
            this._bannerBin.ease({
                opacity: 0,
                duration: MessageTray.ANIMATION_TIME,
                mode: Clutter.AnimationMode.EASE_OUT_BACK,
            });
            this._bannerBin.ease({
                y: -this._bannerBin.height,
                duration: MessageTray.ANIMATION_TIME,
                mode: Clutter.AnimationMode.EASE_OUT_BACK,
                onComplete: () => {
                    this._notificationState = MessageTray.State.HIDDEN;
                    this._hideNotificationCompleted();
                    this._updateState();
                },
            });
        } else {
            this._bannerBin.y = -this._bannerBin.height;
            this._bannerBin.opacity = 0;
            this._notificationState = MessageTray.State.HIDDEN;
            this._hideNotificationCompleted();
        }
    }

    _hideNotificationCompleted() {
        let notification = this._notification;
        this._notification = null;
        if (!this._notificationRemoved && notification.isTransient)
            notification.destroy(MessageTray.NotificationDestroyedReason.EXPIRED);

        this._pointerInNotification = false;
        this._notificationRemoved = false;
        Meta.enable_unredirect_for_display(global.display);

        this._banner.destroy();
        this._banner = null;
        this.hide();
    }

    _expandActiveNotification() {
        if (!this._banner)
            return;

        this._expandBanner(false);
    }

    _expandBanner(autoExpanding) {
        // Don't animate changes in notifications that are auto-expanding.
        this._banner.expand(!autoExpanding);

        // Don't focus notifications that are auto-expanding.
        if (!autoExpanding)
            this._ensureBannerFocused();
    }

    _ensureBannerFocused() {
        this._notificationFocusGrabber.grabFocus();
    }
});