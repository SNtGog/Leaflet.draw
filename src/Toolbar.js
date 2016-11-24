L.Toolbar = L.Class.extend({
	includes: [L.Mixin.Events],

	initialize: function (options) {
		L.setOptions(this, options);

		this._modes = {};
		this._actionButtons = [];
		this._activeMode = null;
	},

	enabled: function () {
		return this._activeMode !== null;
	},

	disable: function () {
		if (!this.enabled()) { return; }

		this._activeMode.handler.disable();
	},

	addToolbar: function (map) {
		var container = L.DomUtil.create('div', 'leaflet-draw-section'),
			buttonIndex = 0,
			buttonClassPrefix = this._toolbarClass || '',
			modeHandlers = this.getModeHandlers(map),
			i;

		this._toolbarContainer = L.DomUtil.create('div', 'leaflet-draw-toolbar leaflet-bar');
		this._map = map;

		for (i = 0; i < modeHandlers.length; i++) {
			if (modeHandlers[i].enabled) {
				this._initModeHandler(
					modeHandlers[i].handler,
					this._toolbarContainer,
					buttonIndex++,
					buttonClassPrefix,
					modeHandlers[i].title
				);
			}
		}

		// if no buttons were added, do not add the toolbar
		if (!buttonIndex) {
			return;
		}

		// Save button index of the last button, -1 as we would have ++ after the last button
		this._lastButtonIndex = --buttonIndex;

		// Create empty actions part of the toolbar
		this._actionsContainer = L.DomUtil.create('ul', 'leaflet-draw-actions');

		// Add draw and cancel containers to the control container
		container.appendChild(this._toolbarContainer);
		container.appendChild(this._actionsContainer);

		return container;
	},

	removeToolbar: function () {
		// Dispose each handler
		var i = 0;
		for (var handlerId in this._modes) {
			if (this._modes.hasOwnProperty(handlerId)) {
				// Unbind handler button
				this._disposeButton(
					this._modes[handlerId].button,
					this._modes[handlerId].handler.enable,
					this._modes[handlerId].handler
				);

                var submenu = this._modes[handlerId].submenu;
				if (submenu && submenu.buttons.length) {
				    for (i = 0; i < submenu.buttons.length; i++) {
				        this._disposeButton(
                            submenu.buttons[i].el,
                            submenu.buttons[i].mode.callback,
                            this._modes[handlerId].handler
                        );
				    }

				}

				// Make sure is disabled
				this._modes[handlerId].handler.disable();

				// Unbind handler
				this._modes[handlerId].handler
					.off('enabled', this._handlerActivated, this)
					.off('disabled', this._handlerDeactivated, this);
			}
		}
		this._modes = {};

		// Dispose the actions toolbar
		for (i = 0, l = this._actionButtons.length; i < l; i++) {
			this._disposeButton(
				this._actionButtons[i].button,
				this._actionButtons[i].callback,
				this
			);
		}
		this._actionButtons = [];
		this._actionsContainer = null;
	},

	_initModeHandler: function (handler, container, buttonIndex, classNamePredix, buttonTitle) {
		var type = handler.type;

		this._modes[type] = {};

		this._modes[type].handler = handler;

		var button = this._createButton({
			type: type,
			title: buttonTitle,
			className: classNamePredix + '-' + type,
			container: container,
			callback: this._modes[type].handler.enable,
			context: this._modes[type].handler
		}, this._modes[type].handler.modes);

		this._modes[type].button = button.button;
		this._modes[type].submenu = button.submenu;

		this._modes[type].buttonIndex = buttonIndex;

		this._modes[type].handler
			.on('enabled', this._handlerActivated, this)
			.on('disabled', this._handlerDeactivated, this);
	},

	_createButton: function (options, handlerModes) {

		var button = L.DomUtil.create(options.tagName || 'div', options.className || '', options.container),
		    submenu;

		if (options.text) {
			button.innerHTML = options.text;
		}

		if (options.title) {
			button.title = options.title;
		}

		if (options.tagName === 'a') {
		    button.href = '#';
		}

		L.DomEvent
			.on(button, 'click', L.DomEvent.stopPropagation)
			.on(button, 'mousedown', L.DomEvent.stopPropagation)
			.on(button, 'dblclick', L.DomEvent.stopPropagation)
			.on(button, 'click', L.DomEvent.preventDefault)
			.on(button, 'click', options.callback, options.context)
			.on(button, 'contextmenu', L.DomEvent.stopPropagation);

	    if (!handlerModes) {
	      return {button: button, submenu: null};
	    }

	    submenu = {
	      el: L.DomUtil.create('div', 'leaflet-bar leaflet-draw-toolbar-submenu'),
	      buttons: []
	    }
	    button.appendChild(submenu.el);

	    for (var modeId in handlerModes) {
            var mode = handlerModes[modeId],
                newbutton = {
                  el: this._createSubmenuButton(submenu, mode, options),
                  mode: mode,
                };

            submenu.buttons.push(newbutton);
            submenu.el.appendChild(newbutton.el);

            options.context
              .on('enabled:'+mode.name, this._handlerModeActivated, this)
              .on('disabled:'+mode.name, this._handlerModeDeactivated, this);
	    }

		return {
		  button: button,
		  submenu: submenu
		};
	},

	_createSubmenuButton: function(submenu, mode, options) {
	    var modeName = mode.name || '',
	        name = options.className ? options.className + '-' + modeName : modeName,
	        button = L.DomUtil.create('div', name || '', options.container);

	    if (mode.title) {
			button.title = mode.title;
		}

        L.DomEvent
            .on(button, 'click', L.DomEvent.stopPropagation)
            .on(button, 'mousedown', L.DomEvent.stopPropagation)
            .on(button, 'dblclick', L.DomEvent.stopPropagation)
            .on(button, 'click', L.DomEvent.preventDefault)
            .on(button, 'click', mode.callback, options.context)
            .on(button, 'contextmenu', L.DomEvent.stopPropagation)
            .on(button, 'mousemove', this._onSubmenuMousemove, {mode: mode, context: options.context});

        return button;
	},

	_disposeButton: function (button, callback) {
		L.DomEvent
			.off(button, 'click', L.DomEvent.stopPropagation)
			.off(button, 'mousedown', L.DomEvent.stopPropagation)
			.off(button, 'dblclick', L.DomEvent.stopPropagation)
			.off(button, 'click', L.DomEvent.preventDefault)
			.off(button, 'click', callback)
			.off(button, 'contextmenu', L.DomEvent.stopPropagation)
			.off(button, 'mousemove', this._onSubmenuMousemove);
	},

	_onSubmenuMousemove: function(e) {
	  e.stopPropagation();
	  if (this.context._tooltip) {
	    this.context._tooltip.updateContent({
            text: this.mode.tooltip || ''
        });
        var point = this.context._map.mouseEventToLayerPoint(e);
        this.context._tooltip._updatePosition(point);
	  }
	},

	_handlerActivated: function (e) {
		// Disable active mode (if present)
		this.disable();

		// Cache new active feature
		this._activeMode = this._modes[e.handler];

		L.DomUtil.addClass(this._activeMode.button, 'leaflet-draw-toolbar-button-enabled');

		this._showActionsToolbar();

		this.fire('enable');
	},

	_handlerDeactivated: function () {
		this._hideActionsToolbar();

		L.DomUtil.removeClass(this._activeMode.button, 'leaflet-draw-toolbar-button-enabled');

		this._activeMode = null;

		this.fire('disable');
	},

	_handlerModeActivated: function(mode) {
        for (var handlerId in this._modes) {
            if (!this._modes.hasOwnProperty(handlerId)) {
              return;
            }

            var submenu = this._modes[handlerId].submenu;
            if (!submenu || !submenu.buttons.length) {
              return;
            }

            for (i = 0; i < submenu.buttons.length; i++) {
                var button = submenu.buttons[i];
                if (button.mode.callback === mode.callback) {
                  L.DomUtil.addClass(button.el, 'leaflet-draw-toolbar-button-enabled');
                }
                else {
                  L.DomUtil.removeClass(button.el, 'leaflet-draw-toolbar-button-enabled');
                }
            }
        }
	},

	_handlerModeDeactivated: function(mode) {
        for (var handlerId in this._modes) {
            if (!this._modes.hasOwnProperty(handlerId)) {
              return;
            }

            var submenu = this._modes[handlerId].submenu;
            if (!submenu || !submenu.buttons.length) {
              return;
            }

            for (i = 0; i < submenu.buttons.length; i++) {
                var button = submenu.buttons[i];
                if (button.mode.callback === mode.callback) {
                  L.DomUtil.removeClass(button.el, 'leaflet-draw-toolbar-button-enabled');
                }
            }
        }
	},

	_createActions: function (handler) {
		var container = this._actionsContainer,
			buttons = this.getActions(handler),
			l = buttons.length,
			li, di, dl, button;

		// Dispose the actions toolbar (todo: dispose only not used buttons)
		for (di = 0, dl = this._actionButtons.length; di < dl; di++) {
			this._disposeButton(this._actionButtons[di].button, this._actionButtons[di].callback);
		}
		this._actionButtons = [];

		// Remove all old buttons
		while (container.firstChild) {
			container.removeChild(container.firstChild);
		}

		for (var i = 0; i < l; i++) {
			if ('enabled' in buttons[i] && !buttons[i].enabled) {
				continue;
			}

			li = L.DomUtil.create('li', '', container);

			button = this._createButton({
			    tagName: 'a',
				title: buttons[i].title,
				text: buttons[i].text,
				container: li,
				callback: buttons[i].callback,
				context: buttons[i].context
			});

			this._actionButtons.push({
				button: button,
				callback: buttons[i].callback
			});
		}
	},

	_showActionsToolbar: function () {
		var buttonIndex = this._activeMode.buttonIndex,
			lastButtonIndex = this._lastButtonIndex,
			toolbarPosition = this._activeMode.button.offsetTop - 1;

		// Recreate action buttons on every click
		this._createActions(this._activeMode.handler);

		// Correctly position the cancel button
		this._actionsContainer.style.top = toolbarPosition + 'px';

		if (buttonIndex === 0) {
			L.DomUtil.addClass(this._toolbarContainer, 'leaflet-draw-toolbar-notop');
			L.DomUtil.addClass(this._actionsContainer, 'leaflet-draw-actions-top');
		}

		if (buttonIndex === lastButtonIndex) {
			L.DomUtil.addClass(this._toolbarContainer, 'leaflet-draw-toolbar-nobottom');
			L.DomUtil.addClass(this._actionsContainer, 'leaflet-draw-actions-bottom');
		}

		this._actionsContainer.style.display = 'block';
	},

	_hideActionsToolbar: function () {
		this._actionsContainer.style.display = 'none';

		L.DomUtil.removeClass(this._toolbarContainer, 'leaflet-draw-toolbar-notop');
		L.DomUtil.removeClass(this._toolbarContainer, 'leaflet-draw-toolbar-nobottom');
		L.DomUtil.removeClass(this._actionsContainer, 'leaflet-draw-actions-top');
		L.DomUtil.removeClass(this._actionsContainer, 'leaflet-draw-actions-bottom');
	}
});
