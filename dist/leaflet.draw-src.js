/*
	Leaflet.draw, a plugin that adds drawing and editing tools to Leaflet powered maps.
	(c) 2012-2016, Jacob Toye, Smartrak, Leaflet

	https://github.com/Leaflet/Leaflet.draw
	http://leafletjs.com
*/
(function (window, document, undefined) {/*
 * Leaflet.draw assumes that you have already included the Leaflet library.
 */

L.drawVersion = '0.3.0-dev';

L.drawLocal = {
    draw: {
        toolbar: {
            // #TODO: this should be reorganized where actions are nested in actions
            // ex: actions.undo  or actions.cancel
            actions: {
                title: 'Cancel drawing',
                text: 'Cancel'
            },
            finish: {
                title: 'Finish drawing',
                text: 'Finish'
            },
            undo: {
                title: 'Delete last point drawn',
                text: 'Delete last point'
            },
            buttons: {
                polyline: 'Draw a polyline',
                polygon: 'Draw a polygon',
                rectangle: 'Draw a rectangle',
                circle: 'Draw a circle',
                marker: 'Draw a marker'
            }
        },
        handlers: {
            circle: {
                tooltip: {
                    start: 'Click and drag to draw circle.'
                },
                radius: 'Radius'
            },
            marker: {
                tooltip: {
                    start: 'Click map to place marker.'
                }
            },
            polygon: {
                tooltip: {
                    start: 'Click to start drawing shape.',
                    cont: 'Click to continue drawing shape.',
                    end: 'Click first point to close this shape.'
                }
            },
            polyline: {
                error: '<strong>Error:</strong> shape edges cannot cross!',
                tooltip: {
                    start: 'Click to start drawing line.',
                    cont: 'Click to continue drawing line.',
                    end: 'Click last point to finish line.'
                }
            },
            rectangle: {
                tooltip: {
                    start: 'Click and drag to draw rectangle.'
                }
            },
            simpleshape: {
                tooltip: {
                    end: 'Release mouse to finish drawing.'
                }
            }
        }
    },
    edit: {
        toolbar: {
            actions: {
                save: {
                    title: 'Save changes.',
                    text: 'Save'
                },
                cancel: {
                    title: 'Cancel editing, discards all changes.',
                    text: 'Cancel'
                }
            },
            buttons: {
                edit: 'Edit layers.',
                editDisabled: 'No layers to edit.',
                remove: 'Delete layers.',
                removeDisabled: 'No layers to delete.',
                split: 'Split tracks',
                splitDisabled: 'No tracks to split.',
                erase: 'Erase lines',
                eraseDisabled: 'Nothing to erase'
            }
        },
        handlers: {
            edit: {
                tooltip: {
                    text: 'Drag handles, or marker to edit feature.',
                    subtext: 'Click cancel to undo changes.'
                }
            },
            remove: {
                tooltip: {
                    text: 'Click on a feature to remove'
                }
            },
            split: {
                tooltip: {
                    text: 'Click on polyline to split',
                    subtext: 'Click cancel to undo changes.'
                }
            },
            erase: {
                tooltip: {
                    text: 'Erase lines under cursor',
                    subtext: 'Click cancel to undo changes.'
                }
            }
        }
    }
};


L.Draw = {};

L.Draw.Feature = L.Handler.extend({
	includes: L.Mixin.Events,

	initialize: function (map, options) {
		this._map = map;
		this._container = map._container;
		this._overlayPane = map._panes.overlayPane;
		this._popupPane = map._panes.popupPane;

		// Merge default shapeOptions options with custom shapeOptions
		if (options && options.shapeOptions) {
			options.shapeOptions = L.Util.extend({}, this.options.shapeOptions, options.shapeOptions);
		}
		L.setOptions(this, options);
	},

	enable: function () {
		if (this._enabled) { return; }

		L.Handler.prototype.enable.call(this);

		this.fire('enabled', { handler: this.type });

		this._map.fire('draw:drawstart', { layerType: this.type });
	},

	disable: function () {
		if (!this._enabled) { return; }

		L.Handler.prototype.disable.call(this);

		this._map.fire('draw:drawstop', { layerType: this.type });

		this.fire('disabled', { handler: this.type });
	},

	addHooks: function () {
		var map = this._map;

		if (map) {
			L.DomUtil.disableTextSelection();

			map.getContainer().focus();

			this._tooltip = new L.Tooltip(this._map);

			L.DomEvent.on(this._container, 'keyup', this._cancelDrawing, this);
		}
	},

	removeHooks: function () {
		if (this._map) {
			L.DomUtil.enableTextSelection();

			this._tooltip.dispose();
			this._tooltip = null;

			L.DomEvent.off(this._container, 'keyup', this._cancelDrawing, this);
		}
	},

	setOptions: function (options) {
		L.setOptions(this, options);
	},

	_fireCreatedEvent: function (layer) {
		this._map.fire('draw:created', { layer: layer, layerType: this.type });
	},

	// Cancel drawing when the escape key is pressed
	_cancelDrawing: function (e) {
		if (e.keyCode === 27) {
			this.disable();
		}
	}
});

L.Draw.Polyline = L.Draw.Feature.extend({
	statics: {
		TYPE: 'polyline'
	},

	Poly: L.Polyline,

	options: {
		allowIntersection: true,
		repeatMode: false,
		canContinue: true,
		drawError: {
			color: '#b00b00',
			timeout: 2500
		},
		icon: new L.DivIcon({
			iconSize: new L.Point(8, 8),
			className: 'leaflet-div-icon leaflet-editing-icon'
		}),
		touchIcon: new L.DivIcon({
			iconSize: new L.Point(20, 20),
			className: 'leaflet-div-icon leaflet-editing-icon leaflet-touch-icon'
		}),
		guidelineDistance: 20,
		maxGuideLineLength: 4000,
		shapeOptions: {
			stroke: true,
			color: '#f06eaa',
			weight: 4,
			opacity: 0.5,
			fill: false,
			clickable: true
		},
		metric: true, // Whether to use the metric meaurement system or imperial
		feet: true, // When not metric, to use feet instead of yards for display.
		showLength: true, // Whether to display distance in the tooltip
		zIndexOffset: 2000 // This should be > than the highest z-index any map layers
	},

	initialize: function (map, options) {
		// if touch, switch to touch icon
		if (L.Browser.touch) {
			this.options.icon = this.options.touchIcon;
		}

		this._featureGroup = options.featureGroup;

		// Need to set this here to ensure the correct message is used.
		this.options.drawError.message = L.drawLocal.draw.handlers.polyline.error;

		// Merge default drawError options with custom options
		if (options && options.drawError) {
			options.drawError = L.Util.extend({}, this.options.drawError, options.drawError);
		}

		// Save the type so super can fire, need to do this as cannot do this.TYPE :(
		this.type = L.Draw.Polyline.TYPE;
		this._continueHandlers = [];

		L.Draw.Feature.prototype.initialize.call(this, map, options);
	},

	addHooks: function () {
		var _this = this;
		L.Draw.Feature.prototype.addHooks.call(this);
		if (this._map) {
			this._markers = [];

			this._markerGroup = new L.LayerGroup();
			this._map.addLayer(this._markerGroup);

			this._poly = new L.Polyline([], this.options.shapeOptions);

			this._tooltip.updateContent(this._getTooltipText());

			// Make a transparent marker that will used to catch click events. These click
			// events will create the vertices. We need to do this so we can ensure that
			// we can create vertices over other map layers (markers, vector layers). We
			// also do not want to trigger any click handlers of objects we are clicking on
			// while drawing.
			if (!this._mouseMarker) {
				this._mouseMarker = L.marker(this._map.getCenter(), {
					icon: L.divIcon({
						className: 'leaflet-mouse-marker',
						iconAnchor: [20, 20],
						iconSize: [40, 40]
					}),
					opacity: 0,
					zIndexOffset: this.options.zIndexOffset
				});
			}

			if (this.options.canContinue === true) {
				this._hiddenPoly = null;
				this._featureGroup.eachLayer(this._addContinueHandler, this);
			}

			this._mouseMarker
				.on('mousedown', this._onMouseDown, this)
				.on('mouseout', this._onMouseOut, this)
				.on('mouseup', this._onMouseUp, this) // Necessary for 0.8 compatibility
				.on('mousemove', this._onMouseMove, this) // Necessary to prevent 0.8 stutter
				.on('contextmenu', this._onContextMenu, this)
				.addTo(this._map);

			this._map
				.on('mouseup', this._onMouseUp, this) // Necessary for 0.7 compatibility
				.on('mousemove', this._onMouseMove, this)
				.on('zoomlevelschange', this._onZoomEnd, this)
				.on('click', this._onTouch, this)
				.on('zoomend', this._onZoomEnd, this);

			this._featureGroup.eachLayer(function(layer) {
				if (layer instanceof L.Marker) {
					layer.setZIndexOffset(5000);
					_this._addMarkerHooks(layer);
				}
			});
		}

		this._eachContinueHandler(function (handler) {
			handler.addHooks();
		});
	},

	removeHooks: function () {
		var _this = this;
		if (this._hiddenPoly) {
			this._featureGroup.addLayer(this._hiddenPoly);
		}

		L.Draw.Feature.prototype.removeHooks.call(this);

		this._clearHideErrorTimeout();

		this._cleanUpShape();

		// remove markers from map
		this._map.removeLayer(this._markerGroup);
		delete this._markerGroup;
		delete this._markers;

		this._map.removeLayer(this._poly);
		delete this._poly;

		this._mouseMarker
			.off('mousedown', this._onMouseDown, this)
			.off('mouseout', this._onMouseOut, this)
			.off('mouseup', this._onMouseUp, this)
			.off('contextmenu', this._onContextMenu, this)
			.off('mousemove', this._onMouseMove, this);
		this._map.removeLayer(this._mouseMarker);
		delete this._mouseMarker;

		// clean up DOM
		this._clearGuides();

		this._map
			.off('mouseup', this._onMouseUp, this)
			.off('mousemove', this._onMouseMove, this)
			.off('zoomend', this._onZoomEnd, this)
			.off('click', this._onTouch, this);

		this._featureGroup.eachLayer(function(layer) {
				if (layer instanceof L.Marker) {
					layer.setZIndexOffset(0);
					_this._removeMarkerHooks(layer);
				}
			});

		this._removeContinueHandlers();
	},

	_addMarkerHooks: function(marker) {
		marker
			.on('mouseover', this._onMarkerMouseOver, this)
			.on('mouseout', this._onMarkerMouseOut, this)
			.on('click', this._onMarkerClick, this);
	},

	_removeMarkerHooks: function(marker) {
		marker
			.off('mouseover', this._onMarkerMouseOver, this)
			.off('mouseout', this._onMarkerMouseOut, this)
			.off('click', this._onMarkerClick, this);
	},

	deleteLastVertex: function () {
		if (this._markers.length <= 1) {
			return;
		}

		var lastMarker = this._markers.pop(),
			poly = this._poly,
			latlng = this._poly.spliceLatLngs(poly.getLatLngs().length - 1, 1)[0];

		this._markerGroup.removeLayer(lastMarker);

		if (poly.getLatLngs().length < 2) {
			this._map.removeLayer(poly);
		}

		this._vertexChanged(latlng, false);
	},

	addVertex: function (latlng) {
		var markersLength = this._markers.length;

		if (markersLength > 0 && !this.options.allowIntersection && this._poly.newLatLngIntersects(latlng)) {
			this._showErrorTooltip();
			return;
		}
		else if (this._errorShown) {
			this._hideErrorTooltip();
		}

		this._markers.push(this._createMarker(latlng));

		this._poly.addLatLng(latlng);

		if (this._poly.getLatLngs().length === 2) {
			this._map.addLayer(this._poly);
		}

		this._vertexChanged(latlng, true);
	},

	completeShape: function () {
		if (this._markers.length <= 1) {
			return;
		}

		this._fireCreatedEvent();
		this.disable();

		if (this.options.repeatMode) {
			this.enable();
		}
	},

	_finishShape: function () {
		var intersects = this._poly.newLatLngIntersects(this._poly.getLatLngs()[this._poly.getLatLngs().length - 1]);

		if ((!this.options.allowIntersection && intersects) || !this._shapeIsValid()) {
			this._showErrorTooltip();
			return;
		}

		var hidden = this._hiddenPoly;
		var latlngs = this._poly._latlngs;

		if (hidden) {
			if (hidden.reversed) {
				latlngs = latlngs.reverse();
				delete hidden.reversed;
			}
			this._hiddenPoly.setLatLngs(latlngs);
			this._featureGroup.addLayer(this._hiddenPoly);
		}

		this._fireCreatedEvent();
		this.disable();

		if (this.options.repeatMode) {
			this.enable();
		}
	},

	//Called to verify the shape is valid when the user tries to finish it
	//Return false if the shape is not valid
	_shapeIsValid: function () {
		return true;
	},

	_onZoomEnd: function () {
		this._updateGuide();
	},

	_onMouseMove: function (e) {
		var newPos = this._map.mouseEventToLayerPoint(e.originalEvent);
		var latlng = this._map.layerPointToLatLng(newPos);

		// Save latlng
		// should this be moved to _updateGuide() ?
		this._currentLatLng = latlng;

		this._updateTooltip(latlng);

		// Update the guide line
		this._updateGuide(newPos);

		// Update the mouse marker position
		this._mouseMarker.setLatLng(latlng);

		L.DomEvent.preventDefault(e.originalEvent);
	},

	_vertexChanged: function (latlng, added) {
		this._map.fire('draw:drawvertex', { layers: this._markerGroup });
		this._updateFinishHandler();

		this._updateRunningMeasure(latlng, added);

		this._clearGuides();

		this._updateTooltip();
	},

	_onMouseDown: function (e) {
		if (e.originalEvent.button === 2) {
			return;
		}
		var originalEvent = e.originalEvent;
		this._mouseDownOrigin = L.point(originalEvent.clientX, originalEvent.clientY);
	},

	_onMouseUp: function (e) {
		if (e.originalEvent.button === 2) {
			return;
		}
		if (this._mouseDownOrigin) {
			if (e.originalEvent.ctrlKey && this._markers.length) {
				this._fireRouteRequest(e.latlng);
			} else {
				// We detect clicks within a certain tolerance, otherwise let it
				// be interpreted as a drag by the map
				var distance = L.point(e.originalEvent.clientX, e.originalEvent.clientY)
					.distanceTo(this._mouseDownOrigin);
				if (Math.abs(distance) < 9 * (window.devicePixelRatio || 1)) {
					this.addVertex(e.latlng);
				}
			}
		}
		this._mouseDownOrigin = null;
	},

	_onTouch: function (e) {
		// #TODO: use touchstart and touchend vs using click(touch start & end).
		if (L.Browser.touch) { // #TODO: get rid of this once leaflet fixes their click/touch.
			this._onMouseDown(e);
			this._onMouseUp(e);
		}
	},

	_onMouseOut: function () {
		if (this._tooltip) {
			this._tooltip._onMouseOut.call(this._tooltip);
		}
	},

	_onContextMenu: function(e) {
		e.originalEvent.preventDefault();
	},

	_onMarkerMouseOver: function(e) {
		var hazardIcon = L.icon({
			iconUrl: "assets/images/green-marker-icon.png",
			iconSize: [25, 41],
			iconAnchor: [12, 41],
			popupAnchor: [1, -34],
			shadowSize: [41, 41]
		});

		e.target.setIcon(hazardIcon);
	},

	_onMarkerMouseOut: function(e) {
		e.target.setIcon(new L.Icon.Default());
	},

	_onMarkerMouseDown: function(e) {
		if (e.originalEvent.button === 2) {
			return;
		}
		var marker = e.target;
		this._mouseDownOrigin = this._map.latLngToLayerPoint(marker.getLatLng());
	},

	_onMarkerMouseUp: function(e) {
		if (e.originalEvent.button === 2) {
			return;
		}
		if (this._mouseDownOrigin) {
			if (e.originalEvent.ctrlKey && this._markers.length) {
				this._fireRouteRequest(e.target.getLatLng());
			} else {
				this.addVertex(e.target.getLatLng());
			}
		}
		this._mouseDownOrigin = null;
	},

	_onMarkerClick: function(e) {
		this._onMarkerMouseDown(e);
		this._onMarkerMouseUp(e);
	},

	_updateFinishHandler: function () {
		var markerCount = this._markers.length;
		// The last marker should have a click handler to close the polyline
		if (markerCount > 1) {
			this._markers[markerCount - 1].on('click', this._finishShape, this);
		}

		// Remove the old marker click handler (as only the last point should close the polyline)
		if (markerCount > 2) {
			this._markers[markerCount - 2].off('click', this._finishShape, this);
		}
	},

	_createMarker: function (latlng) {
		var marker = new L.Marker(latlng, {
			icon: this.options.icon,
			zIndexOffset: this.options.zIndexOffset * 2
		});

		this._markerGroup.addLayer(marker);

		return marker;
	},

	_updateGuide: function (newPos) {
		var markerCount = this._markers.length;

		if (markerCount > 0) {
			newPos = newPos || this._map.latLngToLayerPoint(this._currentLatLng);

			// draw the guide line
			this._clearGuides();
			this._drawGuide(
				this._map.latLngToLayerPoint(this._markers[markerCount - 1].getLatLng()),
				newPos
			);
		}
	},

	_updateTooltip: function (latLng) {
		var text = this._getTooltipText();

		if (latLng) {
			this._tooltip.updatePosition(latLng);
		}

		if (!this._errorShown) {
			this._tooltip.updateContent(text);
		}
	},

	_drawGuide: function (pointA, pointB) {
		var length = Math.floor(Math.sqrt(Math.pow((pointB.x - pointA.x), 2) + Math.pow((pointB.y - pointA.y), 2))),
			guidelineDistance = this.options.guidelineDistance,
			maxGuideLineLength = this.options.maxGuideLineLength,
			// Only draw a guideline with a max length
			i = length > maxGuideLineLength ? length - maxGuideLineLength : guidelineDistance,
			fraction,
			dashPoint,
			dash;

		//create the guides container if we haven't yet
		if (!this._guidesContainer) {
			this._guidesContainer = L.DomUtil.create('div', 'leaflet-draw-guides', this._overlayPane);
		}

		//draw a dash every GuildeLineDistance
		for (; i < length; i += this.options.guidelineDistance) {
			//work out fraction along line we are
			fraction = i / length;

			//calculate new x,y point
			dashPoint = {
				x: Math.floor((pointA.x * (1 - fraction)) + (fraction * pointB.x)),
				y: Math.floor((pointA.y * (1 - fraction)) + (fraction * pointB.y))
			};

			//add guide dash to guide container
			dash = L.DomUtil.create('div', 'leaflet-draw-guide-dash', this._guidesContainer);
			dash.style.backgroundColor =
				!this._errorShown ? this.options.shapeOptions.color : this.options.drawError.color;

			L.DomUtil.setPosition(dash, dashPoint);
		}
	},

	_updateGuideColor: function (color) {
		if (this._guidesContainer) {
			for (var i = 0, l = this._guidesContainer.childNodes.length; i < l; i++) {
				this._guidesContainer.childNodes[i].style.backgroundColor = color;
			}
		}
	},

	// removes all child elements (guide dashes) from the guides container
	_clearGuides: function () {
		if (this._guidesContainer) {
			while (this._guidesContainer.firstChild) {
				this._guidesContainer.removeChild(this._guidesContainer.firstChild);
			}
		}
	},

	_getTooltipText: function () {
		var showLength = this.options.showLength,
			labelText, distanceStr;

		if (this._markers.length === 0) {
			labelText = {
				text: L.drawLocal.draw.handlers.polyline.tooltip.start
			};
		} else {
			distanceStr = showLength ? this._getMeasurementString() : '';

			if (this._markers.length === 1) {
				labelText = {
					text: L.drawLocal.draw.handlers.polyline.tooltip.cont,
					subtext: distanceStr
				};
			} else {
				labelText = {
					text: L.drawLocal.draw.handlers.polyline.tooltip.end,
					subtext: distanceStr
				};
			}
		}
		return labelText;
	},

	_updateRunningMeasure: function (latlng, added) {
		var markersLength = this._markers.length,
			previousMarkerIndex, distance;

		if (this._markers.length === 1) {
			this._measurementRunningTotal = 0;
		} else {
			previousMarkerIndex = markersLength - (added ? 2 : 1);
			distance = latlng.distanceTo(this._markers[previousMarkerIndex].getLatLng());

			this._measurementRunningTotal += distance * (added ? 1 : -1);
		}
	},

	_getMeasurementString: function () {
		var currentLatLng = this._currentLatLng,
			previousLatLng = this._markers[this._markers.length - 1].getLatLng(),
			distance;

		// calculate the distance from the last fixed point to the mouse position
		distance = this._measurementRunningTotal + currentLatLng.distanceTo(previousLatLng);

		return L.GeometryUtil.readableDistance(distance, this.options.metric, this.options.feet);
	},

	_showErrorTooltip: function () {
		this._errorShown = true;

		// Update tooltip
		this._tooltip
			.showAsError()
			.updateContent({ text: this.options.drawError.message });

		// Update shape
		this._updateGuideColor(this.options.drawError.color);
		this._poly.setStyle({ color: this.options.drawError.color });

		// Hide the error after 2 seconds
		this._clearHideErrorTimeout();
		this._hideErrorTimeout = setTimeout(L.Util.bind(this._hideErrorTooltip, this), this.options.drawError.timeout);
	},

	_hideErrorTooltip: function () {
		this._errorShown = false;

		this._clearHideErrorTimeout();

		// Revert tooltip
		this._tooltip
			.removeError()
			.updateContent(this._getTooltipText());

		// Revert shape
		this._updateGuideColor(this.options.shapeOptions.color);
		this._poly.setStyle({ color: this.options.shapeOptions.color });
	},

	_clearHideErrorTimeout: function () {
		if (this._hideErrorTimeout) {
			clearTimeout(this._hideErrorTimeout);
			this._hideErrorTimeout = null;
		}
	},

	_cleanUpShape: function () {
		if (this._markers.length > 1) {
			this._markers[this._markers.length - 1].off('click', this._finishShape, this);
		}
	},

	_fireCreatedEvent: function () {
		var poly;
		if (this._hiddenPoly) {
			poly = this._hiddenPoly;
			poly.fire('changed');
		} else {
			poly = new this.Poly(this._poly.getLatLngs(), this.options.shapeOptions);
		}
		delete this._hiddenPoly;
		L.Draw.Feature.prototype._fireCreatedEvent.call(this, poly);
	},

	_addContinueHandler: function (layer) {
		if (layer instanceof L.Polyline) {
			this._continueHandlers.push(new L.Draw.PolylineContinue(layer, {}, this));
			layer.on('vertex:click', this._continuePolyline, this);
		}
	},

	_removeContinueHandlers: function () {
		var _this = this;
		this._eachContinueHandler(function (handler) {
			handler.removeHooks();
			handler._polyline.off('vertex:click', _this._continuePolyline, _this);
		});
		this._continueHandlers = [];
	},

	_removeContinueHandler: function (polyline) {
		var _this = this;
		this._eachContinueHandler(function (handler, index) {
			if (handler._polyline === polyline) {
				handler.removeHooks();
				handler._polyline.off('vertex:click', _this._continuePolyline, _this);
				_this._continueHandlers.splice(index, 1);
			}
		});
	},

	_appendPoints: function(points) {
			for (var i=0; i<points.length;i++) {
				this.addVertex(L.latLng(points[i].reverse()));
			}
	},

	_fireRouteRequest: function(latlng) {
		var markers = this._markers,
			last = markers[markers.length - 1],
			latLngs = [last.getLatLng(), latlng],
			_this = this;

		this._map.fireEvent('request:route', {
			latLngs: latLngs,
			callback: function(points) {
				points.splice(0,1);
				_this._appendPoints(points);
			}
		});
	},

	_continuePolyline: function (e) {

		var _this = this,
			finishShape = false,
			latLngsToAdd = e.target._latlngs,
			_latLngs = this._poly.getLatLngs(),
			i = 0;

		var continuePolyline = function(context, latLngs, finish) {
			if ((!context._markers.length && e.index === 0) ||
					(context._markers.length && e.index !== 0)) {
				context._hiddenPoly.reversed = true;
				for (i = latLngs.length-1; i >= 0; i--) {
					context.addVertex(latLngs[i]);
				}
			} else {
				for (i = 0; i < latLngs.length; i++) {
					context.addVertex(latLngs[i]);
				}
			}

			if (finish) {
				context._finishShape();
			}
		};

		this._removeContinueHandler(e.target);

		if (this._hiddenPoly) {
			this._removeContinueHandlers();
			this._featureGroup.removeLayer(e.target);
			this._map.fire('draw:deleted', { layers: new L.FeatureGroup().addLayer(e.target) });
		} else {
			this._hiddenPoly = e.target;
			this._featureGroup.removeLayer(this._hiddenPoly);
		}

		if (_latLngs.length) {
			finishShape = true;
		}

		if (e.originalEvent.originalEvent.ctrlKey) {
			this._map.fireEvent('request:route', {
				latLngs: [_latLngs[_latLngs.length-1], e.latlng],
				callback: function(points) {
					if (points.length > 3) {
						_this._appendPoints(points.splice(1,points.length - 2));
					}
					continuePolyline(_this, latLngsToAdd, finishShape);
				}
			});
		} else {
			continuePolyline(this, latLngsToAdd, finishShape);
		}

	},

	_eachContinueHandler: function (callback) {
		for (var i = 0; i < this._continueHandlers.length; i++) {
			callback(this._continueHandlers[i], i);
		}
	},

	updateMarkers: function () {
		this._eachContinueHandler(function (handler) {
			handler.updateMarkers();
		});
	}

});

L.Draw.PolylineContinue = L.Handler.extend({
	options: {
		icon: new L.DivIcon({
			iconSize: new L.Point(8, 8),
			className: 'leaflet-div-icon leaflet-editing-icon'
		}),
		touchIcon: new L.DivIcon({
			iconSize: new L.Point(20, 20),
			className: 'leaflet-div-icon leaflet-editing-icon leaflet-touch-icon'
		}),
	},

	initialize: function (polyline, options, parent) {
		if (L.Browser.touch) {
			this.options.icon = this.options.touchIcon;
		}
		this._polyline = polyline;
		this._parent = parent;
		L.setOptions(this, options);
	},

	addHooks: function () {
		this._polyline.setStyle(this._polyline.options.editing);

		if (this._polyline._map) {

			this._map = this._polyline._map;

			if (!this._markerGroup) {
				this._initMarkers();
			}
			this._polyline._map.addLayer(this._markerGroup);
		}
	},

	removeHooks: function () {
		this._polyline.setStyle(this._polyline.options.original);

		if (this._polyline._map) {
			this._polyline._map.removeLayer(this._markerGroup);
			delete this._markerGroup;
			delete this._markers;
		}
	},

	updateMarkers: function () {
		this._markerGroup.clearLayers();
		this._initMarkers();
	},

	_initMarkers: function () {
		if (!this._markerGroup) {
			this._markerGroup = new L.LayerGroup();
		}
		this._markers = [];

		var latLngs = this._polyline.getLatLngs();
		this._createMarker(latLngs[0], 0);

		var index = latLngs.length - 1;
		this._createMarker(latLngs[index], index);
	},

	_createMarker: function (latlng, index) {
		var marker = new L.Marker.Touch(latlng, {
			icon: this.options.icon,
			zIndexOffset: this._parent.options.zIndexOffset * 2
		});

		marker._origLatLng = latlng;
		marker._index = index;

		marker
			.on('click', this._fireContinue, this)
			.on('touchend', this._fireContinue, this)
			.on('MSPointerUp', this._fireContinue, this);

		this._markerGroup.addLayer(marker);

		this._markers.push(marker);
		return marker;
	},

	_removeMarker: function (marker) {
		marker
			.off('touchend', this._fireContinue, this)
			.off('click', this._fireContinue, this)
			.off('MSPointerUp', this._fireContinue, this);
	},

	_fireContinue: function (e) {
		this._polyline.fire('vertex:click', {
			polyline: this._polyline,
			index: e.target._index,
			latlng: e.latlng,
			originalEvent: e
		});
	},

});


L.Draw.Polygon = L.Draw.Polyline.extend({
	statics: {
		TYPE: 'polygon'
	},

	Poly: L.Polygon,

	options: {
		showArea: false,
		shapeOptions: {
			stroke: true,
			color: '#f06eaa',
			weight: 4,
			opacity: 0.5,
			fill: true,
			fillColor: null, //same as color by default
			fillOpacity: 0.2,
			clickable: true
		}
	},

	initialize: function (map, options) {
		L.Draw.Polyline.prototype.initialize.call(this, map, options);

		// Save the type so super can fire, need to do this as cannot do this.TYPE :(
		this.type = L.Draw.Polygon.TYPE;
	},

	_updateFinishHandler: function () {
		var markerCount = this._markers.length;

		// The first marker should have a click handler to close the polygon
		if (markerCount === 1) {
			this._markers[0].on('click', this._finishShape, this);
		}

		// Add and update the double click handler
		if (markerCount > 2) {
			this._markers[markerCount - 1].on('dblclick', this._finishShape, this);
			// Only need to remove handler if has been added before
			if (markerCount > 3) {
				this._markers[markerCount - 2].off('dblclick', this._finishShape, this);
			}
		}
	},

	_getTooltipText: function () {
		var text, subtext;

		if (this._markers.length === 0) {
			text = L.drawLocal.draw.handlers.polygon.tooltip.start;
		} else if (this._markers.length < 3) {
			text = L.drawLocal.draw.handlers.polygon.tooltip.cont;
		} else {
			text = L.drawLocal.draw.handlers.polygon.tooltip.end;
			subtext = this._getMeasurementString();
		}

		return {
			text: text,
			subtext: subtext
		};
	},

	_getMeasurementString: function () {
		var area = this._area;

		if (!area) {
			return null;
		}

		return L.GeometryUtil.readableArea(area, this.options.metric);
	},

	_shapeIsValid: function () {
		return this._markers.length >= 3;
	},

	_vertexChanged: function (latlng, added) {
		var latLngs;

		// Check to see if we should show the area
		if (!this.options.allowIntersection && this.options.showArea) {
			latLngs = this._poly.getLatLngs();

			this._area = L.GeometryUtil.geodesicArea(latLngs);
		}

		L.Draw.Polyline.prototype._vertexChanged.call(this, latlng, added);
	},

	_cleanUpShape: function () {
		var markerCount = this._markers.length;

		if (markerCount > 0) {
			this._markers[0].off('click', this._finishShape, this);

			if (markerCount > 2) {
				this._markers[markerCount - 1].off('dblclick', this._finishShape, this);
			}
		}
	}
});


L.SimpleShape = {};

L.Draw.SimpleShape = L.Draw.Feature.extend({
	options: {
		repeatMode: false
	},

	initialize: function (map, options) {
		this._endLabelText = L.drawLocal.draw.handlers.simpleshape.tooltip.end;

		L.Draw.Feature.prototype.initialize.call(this, map, options);
	},

	addHooks: function () {
		L.Draw.Feature.prototype.addHooks.call(this);
		if (this._map) {
			this._mapDraggable = this._map.dragging.enabled();

			if (this._mapDraggable) {
				this._map.dragging.disable();
			}

			//TODO refactor: move cursor to styles
			this._container.style.cursor = 'crosshair';

			this._tooltip.updateContent({ text: this._initialLabelText });

			this._map
				.on('mousedown', this._onMouseDown, this)
				.on('mousemove', this._onMouseMove, this)
				.on('touchstart', this._onMouseDown, this)
				.on('touchmove', this._onMouseMove, this);
		}
	},

	removeHooks: function () {
		L.Draw.Feature.prototype.removeHooks.call(this);
		if (this._map) {
			if (this._mapDraggable) {
				this._map.dragging.enable();
			}

			//TODO refactor: move cursor to styles
			this._container.style.cursor = '';

			this._map
				.off('mousedown', this._onMouseDown, this)
				.off('mousemove', this._onMouseMove, this)
				.off('touchstart', this._onMouseDown, this)
				.off('touchmove', this._onMouseMove, this);

			L.DomEvent.off(document, 'mouseup', this._onMouseUp, this);
			L.DomEvent.off(document, 'touchend', this._onMouseUp, this);

			// If the box element doesn't exist they must not have moved the mouse, so don't need to destroy/return
			if (this._shape) {
				this._map.removeLayer(this._shape);
				delete this._shape;
			}
		}
		this._isDrawing = false;
	},

	_getTooltipText: function () {
		return {
			text: this._endLabelText
		};
	},

	_onMouseDown: function (e) {
		this._isDrawing = true;
		this._startLatLng = e.latlng;

		L.DomEvent
			.on(document, 'mouseup', this._onMouseUp, this)
			.on(document, 'touchend', this._onMouseUp, this)
			.preventDefault(e.originalEvent);
	},

	_onMouseMove: function (e) {
		var latlng = e.latlng;

		this._tooltip.updatePosition(latlng);
		if (this._isDrawing) {
			this._tooltip.updateContent(this._getTooltipText());
			this._drawShape(latlng);
		}
	},

	_onMouseUp: function () {
		if (this._shape) {
			this._fireCreatedEvent();
		}

		this.disable();
		if (this.options.repeatMode) {
			this.enable();
		}
	}
});

L.Draw.Rectangle = L.Draw.SimpleShape.extend({
	statics: {
		TYPE: 'rectangle'
	},

	options: {
		shapeOptions: {
			stroke: true,
			color: '#f06eaa',
			weight: 4,
			opacity: 0.5,
			fill: true,
			fillColor: null, //same as color by default
			fillOpacity: 0.2,
			clickable: true
		},
		metric: true // Whether to use the metric measurement system or imperial
	},

	initialize: function (map, options) {
		// Save the type so super can fire, need to do this as cannot do this.TYPE :(
		this.type = L.Draw.Rectangle.TYPE;

		this._initialLabelText = L.drawLocal.draw.handlers.rectangle.tooltip.start;

		L.Draw.SimpleShape.prototype.initialize.call(this, map, options);
	},

	_drawShape: function (latlng) {
		if (!this._shape) {
			this._shape = new L.Rectangle(new L.LatLngBounds(this._startLatLng, latlng), this.options.shapeOptions);
			this._map.addLayer(this._shape);
		} else {
			this._shape.setBounds(new L.LatLngBounds(this._startLatLng, latlng));
		}
	},

	_fireCreatedEvent: function () {
		var rectangle = new L.Rectangle(this._shape.getBounds(), this.options.shapeOptions);
		L.Draw.SimpleShape.prototype._fireCreatedEvent.call(this, rectangle);
	},

	_getTooltipText: function () {
		var tooltipText = L.Draw.SimpleShape.prototype._getTooltipText.call(this),
			shape = this._shape,
			latLngs, area, subtext;

		if (shape) {
			latLngs = this._shape.getLatLngs();
			area = L.GeometryUtil.geodesicArea(latLngs);
			subtext = L.GeometryUtil.readableArea(area, this.options.metric);
		}

		return {
			text: tooltipText.text,
			subtext: subtext
		};
	}
});


L.Draw.Circle = L.Draw.SimpleShape.extend({
	statics: {
		TYPE: 'circle'
	},

	options: {
		shapeOptions: {
			stroke: true,
			color: '#f06eaa',
			weight: 4,
			opacity: 0.5,
			fill: true,
			fillColor: null, //same as color by default
			fillOpacity: 0.2,
			clickable: true
		},
		showRadius: true,
		metric: true, // Whether to use the metric meaurement system or imperial
		feet: true // When not metric, use feet instead of yards for display
	},

	initialize: function (map, options) {
		// Save the type so super can fire, need to do this as cannot do this.TYPE :(
		this.type = L.Draw.Circle.TYPE;

		this._initialLabelText = L.drawLocal.draw.handlers.circle.tooltip.start;

		L.Draw.SimpleShape.prototype.initialize.call(this, map, options);
	},

	_drawShape: function (latlng) {
		if (!this._shape) {
			this._shape = new L.Circle(this._startLatLng, this._startLatLng.distanceTo(latlng), this.options.shapeOptions);
			this._map.addLayer(this._shape);
		} else {
			this._shape.setRadius(this._startLatLng.distanceTo(latlng));
		}
	},

	_fireCreatedEvent: function () {
		var circle = new L.Circle(this._startLatLng, this._shape.getRadius(), this.options.shapeOptions);
		L.Draw.SimpleShape.prototype._fireCreatedEvent.call(this, circle);
	},

	_onMouseMove: function (e) {
		var latlng = e.latlng,
			showRadius = this.options.showRadius,
			useMetric = this.options.metric,
			radius;

		this._tooltip.updatePosition(latlng);
		if (this._isDrawing) {
			this._drawShape(latlng);

			// Get the new radius (rounded to 1 dp)
			radius = this._shape.getRadius().toFixed(1);

			this._tooltip.updateContent({
				text: this._endLabelText,
				subtext: showRadius ? L.drawLocal.draw.handlers.circle.radius + ': ' +
					L.GeometryUtil.readableDistance(radius, useMetric, this.options.feet) : ''
			});
		}
	}
});


L.Draw.Marker = L.Draw.Feature.extend({
	statics: {
		TYPE: 'marker'
	},

	options: {
		icon: new L.Icon.Default(),
		repeatMode: false,
		zIndexOffset: 2000 // This should be > than the highest z-index any markers
	},

	initialize: function (map, options) {
		// Save the type so super can fire, need to do this as cannot do this.TYPE :(
		this.type = L.Draw.Marker.TYPE;

		L.Draw.Feature.prototype.initialize.call(this, map, options);
	},

	addHooks: function () {
		L.Draw.Feature.prototype.addHooks.call(this);

		if (this._map) {
			this._tooltip.updateContent({ text: L.drawLocal.draw.handlers.marker.tooltip.start });

			// Same mouseMarker as in Draw.Polyline
			if (!this._mouseMarker) {
				this._mouseMarker = L.marker(this._map.getCenter(), {
					icon: L.divIcon({
						className: 'leaflet-mouse-marker',
						iconAnchor: [20, 20],
						iconSize: [40, 40]
					}),
					opacity: 0,
					zIndexOffset: this.options.zIndexOffset
				});
			}

			this._mouseMarker
				.on('click', this._onClick, this)
				.on('mousedown', this._onMouseDown, this)
				.on('contextmenu', this._onContextMenu, this)
				.addTo(this._map);

			this._map.on('mousemove', this._onMouseMove, this);
			this._map.on('click', this._onTouch, this);
		}
	},

	removeHooks: function () {
		L.Draw.Feature.prototype.removeHooks.call(this);

		if (this._map) {
			if (this._marker) {
				this._marker
				  .off('click', this._onClick, this)
				  .off('mousedown', this._onMouseDown, this)
				  .off('contextmenu', this._onContextMenu, this);

				this._map
					.off('click', this._onClick, this)
					.off('click', this._onTouch, this)
					.removeLayer(this._marker);
				delete this._marker;
			}

			this._mouseMarker.off('click', this._onClick, this);
			this._map.removeLayer(this._mouseMarker);
			delete this._mouseMarker;

			this._map.off('mousemove', this._onMouseMove, this);
		}
	},

	_onMouseMove: function (e) {
		var latlng = e.latlng;

		this._tooltip.updatePosition(latlng);
		this._mouseMarker.setLatLng(latlng);

		if (!this._marker) {
			this._marker = new L.Marker(latlng, {
				icon: this.options.icon,
				zIndexOffset: this.options.zIndexOffset
			});
			// Bind to both marker and map to make sure we get the click event.
			this._marker.on('click', this._onClick, this);
			this._map
				.on('click', this._onClick, this)
				.addLayer(this._marker);
		}
		else {
			latlng = this._mouseMarker.getLatLng();
			this._marker.setLatLng(latlng);
		}
	},

	_onClick: function () {
		this._fireCreatedEvent();

		this.disable();
		if (this.options.repeatMode) {
			this.enable();
		}
	},

	_onTouch: function (e) {
		// called on click & tap, only really does any thing on tap
		this._onMouseMove(e); // creates & places marker
		this._onClick(); // permanently places marker & ends interaction
	},

	_fireCreatedEvent: function () {
		var marker = new L.Marker.Touch(this._marker.getLatLng(), { icon: this.options.icon });
		L.Draw.Feature.prototype._fireCreatedEvent.call(this, marker);
	},

	_onMouseDown: function(e) {
	  if (e.originalEvent.button === 2) {
	    return;
	  }
	},

	_onContextMenu: function(e) {
	  e.originalEvent.preventDefault();
	}

});


L.Edit = L.Edit || {};

L.Edit.Marker = L.Handler.extend({
	initialize: function (marker, options) {
		this._marker = marker;
		L.setOptions(this, options);
	},

	addHooks: function () {
		var marker = this._marker;

		marker.dragging.enable();
		marker.on('dragend', this._onDragEnd, marker);
		this._toggleMarkerHighlight();
	},

	removeHooks: function () {
		var marker = this._marker;

		marker.dragging.disable();
		marker.off('dragend', this._onDragEnd, marker);
		this._toggleMarkerHighlight();
	},

	_onDragEnd: function (e) {
		var layer = e.target;
		layer.edited = true;
	},

	_toggleMarkerHighlight: function () {
		var icon = this._marker._icon;


		// Don't do anything if this layer is a marker but doesn't have an icon. Markers
		// should usually have icons. If using Leaflet.draw with Leaflet.markercluster there
		// is a chance that a marker doesn't.
		if (!icon) {
			return;
		}
		
		// This is quite naughty, but I don't see another way of doing it. (short of setting a new icon)
		icon.style.display = 'none';

		if (L.DomUtil.hasClass(icon, 'leaflet-edit-marker-selected')) {
			L.DomUtil.removeClass(icon, 'leaflet-edit-marker-selected');
			// Offset as the border will make the icon move.
			this._offsetMarker(icon, -4);

		} else {
			L.DomUtil.addClass(icon, 'leaflet-edit-marker-selected');
			// Offset as the border will make the icon move.
			this._offsetMarker(icon, 4);
		}

		icon.style.display = '';
	},

	_offsetMarker: function (icon, offset) {
		var iconMarginTop = parseInt(icon.style.marginTop, 10) - offset,
			iconMarginLeft = parseInt(icon.style.marginLeft, 10) - offset;

		icon.style.marginTop = iconMarginTop + 'px';
		icon.style.marginLeft = iconMarginLeft + 'px';
	}
});

L.Marker.addInitHook(function () {
	if (L.Edit.Marker) {
		this.editing = new L.Edit.Marker(this);

		if (this.options.editable) {
			this.editing.enable();
		}
	}
});


L.Edit = L.Edit || {};

/*
 * L.Edit.Poly is an editing handler for polylines and polygons.
 */
L.Edit.Poly = L.Handler.extend({
	options: {},

	initialize: function (poly, options) {

		this.latlngs = [poly._latlngs];
		if (poly._holes) {
			this.latlngs = this.latlngs.concat(poly._holes);
		}

		this._poly = poly;
		L.setOptions(this, options);

		this._poly.on('revert-edited changed', this._updateLatLngs, this);
	},

	_eachVertexHandler: function (callback) {
		for (var i = 0; i < this._verticesHandlers.length; i++) {
			callback(this._verticesHandlers[i]);
		}
	},

	addHooks: function () {
		this._initHandlers();
		this._eachVertexHandler(function (handler) {
			handler.addHooks();
		});
	},

	removeHooks: function () {
		this._eachVertexHandler(function (handler) {
			handler.removeHooks();
		});
	},

	updateMarkers: function () {
		this._eachVertexHandler(function (handler) {
			handler.updateMarkers();
		});
	},

	_initHandlers: function () {
		this._verticesHandlers = [];
		for (var i = 0; i < this.latlngs.length; i++) {
			this._verticesHandlers.push(new L.Edit.PolyVerticesEdit(this._poly, this.latlngs[i], this.options));
		}
	},

	_updateLatLngs: function (e) {
		this.latlngs = [e.target._latlngs];
		if (e.target._holes) {
			this.latlngs = this.latlngs.concat(e.target._holes);
		}
	}

});

L.Edit.PolyVerticesEdit = L.Handler.extend({
	options: {
		icon: new L.DivIcon({
			iconSize: new L.Point(8, 8),
			className: 'leaflet-div-icon leaflet-editing-icon'
		}),
		touchIcon: new L.DivIcon({
			iconSize: new L.Point(20, 20),
			className: 'leaflet-div-icon leaflet-editing-icon leaflet-touch-icon'
		}),
		drawError: {
			color: '#b00b00',
			timeout: 1000
		}


	},

	initialize: function (poly, latlngs, options) {
		// if touch, switch to touch icon
		if (L.Browser.touch) {
			this.options.icon = this.options.touchIcon;
		}
		this._poly = poly;

		if (options && options.drawError) {
			options.drawError = L.Util.extend({}, this.options.drawError, options.drawError);
		}

		this._latlngs = latlngs;

		L.setOptions(this, options);
	},

	addHooks: function () {
		var poly = this._poly;

		if (!(poly instanceof L.Polygon)) {
			poly.options.editing.fill = false;
		}

		poly.setStyle(poly.options.editing);

		if (this._poly._map) {

			this._map = this._poly._map; // Set map

			if (!this._markerGroup) {
				this._initMarkers();
			}
			this._poly._map.addLayer(this._markerGroup);
		}
	},

	removeHooks: function () {
		var poly = this._poly;

		poly.setStyle(poly.options.original);

		if (poly._map) {
			poly._map.removeLayer(this._markerGroup);
			delete this._markerGroup;
			delete this._markers;
		}
	},

	updateMarkers: function () {
		this._markerGroup.clearLayers();
		this._initMarkers();
	},

	_initMarkers: function () {
		if (!this._markerGroup) {
			this._markerGroup = new L.LayerGroup();
		}
		this._markers = [];

		var latlngs = this._latlngs,
			i, j, len, marker;

		for (i = 0, len = latlngs.length; i < len; i++) {

			marker = this._createMarker(latlngs[i], i);
			marker.on('click', this._onMarkerClick, this);
			this._markers.push(marker);
		}

		var markerLeft, markerRight;

		for (i = 0, j = len - 1; i < len; j = i++) {
			if (i === 0 && !(L.Polygon && (this._poly instanceof L.Polygon))) {
				continue;
			}

			markerLeft = this._markers[j];
			markerRight = this._markers[i];

			this._createMiddleMarker(markerLeft, markerRight);
			this._updatePrevNext(markerLeft, markerRight);
		}
	},

	_createMarker: function (latlng, index) {
		// Extending L.Marker in TouchEvents.js to include touch.
		var marker = new L.Marker.Touch(latlng, {
			draggable: true,
			icon: this.options.icon,
		});

		marker._origLatLng = latlng;
		marker._index = index;

		marker
			.on('dragstart', this._onMarkerDragStart, this)
			.on('drag', this._onMarkerDrag, this)
			.on('dragend', this._fireEdit, this)
			.on('touchmove', this._onTouchMove, this)
			.on('MSPointerMove', this._onTouchMove, this)
			.on('touchend', this._fireEdit, this)
			.on('MSPointerUp', this._fireEdit, this);

		this._markerGroup.addLayer(marker);

		return marker;
	},

	_onMarkerDragStart: function () {
		this._poly.fire('editstart');
	},

	_spliceLatLngs: function () {
		var removed = [].splice.apply(this._latlngs, arguments);
		this._poly._convertLatLngs(this._latlngs, true);
		this._poly.redraw();
		return removed;
	},

	_removeMarker: function (marker) {
		var i = marker._index;

		this._markerGroup.removeLayer(marker);
		this._markers.splice(i, 1);
		this._spliceLatLngs(i, 1);
		this._updateIndexes(i, -1);

		marker
			.off('dragstart', this._onMarkerDragStart, this)
			.off('drag', this._onMarkerDrag, this)
			.off('dragend', this._fireEdit, this)
			.off('touchmove', this._onMarkerDrag, this)
			.off('touchend', this._fireEdit, this)
			.off('click', this._onMarkerClick, this)
			.off('MSPointerMove', this._onTouchMove, this)
			.off('MSPointerUp', this._fireEdit, this);
	},

	_fireEdit: function () {
		this._poly.edited = true;
		this._poly.fire('edit');
		this._poly._map.fire('draw:editvertex', { layers: this._markerGroup });
	},

	_onMarkerDrag: function (e) {
		var marker = e.target;
		var poly = this._poly;

		L.extend(marker._origLatLng, marker._latlng);

		if (marker._middleLeft) {
			marker._middleLeft.setLatLng(this._getMiddleLatLng(marker._prev, marker));
		}
		if (marker._middleRight) {
			marker._middleRight.setLatLng(this._getMiddleLatLng(marker, marker._next));
		}

		if (poly.options.poly) {
			var tooltip = poly._map._editTooltip; // Access the tooltip

			// If we don't allow intersections and the polygon intersects
			if (!poly.options.poly.allowIntersection && poly.intersects()) {

				var originalColor = poly.options.color;
				poly.setStyle({ color: this.options.drawError.color });

				if (tooltip) {
					tooltip.updateContent({
						text: L.drawLocal.draw.handlers.polyline.error
					});
				}

				// Reset everything back to normal after a second
				setTimeout(function () {
					poly.setStyle({ color: originalColor });
					if (tooltip) {
						tooltip.updateContent({
							text:  L.drawLocal.edit.handlers.edit.tooltip.text,
							subtext:  L.drawLocal.edit.handlers.edit.tooltip.subtext
						});
					}
				}, 1000);
				this._onMarkerClick(e); // Reset the marker to it's original position
			}
		}

		this._poly.redraw();
		this._poly.fire('editdrag');
	},

	_onMarkerClick: function (e) {

		var minPoints = L.Polygon && (this._poly instanceof L.Polygon) ? 4 : 3,
			marker = e.target;

		// If removing this point would create an invalid polyline/polygon don't remove
		if (this._latlngs.length < minPoints) {
			return;
		}

		// remove the marker
		this._removeMarker(marker);

		// update prev/next links of adjacent markers
		this._updatePrevNext(marker._prev, marker._next);

		// remove ghost markers near the removed marker
		if (marker._middleLeft) {
			this._markerGroup.removeLayer(marker._middleLeft);
		}
		if (marker._middleRight) {
			this._markerGroup.removeLayer(marker._middleRight);
		}

		// create a ghost marker in place of the removed one
		if (marker._prev && marker._next) {
			this._createMiddleMarker(marker._prev, marker._next);

		} else if (!marker._prev) {
			marker._next._middleLeft = null;

		} else if (!marker._next) {
			marker._prev._middleRight = null;
		}

		this._fireEdit();
	},

	_onTouchMove: function (e) {

		var layerPoint = this._map.mouseEventToLayerPoint(e.originalEvent.touches[0]),
			latlng = this._map.layerPointToLatLng(layerPoint),
			marker = e.target;

		L.extend(marker._origLatLng, latlng);

		if (marker._middleLeft) {
			marker._middleLeft.setLatLng(this._getMiddleLatLng(marker._prev, marker));
		}
		if (marker._middleRight) {
			marker._middleRight.setLatLng(this._getMiddleLatLng(marker, marker._next));
		}

		this._poly.redraw();
		this.updateMarkers();
	},

	_updateIndexes: function (index, delta) {
		this._markerGroup.eachLayer(function (marker) {
			if (marker._index > index) {
				marker._index += delta;
			}
		});
	},

	_createMiddleMarker: function (marker1, marker2) {
		var latlng = this._getMiddleLatLng(marker1, marker2),
			marker = this._createMarker(latlng),
			onClick,
			onDragStart,
			onDragEnd;

		marker.setOpacity(0.6);

		marker1._middleRight = marker2._middleLeft = marker;

		onDragStart = function () {
			var i = marker2._index;

			marker._index = i;

			marker
				.off('click', onClick, this)
				.on('click', this._onMarkerClick, this);

			latlng.lat = marker.getLatLng().lat;
			latlng.lng = marker.getLatLng().lng;
			this._spliceLatLngs(i, 0, latlng);
			this._markers.splice(i, 0, marker);

			marker.setOpacity(1);

			this._updateIndexes(i, 1);
			marker2._index++;
			this._updatePrevNext(marker1, marker);
			this._updatePrevNext(marker, marker2);

			this._poly.fire('editstart');
		};

		onDragEnd = function () {
			marker.off('dragstart', onDragStart, this);
			marker.off('dragend', onDragEnd, this);
			marker.off('touchmove', onDragStart, this);

			this._createMiddleMarker(marker1, marker);
			this._createMiddleMarker(marker, marker2);
		};

		onClick = function () {
			onDragStart.call(this);
			onDragEnd.call(this);
			this._fireEdit();
		};

		marker
			.on('click', onClick, this)
			.on('dragstart', onDragStart, this)
			.on('dragend', onDragEnd, this)
			.on('touchmove', onDragStart, this);

		this._markerGroup.addLayer(marker);
	},

	_updatePrevNext: function (marker1, marker2) {
		if (marker1) {
			marker1._next = marker2;
		}
		if (marker2) {
			marker2._prev = marker1;
		}
	},

	_getMiddleLatLng: function (marker1, marker2) {
		var map = this._poly._map,
			p1 = map.project(marker1.getLatLng()),
			p2 = map.project(marker2.getLatLng());

		return map.unproject(p1._add(p2)._divideBy(2));
	}
});

L.Polyline.addInitHook(function () {

	// Check to see if handler has already been initialized. This is to support versions of Leaflet that still have L.Handler.PolyEdit
	if (this.editing || this instanceof L.Segment) {
		return;
	}

	if (L.Edit.Poly) {

		this.editing = new L.Edit.Poly(this, this.options.poly);

		if (this.options.editable) {
			this.editing.enable();
		}
	}

	this.on('add', function () {
		if (this.editing && this.editing.enabled()) {
			this.editing.addHooks();
		}
	});

	this.on('remove', function () {
		if (this.editing && this.editing.enabled()) {
			this.editing.removeHooks();
		}
	});
});

L.Edit = L.Edit || {};

L.Edit.Segment = L.Handler.extend({
	options: {},

	initialize: function (poly, options) {

		this.latlngs = [poly._latlngs];
		if (poly._holes) {
			this.latlngs = this.latlngs.concat(poly._holes);
		}

		this._poly = poly;
		L.setOptions(this, options);

		this._poly.on('revert-edited changed', this._updateLatLngs, this);
	},

	_eachVertexHandler: function (callback) {
		for (var i = 0; i < this._verticesHandlers.length; i++) {
			callback(this._verticesHandlers[i]);
		}
	},

	addHooks: function () {
		var _this = this;
		if (this._poly.properties) {
			var trackId = this._poly.properties.track || this._poly.properties.track_cid;

			this._poly._map.eachLayer(function(layer) {
				if (!layer.properties) {return;}
				var id = layer.properties.id || layer.properties.cid;

				if (id && id === trackId) {
				  _this._poly._track = layer;
				}
			});
		}

		this._initHandlers();
		this._eachVertexHandler(function (handler) {
			handler.addHooks();
		});
	},

	removeHooks: function () {
		this._eachVertexHandler(function (handler) {
			handler.removeHooks();
		});
	},

	updateMarkers: function () {
		this._eachVertexHandler(function (handler) {
			handler.updateMarkers();
		});
	},

	_initHandlers: function () {
		this._verticesHandlers = [];
		for (var i = 0; i < this.latlngs.length; i++) {
			this._verticesHandlers.push(new L.Edit.SegmentVerticesEdit(this._poly, this.latlngs[i], this.options));
		}
	},

	_updateLatLngs: function (e) {
		this.latlngs = [e.target._latlngs];
		if (e.target._holes) {
			this.latlngs = this.latlngs.concat(e.target._holes);
		}
	},

	_onTrackDelete: function() {
		this.removeHooks();
		this._map.removeLayer(this._poly);

		var layers = new L.LayerGroup();
		this._poly.addTo(layers);
		this._map.fire('draw:deleted', { layers: layers });
	}

});

L.Edit.SegmentVerticesEdit = L.Handler.extend({
	options: {
		icon: new L.DivIcon({
			iconSize: new L.Point(8, 8),
			className: 'leaflet-div-icon leaflet-editing-icon'
		}),
		touchIcon: new L.DivIcon({
			iconSize: new L.Point(20, 20),
			className: 'leaflet-div-icon leaflet-editing-icon leaflet-touch-icon'
		}),
	},

	initialize: function (poly, latlngs, options) {
		// if touch, switch to touch icon
		if (L.Browser.touch) {
			this.options.icon = this.options.touchIcon;
		}
		this._poly = poly;
		this._polyColor = poly.options.color;

		if (options && options.drawError) {
			options.drawError = L.Util.extend({}, this.options.drawError, options.drawError);
		}

		this._latlngs = latlngs;

		L.setOptions(this, options);
	},

	addHooks: function () {
		var poly = this._poly;

		if (!(poly instanceof L.Polygon)) {
			poly.options.editing.fill = false;
		}

		poly.setStyle(poly.options.editing);

		if (this._poly._map) {

			this._map = this._poly._map; // Set map
			this._drawSplitPoints();
			this._map
			  .on('zoomend', this._onZoomEnd, this)
			  .on('mousemove', this._onSplitpointMousemove, this)
			  .on('mouseup', this._onMouseUp, this);
		}
	},

	removeHooks: function () {
		var poly = this._poly;

		poly.setStyle(poly.options.original);

		if (poly._map) {
			this._poly._map
			  .off('zoomend', this._onZoomEnd, this)
			  .off('mousemove', this._onSplitpointMousemove, this)
			  .off('mouseup', this._onMouseUp, this);

			this._removeSplitPoints();
		}
	},

	_onZoomEnd: function(e) {
		this._moveSplitPoints();
	},

	_onMouseUp: function(e) {
		for (var i = 0; i < this._splitPoints.length; i++) {
		  this._splitPoints[i]._dragging = false;
		}
	},

	_moveSplitPoints: function(e) {
		var splitPoints = this._splitPoints,
			length = this._splitPoints.length;

		for (var i = 0; i < length; i++) {
			this._moveSplitPoint(splitPoints[i], null);
		}
	},

	_drawSplitPoints: function() {
	  var latlngs = this._poly.getLatLngs();

	this._removeSplitPoints();

	  this._splitPoints = [
		this._drawSplitPoint(latlngs[0]),
		this._drawSplitPoint(latlngs[latlngs.length-1])
	  ];

	  return this;
	},

	_removeSplitPoints: function() {
	  var splitPoints = this._splitPoints || [];
	  for (var i = 0; i < splitPoints.length; i++) {
		this._removeSplitPoint(splitPoints[i]);
	  }
	  this._splitPoints = [];
	},

	_removeSplitPoint: function(splitPoint) {
		var vertices = splitPoint.vertices,
			length = vertices.length;

		for (var i = 0; i < length; i++) {
		  this._map._pathRoot.removeChild(vertices[i]);
		}
	},

	_drawSplitPoint: function (latlng) {
		var controlVertex = this._createVertex(latlng, 8, '#ffffff'),
			vertices = [
			  this._createVertex(latlng, 10, '#00ff00'),
			  controlVertex
			];

		for (var i = 0; i < vertices.length; i++) {
		  this._map._pathRoot.appendChild(vertices[i]);
		}

		var closest,
			index = 0;

		if (this._poly._track) {
		  closest = this.closestLayerPoint(latlng, this._poly._track);
		  index = closest.index;
		}

		var splitPoint = {
		  latlng: latlng,
		  vertices: vertices,
		  index: index
		};

		this._addSplitPointHooks(controlVertex, splitPoint);
		return splitPoint;
	},

	_createVertex: function(latlng, radius, color) {
		var namespace = 'http://www.w3.org/2000/svg',
			point = this._map.latLngToLayerPoint(latlng),
			vertex;

		vertex = document.createElementNS(namespace, 'circle');
		vertex.setAttributeNS(null, 'r', radius);
		vertex.setAttributeNS(null, 'cx', point.x);
		vertex.setAttributeNS(null, 'cy', point.y);
		vertex.setAttributeNS(null, 'fill', color);
		vertex.setAttributeNS(null, 'fill-opacity', this._poly.options.opacity);
		return vertex;
	},

	_addSplitPointHooks: function(vertex, splitPoint) {
		var _this = this;
		vertex.className.baseVal = 'splitpoint';

		vertex.onmouseover = function(e) {
		  _this._onSplitpointMouseover(e);
		};
		vertex.onmouseout = function(e) {
		  _this._onSplitpointMouseout(e, splitPoint);
		};
		vertex.onmousedown = function(e) {
		  _this._onSplitpointMousedown(e, splitPoint);
		};
		vertex.onmouseup = function(e) {
		  _this._onSplitpointMouseup(e, splitPoint);
		};
	},

	_eachSplitVertex: function(callback) {
		var splitPoints = this._splitPoints;
		for (var i = 0; i < splitPoints.length; i++) {
			var vertices = splitPoints[i].vertices;
			for (var j = 0; j < vertices.length; j++) {
			  if (vertices[j].className.baseVal === 'splitpoint') {
				callback(vertices[j]);
			  }
		  }
		}
	},

	_onSplitpointMouseover: function() {
		this._map.dragging.disable();
		this._eachSplitVertex(function(vertex) {
			vertex.setAttribute('fill', '#C9C9C9', '');
		});

		this._poly.setStyle({color: '#C9C9C9'});
	},

	_onSplitpointMouseout: function(e, splitPoint) {
		this._map.dragging.enable();
		this._eachSplitVertex(function(vertex) {
			vertex.setAttribute('fill', '#ffffff', '');
		});
		this._poly.setStyle({color: this._polyColor});
	},

	_onSplitpointMousedown: function(e, splitPoint) {
		splitPoint._dragging = true;
	},

	_onSplitpointMouseup: function(e, splitPoint) {
		splitPoint._dragging = false;
	},

	_onSplitpointMousemove: function(e) {
		var splitPoint,
			splitPoints = this._splitPoints,
			length = splitPoints.length;

		for (var i = 0; i < length; i++) {
			if (splitPoints[i]._dragging) {
				splitPoint = splitPoints[i];
				break;
			}
		}

		if (!splitPoint || !this._poly._track) {
		  return;
		}
		var latlng = e.latlng,
			latlngs = [],
			closest;

		this._poly.edited = true;
		closest = this.closestLayerPoint(latlng, this._poly._track);
		splitPoint.index = closest.index;
		this._moveSplitPoint(splitPoint, closest);

		var start = this._splitPoints[0],
			end = this._splitPoints[1];

		latlngs = this._splitTrack(start, end);
		this._poly.setLatLngs(latlngs);
	},

	_moveSplitPoint: function(splitPoint, latlng) {
		var _latlng = latlng || splitPoint.latlng,
			vertices = splitPoint.vertices,
			length = vertices.length,
			point = this._map.latLngToLayerPoint(_latlng);

		splitPoint.latlng = _latlng;
		for (var i = 0; i < length; i++) {
			vertices[i].setAttributeNS(null, 'cx', point.x);
			vertices[i].setAttributeNS(null, 'cy', point.y);
		}
	},

	_createMarker: function (latlng) {
		var marker = new L.Marker(latlng, {
			draggable: true,
		});

		marker._origLatLng = latlng;

		marker
		  .on('dragstart', this._onMarkerDragStart, this)
		  .on('drag', this._onMarkerDrag, this)
		  .on('dragend', this._fireEdit, this)
		  .on('touchmove', this._onTouchMove, this)
		  .on('MSPointerMove', this._onTouchMove, this)
		  .on('touchend', this._fireEdit, this)
		  .on('MSPointerUp', this._fireEdit, this);

		this._markerGroup.addLayer(marker);

		return this;
	},

	_onMarkerDragStart: function () {
		this._poly.fire('editstart');
	},

	_removeMarker: function (marker) {
		var i = marker._index;

		this._markerGroup.removeLayer(marker);
		this._markers.splice(i, 1);
		this._spliceLatLngs(i, 1);
		this._updateIndexes(i, -1);

		marker
		  .off('dragstart', this._onMarkerDragStart, this)
		  .off('drag', this._onMarkerDrag, this)
		  .off('dragend', this._fireEdit, this)
		  .off('touchmove', this._onMarkerDrag, this)
		  .off('touchend', this._fireEdit, this)
		  .off('MSPointerMove', this._onTouchMove, this)
		  .off('MSPointerUp', this._fireEdit, this);
	},

	_fireEdit: function () {
		this._poly.edited = true;
		this._poly.fire('edit');
		this._poly._map.fire('draw:editvertex', { layers: this._markerGroup });
	},

	_onMarkerDrag: function (e) {
//		var marker = e.target;
//		var poly = this._poly;
//
//		L.extend(marker._origLatLng, marker._latlng);
//
//		this._poly.redraw();
//		this._poly.fire('editdrag');
	},

	_onTouchMove: function (e) {
//		var layerPoint = this._map.mouseEventToLayerPoint(e.originalEvent.touches[0]),
//			latlng = this._map.layerPointToLatLng(layerPoint),
//			marker = e.target;
//
//		L.extend(marker._origLatLng, latlng);
//
//		this._poly.redraw();
//		this.updateMarkers();
	},

	closestLayerPoint: function (latlng, layer) {
		var minDistance = Infinity,
						  p,
						  p1,
						  p2,
						  minPoint = null,
						  latlngs = layer.getLatLngs(),
						  _this = this;

		var project = function(latlng) {
		  return _this._map.project(L.latLng(latlng));
		};

		p = project(latlng);

		for (var i = 1, len = latlngs.length; i < len; i++) {
			p1 = project(latlngs[i - 1]);
			p2 = project(latlngs[i]);
			var sqDist = L.LineUtil._sqClosestPointOnSegment(p, p1, p2, true);
			if (sqDist < minDistance) {
				minDistance = sqDist;
				minPoint = L.LineUtil._sqClosestPointOnSegment(p, p1, p2);
				minPoint = _this._map.unproject(minPoint);
				minPoint.index = i;
			}
		}
		if (minPoint) {
			minPoint.distance = Math.sqrt(minDistance);
		}
		return minPoint;
	},

	_splitTrack: function (start, end) {
		var track = this._poly._track,
			startIndex = start.index,
			endIndex = end.index,
			trackLatLngs = [],
			firstPoint = start.latlng,
			endPoint = end.latlng,
			latlngs = [];

		if (startIndex > endIndex) {
			startIndex = startIndex + endIndex;
			endIndex = startIndex - endIndex;
			startIndex = startIndex - endIndex;
			firstPoint = end;
			endPoint = start;
		}
		latlngs.push(firstPoint);

		trackLatLngs = track.getLatLngs().slice(startIndex, endIndex);
		latlngs = latlngs.concat(trackLatLngs);
		latlngs.push(endPoint);

		return latlngs;

	},


});

L.Segment.addInitHook(function () {

	// Check to see if handler has already been initialized. This is to support versions of Leaflet that still have L.Handler.PolyEdit
	if (this.editing) {
		return;
	}

	if (L.Edit.Segment) {

		this.editing = new L.Edit.Segment(this, this.options.poly);

		if (this.options.editable) {
			this.editing.enable();
		}
	}

	this.on('add', function () {
		if (this.editing && this.editing.enabled()) {
			this.editing.addHooks();
		}
	});

	this.on('remove', function () {
		if (this.editing && this.editing.enabled()) {
			this.editing.removeHooks();
		}
	});
});

L.Edit = L.Edit || {};

L.Edit.SimpleShape = L.Handler.extend({
	options: {
		moveIcon: new L.DivIcon({
			iconSize: new L.Point(8, 8),
			className: 'leaflet-div-icon leaflet-editing-icon leaflet-edit-move'
		}),
		resizeIcon: new L.DivIcon({
			iconSize: new L.Point(8, 8),
			className: 'leaflet-div-icon leaflet-editing-icon leaflet-edit-resize'
		}),
		touchMoveIcon: new L.DivIcon({
			iconSize: new L.Point(20, 20),
			className: 'leaflet-div-icon leaflet-editing-icon leaflet-edit-move leaflet-touch-icon'
		}),
		touchResizeIcon: new L.DivIcon({
			iconSize: new L.Point(20, 20),
			className: 'leaflet-div-icon leaflet-editing-icon leaflet-edit-resize leaflet-touch-icon'
		}),
	},

	initialize: function (shape, options) {
		// if touch, switch to touch icon
		if (L.Browser.touch) {
			this.options.moveIcon = this.options.touchMoveIcon;
			this.options.resizeIcon = this.options.touchResizeIcon;
		}

		this._shape = shape;
		L.Util.setOptions(this, options);
	},

	addHooks: function () {
		var shape = this._shape;
		if (this._shape._map) {
			this._map = this._shape._map;
			shape.setStyle(shape.options.editing);

			if (shape._map) {
				this._map = shape._map;
				if (!this._markerGroup) {
					this._initMarkers();
				}
				this._map.addLayer(this._markerGroup);
			}
		}
	},

	removeHooks: function () {
		var shape = this._shape;

		shape.setStyle(shape.options.original);

		if (shape._map) {
			this._unbindMarker(this._moveMarker);

			for (var i = 0, l = this._resizeMarkers.length; i < l; i++) {
				this._unbindMarker(this._resizeMarkers[i]);
			}
			this._resizeMarkers = null;

			this._map.removeLayer(this._markerGroup);
			delete this._markerGroup;
		}

		this._map = null;
	},

	updateMarkers: function () {
		this._markerGroup.clearLayers();
		this._initMarkers();
	},

	_initMarkers: function () {
		if (!this._markerGroup) {
			this._markerGroup = new L.LayerGroup();
		}

		// Create center marker
		this._createMoveMarker();

		// Create edge marker
		this._createResizeMarker();
	},

	_createMoveMarker: function () {
		// Children override
	},

	_createResizeMarker: function () {
		// Children override
	},

	_createMarker: function (latlng, icon) {
		// Extending L.Marker in TouchEvents.js to include touch.
		var marker = new L.Marker.Touch(latlng, {
			draggable: true,
			icon: icon,
			zIndexOffset: 10
		});

		this._bindMarker(marker);

		this._markerGroup.addLayer(marker);

		return marker;
	},

	_bindMarker: function (marker) {
		marker
			.on('dragstart', this._onMarkerDragStart, this)
			.on('drag', this._onMarkerDrag, this)
			.on('dragend', this._onMarkerDragEnd, this)
			.on('touchstart', this._onTouchStart, this)
			.on('touchmove', this._onTouchMove, this)
			.on('MSPointerMove', this._onTouchMove, this)
			.on('touchend', this._onTouchEnd, this)
			.on('MSPointerUp', this._onTouchEnd, this);
	},

	_unbindMarker: function (marker) {
		marker
			.off('dragstart', this._onMarkerDragStart, this)
			.off('drag', this._onMarkerDrag, this)
			.off('dragend', this._onMarkerDragEnd, this)
			.off('touchstart', this._onTouchStart, this)
			.off('touchmove', this._onTouchMove, this)
			.off('MSPointerMove', this._onTouchMove, this)
			.off('touchend', this._onTouchEnd, this)
			.off('MSPointerUp', this._onTouchEnd, this);
	},

	_onMarkerDragStart: function (e) {
		var marker = e.target;
		marker.setOpacity(0);

		this._shape.fire('editstart');
	},

	_fireEdit: function () {
		this._shape.edited = true;
		this._shape.fire('edit');
	},

	_onMarkerDrag: function (e) {
		var marker = e.target,
			latlng = marker.getLatLng();

		if (marker === this._moveMarker) {
			this._move(latlng);
		} else {
			this._resize(latlng);
		}

		this._shape.redraw();
		this._shape.fire('editdrag');
	},

	_onMarkerDragEnd: function (e) {
		var marker = e.target;
		marker.setOpacity(1);

		this._fireEdit();
	},

	_onTouchStart: function (e) {
		L.Edit.SimpleShape.prototype._onMarkerDragStart.call(this, e);

		if (typeof(this._getCorners) === 'function') {
			// Save a reference to the opposite point
			var corners = this._getCorners(),
				marker = e.target,
				currentCornerIndex = marker._cornerIndex;
			
			marker.setOpacity(0);

			// Copyed from Edit.Rectangle.js line 23 _onMarkerDragStart()
			// Latlng is null otherwise.
			this._oppositeCorner = corners[(currentCornerIndex + 2) % 4];
			this._toggleCornerMarkers(0, currentCornerIndex);
		}
	
		this._shape.fire('editstart');
	},

	_onTouchMove: function (e) {
		var layerPoint = this._map.mouseEventToLayerPoint(e.originalEvent.touches[0]),
			latlng = this._map.layerPointToLatLng(layerPoint),
			marker = e.target;

		if (marker === this._moveMarker) {
			this._move(latlng);
		} else {
			this._resize(latlng);
		}

		this._shape.redraw();
		
		// prevent touchcancel in IOS
		// e.preventDefault();
		return false;
	},

	_onTouchEnd: function (e) {
		var marker = e.target;
		marker.setOpacity(1);
		this.updateMarkers();
		this._fireEdit();
	},

	_move: function () {
		// Children override
	},

	_resize: function () {
		// Children override
	}
});


L.Edit = L.Edit || {};

L.Edit.Rectangle = L.Edit.SimpleShape.extend({
	_createMoveMarker: function () {
		var bounds = this._shape.getBounds(),
			center = bounds.getCenter();

		this._moveMarker = this._createMarker(center, this.options.moveIcon);
	},

	_createResizeMarker: function () {
		var corners = this._getCorners();

		this._resizeMarkers = [];

		for (var i = 0, l = corners.length; i < l; i++) {
			this._resizeMarkers.push(this._createMarker(corners[i], this.options.resizeIcon));
			// Monkey in the corner index as we will need to know this for dragging
			this._resizeMarkers[i]._cornerIndex = i;
		}
	},

	_onMarkerDragStart: function (e) {
		L.Edit.SimpleShape.prototype._onMarkerDragStart.call(this, e);

		// Save a reference to the opposite point
		var corners = this._getCorners(),
			marker = e.target,
			currentCornerIndex = marker._cornerIndex;

		this._oppositeCorner = corners[(currentCornerIndex + 2) % 4];

		this._toggleCornerMarkers(0, currentCornerIndex);
	},

	_onMarkerDragEnd: function (e) {
		var marker = e.target,
			bounds, center;

		// Reset move marker position to the center
		if (marker === this._moveMarker) {
			bounds = this._shape.getBounds();
			center = bounds.getCenter();

			marker.setLatLng(center);
		}

		this._toggleCornerMarkers(1);

		this._repositionCornerMarkers();

		L.Edit.SimpleShape.prototype._onMarkerDragEnd.call(this, e);
	},

	_move: function (newCenter) {
		var latlngs = this._shape.getLatLngs(),
			bounds = this._shape.getBounds(),
			center = bounds.getCenter(),
			offset, newLatLngs = [];

		// Offset the latlngs to the new center
		for (var i = 0, l = latlngs.length; i < l; i++) {
			offset = [latlngs[i].lat - center.lat, latlngs[i].lng - center.lng];
			newLatLngs.push([newCenter.lat + offset[0], newCenter.lng + offset[1]]);
		}

		this._shape.setLatLngs(newLatLngs);

		// Reposition the resize markers
		this._repositionCornerMarkers();
	},

	_resize: function (latlng) {
		var bounds;

		// Update the shape based on the current position of this corner and the opposite point
		this._shape.setBounds(L.latLngBounds(latlng, this._oppositeCorner));

		// Reposition the move marker
		bounds = this._shape.getBounds();
		this._moveMarker.setLatLng(bounds.getCenter());
	},

	_getCorners: function () {
		var bounds = this._shape.getBounds(),
			nw = bounds.getNorthWest(),
			ne = bounds.getNorthEast(),
			se = bounds.getSouthEast(),
			sw = bounds.getSouthWest();

		return [nw, ne, se, sw];
	},

	_toggleCornerMarkers: function (opacity) {
		for (var i = 0, l = this._resizeMarkers.length; i < l; i++) {
			this._resizeMarkers[i].setOpacity(opacity);
		}
	},

	_repositionCornerMarkers: function () {
		var corners = this._getCorners();

		for (var i = 0, l = this._resizeMarkers.length; i < l; i++) {
			this._resizeMarkers[i].setLatLng(corners[i]);
		}
	}
});

L.Rectangle.addInitHook(function () {
	if (L.Edit.Rectangle) {
		this.editing = new L.Edit.Rectangle(this);

		if (this.options.editable) {
			this.editing.enable();
		}
	}
});


L.Edit = L.Edit || {};

L.Edit.Circle = L.Edit.SimpleShape.extend({
	_createMoveMarker: function () {
		var center = this._shape.getLatLng();

		this._moveMarker = this._createMarker(center, this.options.moveIcon);
	},

	_createResizeMarker: function () {
		var center = this._shape.getLatLng(),
			resizemarkerPoint = this._getResizeMarkerPoint(center);

		this._resizeMarkers = [];
		this._resizeMarkers.push(this._createMarker(resizemarkerPoint, this.options.resizeIcon));
	},

	_getResizeMarkerPoint: function (latlng) {
		// From L.shape.getBounds()
		var delta = this._shape._radius * Math.cos(Math.PI / 4),
			point = this._map.project(latlng);
		return this._map.unproject([point.x + delta, point.y - delta]);
	},

	_move: function (latlng) {
		var resizemarkerPoint = this._getResizeMarkerPoint(latlng);

		// Move the resize marker
		this._resizeMarkers[0].setLatLng(resizemarkerPoint);

		// Move the circle
		this._shape.setLatLng(latlng);
	},

	_resize: function (latlng) {
		var moveLatLng = this._moveMarker.getLatLng(),
			radius = moveLatLng.distanceTo(latlng);

		this._shape.setRadius(radius);
	}
});

L.Circle.addInitHook(function () {
	if (L.Edit.Circle) {
		this.editing = new L.Edit.Circle(this);

		if (this.options.editable) {
			this.editing.enable();
		}
	}

	this.on('add', function () {
		if (this.editing && this.editing.enabled()) {
			this.editing.addHooks();
		}
	});

	this.on('remove', function () {
		if (this.editing && this.editing.enabled()) {
			this.editing.removeHooks();
		}
	});
});

L.Map.mergeOptions({
	touchExtend: true
});

L.Map.TouchExtend = L.Handler.extend({

	initialize: function (map) {
		this._map = map;
		this._container = map._container;
		this._pane = map._panes.overlayPane;
	},

	addHooks: function () {
		L.DomEvent.on(this._container, 'touchstart', this._onTouchStart, this);
		L.DomEvent.on(this._container, 'touchend', this._onTouchEnd, this);
		L.DomEvent.on(this._container, 'touchmove', this._onTouchMove, this);
		if (this._detectIE()) {
			L.DomEvent.on(this._container, 'MSPointerDown', this._onTouchStart, this);
			L.DomEvent.on(this._container, 'MSPointerUp', this._onTouchEnd, this);
			L.DomEvent.on(this._container, 'MSPointerMove', this._onTouchMove, this);
			L.DomEvent.on(this._container, 'MSPointerCancel', this._onTouchCancel, this);

		} else {
			L.DomEvent.on(this._container, 'touchcancel', this._onTouchCancel, this);
			L.DomEvent.on(this._container, 'touchleave', this._onTouchLeave, this);
		}
	},

	removeHooks: function () {
		L.DomEvent.off(this._container, 'touchstart', this._onTouchStart);
		L.DomEvent.off(this._container, 'touchend', this._onTouchEnd);
		L.DomEvent.off(this._container, 'touchmove', this._onTouchMove);
		if (this._detectIE()) {
			L.DomEvent.off(this._container, 'MSPointerDowm', this._onTouchStart);
			L.DomEvent.off(this._container, 'MSPointerUp', this._onTouchEnd);
			L.DomEvent.off(this._container, 'MSPointerMove', this._onTouchMove);
			L.DomEvent.off(this._container, 'MSPointerCancel', this._onTouchCancel);
		} else {
			L.DomEvent.off(this._container, 'touchcancel', this._onTouchCancel);
			L.DomEvent.off(this._container, 'touchleave', this._onTouchLeave);
		}
	},

	_touchEvent: function (e, type) {
		// #TODO: fix the pageX error that is do a bug in Android where a single touch triggers two click events
		// _filterClick is what leaflet uses as a workaround.
		// This is a problem with more things than just android. Another problem is touchEnd has no touches in
		// its touch list.
		var touchEvent = {};
		if (typeof e.touches !== 'undefined') {
			if (!e.touches.length) {
				return;
			}
			touchEvent = e.touches[0];
		} else if (e.pointerType === 'touch') {
			touchEvent = e;
            if (!this._filterClick(e)) {
                return;
            }
		} else {
			return;
		}

		var containerPoint = this._map.mouseEventToContainerPoint(touchEvent),
			layerPoint = this._map.mouseEventToLayerPoint(touchEvent),
			latlng = this._map.layerPointToLatLng(layerPoint);

		this._map.fire(type, {
			latlng: latlng,
			layerPoint: layerPoint,
			containerPoint: containerPoint,
			pageX: touchEvent.pageX,
			pageY: touchEvent.pageY,
			originalEvent: e
		});
	},

    /** Borrowed from Leaflet and modified for bool ops **/
    _filterClick: function (e) {
        var timeStamp = (e.timeStamp || e.originalEvent.timeStamp),
            elapsed = L.DomEvent._lastClick && (timeStamp - L.DomEvent._lastClick);

        // are they closer together than 500ms yet more than 100ms?
        // Android typically triggers them ~300ms apart while multiple listeners
        // on the same event should be triggered far faster;
        // or check if click is simulated on the element, and if it is, reject any non-simulated events
        if ((elapsed && elapsed > 100 && elapsed < 500) || (e.target._simulatedClick && !e._simulated)) {
            L.DomEvent.stop(e);
            return false;
        }
        L.DomEvent._lastClick = timeStamp;
        return true;
    },

	_onTouchStart: function (e) {
		if (!this._map._loaded) {
			return;
		}

		var type = 'touchstart';
		this._touchEvent(e, type);

	},

	_onTouchEnd: function (e) {
		if (!this._map._loaded) {
			return;
		}

		var type = 'touchend';
		this._touchEvent(e, type);
	},

	_onTouchCancel: function (e) {
		if (!this._map._loaded) {
			return;
		}

		var type = 'touchcancel';
		if (this._detectIE()) {
			type = 'pointercancel';
		}
		this._touchEvent(e, type);
	},

	_onTouchLeave: function (e) {
		if (!this._map._loaded) {
			return;
		}

		var type = 'touchleave';
		this._touchEvent(e, type);
	},

	_onTouchMove: function (e) {
		if (!this._map._loaded) {
			return;
		}

		var type = 'touchmove';
		this._touchEvent(e, type);
	},

	_detectIE: function () {
		var ua = window.navigator.userAgent;

		var msie = ua.indexOf('MSIE ');
		if (msie > 0) {
			// IE 10 or older => return version number
			return parseInt(ua.substring(msie + 5, ua.indexOf('.', msie)), 10);
		}

		var trident = ua.indexOf('Trident/');
		if (trident > 0) {
			// IE 11 => return version number
			var rv = ua.indexOf('rv:');
			return parseInt(ua.substring(rv + 3, ua.indexOf('.', rv)), 10);
		}

		var edge = ua.indexOf('Edge/');
		if (edge > 0) {
			// IE 12 => return version number
			return parseInt(ua.substring(edge + 5, ua.indexOf('.', edge)), 10);
		}

		// other browser
		return false;
	}
});

L.Map.addInitHook('addHandler', 'touchExtend', L.Map.TouchExtend);

// This isn't full Touch support. This is just to get makers to also support dom touch events after creation
// #TODO: find a better way of getting markers to support touch.
L.Marker.Touch = L.Marker.extend({

	// This is an exact copy of https://github.com/Leaflet/Leaflet/blob/v0.7/src/layer/marker/Marker.js
	// with the addition of the touch event son line 15.
	_initInteraction: function () {

		if (!this.options.clickable) {
			return;
		}

		// TODO refactor into something shared with Map/Path/etc. to DRY it up

		var icon = this._icon,
			events = ['dblclick', 'mousedown', 'mouseover', 'mouseout', 'contextmenu', 'touchstart', 'touchend', 'touchmove'];
		if (this._detectIE) {
			events.concat(['MSPointerDown', 'MSPointerUp', 'MSPointerMove', 'MSPointerCancel']);
		} else {
			events.concat(['touchcancel']);
		}

		L.DomUtil.addClass(icon, 'leaflet-clickable');
		L.DomEvent.on(icon, 'click', this._onMouseClick, this);
		L.DomEvent.on(icon, 'keypress', this._onKeyPress, this);

		for (var i = 0; i < events.length; i++) {
			L.DomEvent.on(icon, events[i], this._fireMouseEvent, this);
		}

		if (L.Handler.MarkerDrag) {
			this.dragging = new L.Handler.MarkerDrag(this);

			if (this.options.draggable) {
				this.dragging.enable();
			}
		}
	},
	_detectIE: function () {
		var ua = window.navigator.userAgent;

		var msie = ua.indexOf('MSIE ');
		if (msie > 0) {
			// IE 10 or older => return version number
			return parseInt(ua.substring(msie + 5, ua.indexOf('.', msie)), 10);
		}

		var trident = ua.indexOf('Trident/');
		if (trident > 0) {
			// IE 11 => return version number
			var rv = ua.indexOf('rv:');
			return parseInt(ua.substring(rv + 3, ua.indexOf('.', rv)), 10);
		}

		var edge = ua.indexOf('Edge/');
		if (edge > 0) {
			// IE 12 => return version number
			return parseInt(ua.substring(edge + 5, ua.indexOf('.', edge)), 10);
		}

		// other browser
		return false;
	}
});


/*
 * L.LatLngUtil contains different utility functions for LatLngs.
 */

L.LatLngUtil = {
	// Clones a LatLngs[], returns [][]
	cloneLatLngs: function (latlngs) {
		var clone = [];
		for (var i = 0, l = latlngs.length; i < l; i++) {
			clone.push(this.cloneLatLng(latlngs[i]));
		}
		return clone;
	},

	cloneLatLng: function (latlng) {
		return L.latLng(latlng.lat, latlng.lng);
	}
};

L.GeometryUtil = L.extend(L.GeometryUtil || {}, {
	// Ported from the OpenLayers implementation. See https://github.com/openlayers/openlayers/blob/master/lib/OpenLayers/Geometry/LinearRing.js#L270
	geodesicArea: function (latLngs) {
		var pointsCount = latLngs.length,
			area = 0.0,
			d2r = L.LatLng.DEG_TO_RAD,
			p1, p2;

		if (pointsCount > 2) {
			for (var i = 0; i < pointsCount; i++) {
				p1 = latLngs[i];
				p2 = latLngs[(i + 1) % pointsCount];
				area += ((p2.lng - p1.lng) * d2r) *
						(2 + Math.sin(p1.lat * d2r) + Math.sin(p2.lat * d2r));
			}
			area = area * 6378137.0 * 6378137.0 / 2.0;
		}

		return Math.abs(area);
	},

	readableArea: function (area, isMetric) {
		var areaStr;

		if (isMetric) {
			if (area >= 10000) {
				areaStr = (area * 0.0001).toFixed(2) + ' ha';
			} else {
				areaStr = area.toFixed(2) + ' m&sup2;';
			}
		} else {
			area /= 0.836127; // Square yards in 1 meter

			if (area >= 3097600) { //3097600 square yards in 1 square mile
				areaStr = (area / 3097600).toFixed(2) + ' mi&sup2;';
			} else if (area >= 4840) {//48040 square yards in 1 acre
				areaStr = (area / 4840).toFixed(2) + ' acres';
			} else {
				areaStr = Math.ceil(area) + ' yd&sup2;';
			}
		}

		return areaStr;
	},

	readableDistance: function (distance, isMetric, useFeet) {
		var distanceStr;

		if (isMetric) {
			// show metres when distance is < 1km, then show km
			if (distance > 1000) {
				distanceStr = (distance  / 1000).toFixed(2) + ' km';
			} else {
				distanceStr = Math.ceil(distance) + ' m';
			}
		} else {
			distance *= 1.09361;

			if (distance > 1760) {
				distanceStr = (distance / 1760).toFixed(2) + ' miles';
			} else {
				var suffix = ' yd';
				if (useFeet) {
					distance = distance * 3;
					suffix = ' ft';
				}
				distanceStr = Math.ceil(distance) + suffix;
			}
		}

		return distanceStr;
	}
});


L.Util.extend(L.LineUtil, {
	// Checks to see if two line segments intersect. Does not handle degenerate cases.
	// http://compgeom.cs.uiuc.edu/~jeffe/teaching/373/notes/x06-sweepline.pdf
	segmentsIntersect: function (/*Point*/ p, /*Point*/ p1, /*Point*/ p2, /*Point*/ p3) {
		return	this._checkCounterclockwise(p, p2, p3) !==
				this._checkCounterclockwise(p1, p2, p3) &&
				this._checkCounterclockwise(p, p1, p2) !==
				this._checkCounterclockwise(p, p1, p3);
	},

	// check to see if points are in counterclockwise order
	_checkCounterclockwise: function (/*Point*/ p, /*Point*/ p1, /*Point*/ p2) {
		return (p2.y - p.y) * (p1.x - p.x) > (p1.y - p.y) * (p2.x - p.x);
	}
});

L.Polyline.include({
	// Check to see if this polyline has any linesegments that intersect.
	// NOTE: does not support detecting intersection for degenerate cases.
	intersects: function () {
		var points = this._originalPoints,
			len = points ? points.length : 0,
			i, p, p1;

		if (this._tooFewPointsForIntersection()) {
			return false;
		}

		for (i = len - 1; i >= 3; i--) {
			p = points[i - 1];
			p1 = points[i];


			if (this._lineSegmentsIntersectsRange(p, p1, i - 2)) {
				return true;
			}
		}

		return false;
	},

	// Check for intersection if new latlng was added to this polyline.
	// NOTE: does not support detecting intersection for degenerate cases.
	newLatLngIntersects: function (latlng, skipFirst) {
		// Cannot check a polyline for intersecting lats/lngs when not added to the map
		if (!this._map) {
			return false;
		}

		return this.newPointIntersects(this._map.latLngToLayerPoint(latlng), skipFirst);
	},

	// Check for intersection if new point was added to this polyline.
	// newPoint must be a layer point.
	// NOTE: does not support detecting intersection for degenerate cases.
	newPointIntersects: function (newPoint, skipFirst) {
		var points = this._originalPoints,
			len = points ? points.length : 0,
			lastPoint = points ? points[len - 1] : null,
			// The previous previous line segment. Previous line segment doesn't need testing.
			maxIndex = len - 2;

		if (this._tooFewPointsForIntersection(1)) {
			return false;
		}

		return this._lineSegmentsIntersectsRange(lastPoint, newPoint, maxIndex, skipFirst ? 1 : 0);
	},

	// Polylines with 2 sides can only intersect in cases where points are collinear (we don't support detecting these).
	// Cannot have intersection when < 3 line segments (< 4 points)
	_tooFewPointsForIntersection: function (extraPoints) {
		var points = this._originalPoints,
			len = points ? points.length : 0;
		// Increment length by extraPoints if present
		len += extraPoints || 0;

		return !this._originalPoints || len <= 3;
	},

	// Checks a line segment intersections with any line segments before its predecessor.
	// Don't need to check the predecessor as will never intersect.
	_lineSegmentsIntersectsRange: function (p, p1, maxIndex, minIndex) {
		var points = this._originalPoints,
			p2, p3;

		minIndex = minIndex || 0;

		// Check all previous line segments (beside the immediately previous) for intersections
		for (var j = maxIndex; j > minIndex; j--) {
			p2 = points[j - 1];
			p3 = points[j];

			if (L.LineUtil.segmentsIntersect(p, p1, p2, p3)) {
				return true;
			}
		}

		return false;
	}
});


L.Polygon.include({
	// Checks a polygon for any intersecting line segments. Ignores holes.
	intersects: function () {
		var polylineIntersects,
			points = this._originalPoints,
			len, firstPoint, lastPoint, maxIndex;

		if (this._tooFewPointsForIntersection()) {
			return false;
		}

		polylineIntersects = L.Polyline.prototype.intersects.call(this);

		// If already found an intersection don't need to check for any more.
		if (polylineIntersects) {
			return true;
		}

		len = points.length;
		firstPoint = points[0];
		lastPoint = points[len - 1];
		maxIndex = len - 2;

		// Check the line segment between last and first point. Don't need to check the first line segment (minIndex = 1)
		return this._lineSegmentsIntersectsRange(lastPoint, firstPoint, maxIndex, 1);
	}
});

L.Control.Draw = L.Control.extend({

	options: {
		position: 'topleft',
		draw: {},
		edit: false
	},

	initialize: function (options) {
		if (L.version < '0.7') {
			throw new Error('Leaflet.draw 0.2.3+ requires Leaflet 0.7.0+. Download latest from https://github.com/Leaflet/Leaflet/');
		}

		L.Control.prototype.initialize.call(this, options);

		var toolbar;

		this._toolbars = {};

		// Initialize toolbars
		if (L.DrawToolbar && this.options.draw) {
			toolbar = new L.DrawToolbar(this.options.draw);

			this._toolbars[L.DrawToolbar.TYPE] = toolbar;

			// Listen for when toolbar is enabled
			this._toolbars[L.DrawToolbar.TYPE].on('enable', this._toolbarEnabled, this);
		}

		if (L.EditToolbar && this.options.edit) {
			toolbar = new L.EditToolbar(this.options.edit);

			this._toolbars[L.EditToolbar.TYPE] = toolbar;

			// Listen for when toolbar is enabled
			this._toolbars[L.EditToolbar.TYPE].on('enable', this._toolbarEnabled, this);
		}
		L.toolbar = this; //set global var for editing the toolbar
	},

	onAdd: function (map) {
		var container = L.DomUtil.create('div', 'leaflet-draw'),
			addedTopClass = false,
			topClassName = 'leaflet-draw-toolbar-top',
			toolbarContainer;

		for (var toolbarId in this._toolbars) {
			if (this._toolbars.hasOwnProperty(toolbarId)) {
				toolbarContainer = this._toolbars[toolbarId].addToolbar(map);

				if (toolbarContainer) {
					// Add class to the first toolbar to remove the margin
					if (!addedTopClass) {
						if (!L.DomUtil.hasClass(toolbarContainer, topClassName)) {
							L.DomUtil.addClass(toolbarContainer.childNodes[0], topClassName);
						}
						addedTopClass = true;
					}

					container.appendChild(toolbarContainer);
				}
			}
		}

		return container;
	},

	onRemove: function () {
		for (var toolbarId in this._toolbars) {
			if (this._toolbars.hasOwnProperty(toolbarId)) {
				this._toolbars[toolbarId].removeToolbar();
			}
		}
	},

	setDrawingOptions: function (options) {
		for (var toolbarId in this._toolbars) {
			if (this._toolbars[toolbarId] instanceof L.DrawToolbar) {
				this._toolbars[toolbarId].setOptions(options);
			}
		}
	},

	_toolbarEnabled: function (e) {
		var enabledToolbar = e.target;

		for (var toolbarId in this._toolbars) {
			if (this._toolbars[toolbarId] !== enabledToolbar) {
				this._toolbars[toolbarId].disable();
			}
		}
	}
});

L.Map.mergeOptions({
	drawControlTooltips: true,
	drawControl: false
});

L.Map.addInitHook(function () {
	if (this.options.drawControl) {
		this.drawControl = new L.Control.Draw();
		this.addControl(this.drawControl);
	}
});


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
		for (var handlerId in this._modes) {
			if (this._modes.hasOwnProperty(handlerId)) {
				// Unbind handler button
				this._disposeButton(
					this._modes[handlerId].button,
					this._modes[handlerId].handler.enable,
					this._modes[handlerId].handler
				);

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
		for (var i = 0, l = this._actionButtons.length; i < l; i++) {
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

		this._modes[type].button = this._createButton({
			type: type,
			title: buttonTitle,
			className: classNamePredix + '-' + type,
			container: container,
			callback: this._modes[type].handler.enable,
			context: this._modes[type].handler
		});

		this._modes[type].buttonIndex = buttonIndex;

		this._modes[type].handler
			.on('enabled', this._handlerActivated, this)
			.on('disabled', this._handlerDeactivated, this);
	},

	_createButton: function (options) {

		var link = L.DomUtil.create('a', options.className || '', options.container);
		link.href = '#';

		if (options.text) {
			link.innerHTML = options.text;
		}

		if (options.title) {
			link.title = options.title;
		}

		L.DomEvent
			.on(link, 'click', L.DomEvent.stopPropagation)
			.on(link, 'mousedown', L.DomEvent.stopPropagation)
			.on(link, 'dblclick', L.DomEvent.stopPropagation)
			.on(link, 'click', L.DomEvent.preventDefault)
			.on(link, 'click', options.callback, options.context);

		return link;
	},

	_disposeButton: function (button, callback) {
		L.DomEvent
			.off(button, 'click', L.DomEvent.stopPropagation)
			.off(button, 'mousedown', L.DomEvent.stopPropagation)
			.off(button, 'dblclick', L.DomEvent.stopPropagation)
			.off(button, 'click', L.DomEvent.preventDefault)
			.off(button, 'click', callback);
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


L.Tooltip = L.Class.extend({
	initialize: function (map) {
		this._map = map;
		this._popupPane = map._panes.popupPane;

		this._container = map.options.drawControlTooltips ? L.DomUtil.create('div', 'leaflet-draw-tooltip', this._popupPane) : null;
		this._singleLineLabel = false;

		this._map.on('mouseout', this._onMouseOut, this);
	},

	dispose: function () {
		this._map.off('mouseout', this._onMouseOut, this);

		if (this._container) {
			this._popupPane.removeChild(this._container);
			this._container = null;
		}
	},

	updateContent: function (labelText) {
		if (!this._container) {
			return this;
		}
		labelText.subtext = labelText.subtext || '';

		// update the vertical position (only if changed)
		if (labelText.subtext.length === 0 && !this._singleLineLabel) {
			L.DomUtil.addClass(this._container, 'leaflet-draw-tooltip-single');
			this._singleLineLabel = true;
		}
		else if (labelText.subtext.length > 0 && this._singleLineLabel) {
			L.DomUtil.removeClass(this._container, 'leaflet-draw-tooltip-single');
			this._singleLineLabel = false;
		}

		this._container.innerHTML =
			(labelText.subtext.length > 0 ? '<span class="leaflet-draw-tooltip-subtext">' + labelText.subtext + '</span>' + '<br />' : '') +
			'<span>' + labelText.text + '</span>';

		return this;
	},

	updatePosition: function (latlng) {
		var pos = this._map.latLngToLayerPoint(latlng),
			tooltipContainer = this._container;

		if (this._container) {
			tooltipContainer.style.visibility = 'inherit';
			L.DomUtil.setPosition(tooltipContainer, pos);
		}

		return this;
	},

	showAsError: function () {
		if (this._container) {
			L.DomUtil.addClass(this._container, 'leaflet-error-draw-tooltip');
		}
		return this;
	},

	removeError: function () {
		if (this._container) {
			L.DomUtil.removeClass(this._container, 'leaflet-error-draw-tooltip');
		}
		return this;
	},

	_onMouseOut: function () {
		if (this._container) {
			this._container.style.visibility = 'hidden';
		}
	}
});


L.DrawToolbar = L.Toolbar.extend({

	statics: {
		TYPE: 'draw'
	},

	options: {
		polyline: {},
		polygon: {},
		rectangle: {},
		circle: {},
		marker: {}
	},

	initialize: function (options) {
		// Ensure that the options are merged correctly since L.extend is only shallow
		for (var type in this.options) {
			if (this.options.hasOwnProperty(type)) {
				if (options[type]) {
					options[type] = L.extend({
					  featureGroup: options.featureGroup
					}, this.options[type], options[type]);
				}
			}
		}

		this._toolbarClass = 'leaflet-draw-draw';
		L.Toolbar.prototype.initialize.call(this, options);
	},

	getModeHandlers: function (map) {
		return [
			{
				enabled: this.options.polyline,
				handler: new L.Draw.Polyline(map, this.options.polyline),
				title: L.drawLocal.draw.toolbar.buttons.polyline
			},
			{
				enabled: this.options.polygon,
				handler: new L.Draw.Polygon(map, this.options.polygon),
				title: L.drawLocal.draw.toolbar.buttons.polygon
			},
			{
				enabled: this.options.rectangle,
				handler: new L.Draw.Rectangle(map, this.options.rectangle),
				title: L.drawLocal.draw.toolbar.buttons.rectangle
			},
			{
				enabled: this.options.circle,
				handler: new L.Draw.Circle(map, this.options.circle),
				title: L.drawLocal.draw.toolbar.buttons.circle
			},
			{
				enabled: this.options.marker,
				handler: new L.Draw.Marker(map, this.options.marker),
				title: L.drawLocal.draw.toolbar.buttons.marker
			}
		];
	},

	// Get the actions part of the toolbar
	getActions: function (handler) {
		return [
			{
				enabled: handler.completeShape,
				title: L.drawLocal.draw.toolbar.finish.title,
				text: L.drawLocal.draw.toolbar.finish.text,
				callback: handler.completeShape,
				context: handler
			},
			{
				enabled: handler.deleteLastVertex,
				title: L.drawLocal.draw.toolbar.undo.title,
				text: L.drawLocal.draw.toolbar.undo.text,
				callback: handler.deleteLastVertex,
				context: handler
			},
			{
				title: L.drawLocal.draw.toolbar.actions.title,
				text: L.drawLocal.draw.toolbar.actions.text,
				callback: this.disable,
				context: this
			}
		];
	},

	setOptions: function (options) {
		L.setOptions(this, options);

		for (var type in this._modes) {
			if (this._modes.hasOwnProperty(type) && options.hasOwnProperty(type)) {
				this._modes[type].handler.setOptions(options[type]);
			}
		}
	}
});


/*L.Map.mergeOptions({
	editControl: true
});*/

L.EditToolbar = L.Toolbar.extend({
	statics: {
		TYPE: 'edit'
	},

	options: {
		edit: {
			selectedPathOptions: {
				dashArray: '10, 10',

				fill: true,
				fillColor: '#fe57a1',
				fillOpacity: 0.1,

				// Whether to user the existing layers color
				maintainColor: false
			}
		},
		remove: {},
		split: {},
		erase: {},
		featureGroup: null /* REQUIRED! TODO: perhaps if not set then all layers on the map are selectable? */
	},

	initialize: function (options) {
		// Need to set this manually since null is an acceptable value here
		if (options.edit) {
			if (typeof options.edit.selectedPathOptions === 'undefined') {
				options.edit.selectedPathOptions = this.options.edit.selectedPathOptions;
			}
			options.edit.selectedPathOptions = L.extend({}, this.options.edit.selectedPathOptions, options.edit.selectedPathOptions);
		}

		if (options.remove) {
			options.remove = L.extend({}, this.options.remove, options.remove);
		}

		this._toolbarClass = 'leaflet-draw-edit';
		L.Toolbar.prototype.initialize.call(this, options);

		this._selectedFeatureCount = 0;
	},

	getModeHandlers: function (map) {
		var featureGroup = this.options.featureGroup;
		return [
			{
				enabled: this.options.split,
				handler: new L.EditToolbar.Split(map, {
					featureGroup: featureGroup
				}),
				title: L.drawLocal.edit.toolbar.buttons.split
			},
			{
				enabled: this.options.edit,
				handler: new L.EditToolbar.Edit(map, {
					featureGroup: featureGroup,
					selectedPathOptions: this.options.edit.selectedPathOptions
				}),
				title: L.drawLocal.edit.toolbar.buttons.edit
			},
			{
				enabled: this.options.erase,
				handler: new L.EditToolbar.Erase(map, {
					featureGroup: featureGroup,
				}),
				title: L.drawLocal.edit.toolbar.buttons.erase
			},
			{
				enabled: this.options.remove,
				handler: new L.EditToolbar.Delete(map, {
					featureGroup: featureGroup
				}),
				title: L.drawLocal.edit.toolbar.buttons.remove
			}
		];
	},

	getActions: function () {
		return [
			{
				title: L.drawLocal.edit.toolbar.actions.save.title,
				text: L.drawLocal.edit.toolbar.actions.save.text,
				callback: this._save,
				context: this
			},
			{
				title: L.drawLocal.edit.toolbar.actions.cancel.title,
				text: L.drawLocal.edit.toolbar.actions.cancel.text,
				callback: this.disable,
				context: this
			}
		];
	},

	addToolbar: function (map) {
		var container = L.Toolbar.prototype.addToolbar.call(this, map);

		this._checkDisabled();

		this.options.featureGroup.on('layeradd layerremove', this._checkDisabled, this);

		return container;
	},

	removeToolbar: function () {
		this.options.featureGroup.off('layeradd layerremove', this._checkDisabled, this);

		L.Toolbar.prototype.removeToolbar.call(this);
	},

	disable: function () {
		if (!this.enabled()) { return; }

		this._activeMode.handler.revertLayers();

		L.Toolbar.prototype.disable.call(this);
	},

	_save: function () {
		this._activeMode.handler.save();
		this._activeMode.handler.disable();
	},

	_checkDisabled: function () {
		var featureGroup = this.options.featureGroup,
			hasLayers = featureGroup.getLayers().length !== 0,
			button;

		if (this.options.edit) {
			button = this._modes[L.EditToolbar.Edit.TYPE].button;

			if (hasLayers) {
				L.DomUtil.removeClass(button, 'leaflet-disabled');
			} else {
				L.DomUtil.addClass(button, 'leaflet-disabled');
			}

			button.setAttribute(
				'title',
				hasLayers ?
				L.drawLocal.edit.toolbar.buttons.edit
				: L.drawLocal.edit.toolbar.buttons.editDisabled
			);
		}

		if (this.options.remove) {
			button = this._modes[L.EditToolbar.Delete.TYPE].button;

			if (hasLayers) {
				L.DomUtil.removeClass(button, 'leaflet-disabled');
			} else {
				L.DomUtil.addClass(button, 'leaflet-disabled');
			}

			button.setAttribute(
				'title',
				hasLayers ?
				L.drawLocal.edit.toolbar.buttons.remove
				: L.drawLocal.edit.toolbar.buttons.removeDisabled
			);
		}
	}
});


L.EditToolbar.Handler = L.Handler.extend({
	includes: L.Mixin.Events,

	revertLayers: function () {
		this._featureGroup.eachLayer(function (layer) {
			this._revertLayer(layer);
		}, this);
	},

	_revertLayer: function (layer) {
		var id = L.Util.stamp(layer);
		layer.edited = false;
		if (this._uneditedLayerProps.hasOwnProperty(id)) {
			// Polyline, Polygon or Rectangle
			if (layer instanceof L.Polyline || layer instanceof L.Polygon || layer instanceof L.Rectangle ||
			  layer instanceof L.Segment) {
				layer.setLatLngs(this._uneditedLayerProps[id].latlngs);
			} else if (layer instanceof L.Circle) {
				layer.setLatLng(this._uneditedLayerProps[id].latlng);
				layer.setRadius(this._uneditedLayerProps[id].radius);
			} else if (layer instanceof L.Marker) { // Marker
				layer.setLatLng(this._uneditedLayerProps[id].latlng);
			}

			layer.fire('revert-edited', { layer: layer });
		}
	},

	_backupLayer: function (layer) {
		var id = L.Util.stamp(layer);

		if (!this._uneditedLayerProps[id]) {
			// Polyline, Polygon or Rectangle
			if (layer instanceof L.Polyline || layer instanceof L.Polygon || layer instanceof L.Rectangle ||
			  layer instanceof L.Segment) {
				this._uneditedLayerProps[id] = {
					latlngs: L.LatLngUtil.cloneLatLngs(layer.getLatLngs())
				};
			} else if (layer instanceof L.Circle) {
				this._uneditedLayerProps[id] = {
					latlng: L.LatLngUtil.cloneLatLng(layer.getLatLng()),
					radius: layer.getRadius()
				};
			} else if (layer instanceof L.Marker) { // Marker
				this._uneditedLayerProps[id] = {
					latlng: L.LatLngUtil.cloneLatLng(layer.getLatLng())
				};
			}
		}
	},

	_getTooltipText: function () {
		return ({
			text: L.drawLocal.edit.handlers.split.tooltip.text,
			subtext: L.drawLocal.edit.handlers.split.tooltip.subtext
		});
	},

	_updateTooltip: function () {
		this._tooltip.updateContent(this._getTooltipText());
	},

	_hasAvailableLayers: function () {
		return this._featureGroup.getLayers().length > 0;
	},

});


L.EditToolbar.Edit = L.EditToolbar.Handler.extend({
	statics: {
		TYPE: 'edit'
	},

	includes: L.Mixin.Events,

	initialize: function (map, options) {
		L.Handler.prototype.initialize.call(this, map);

		L.setOptions(this, options);

		// Store the selectable layer group for ease of access
		this._featureGroup = options.featureGroup;

		if (!(this._featureGroup instanceof L.FeatureGroup)) {
			throw new Error('options.featureGroup must be a L.FeatureGroup');
		}

		this._uneditedLayerProps = {};

		// Save the type so super can fire, need to do this as cannot do this.TYPE :(
		this.type = L.EditToolbar.Edit.TYPE;
	},

	enable: function () {
		if (this._enabled || !this._hasAvailableLayers()) {
			return;
		}
		this.fire('enabled', {handler: this.type});
		  //this disable other handlers

		this._map.fire('draw:editstart', { handler: this.type });
		  //allow drawLayer to be updated before beginning edition.

		L.Handler.prototype.enable.call(this);
		this._featureGroup
			.on('layeradd', this._enableLayerEdit, this)
			.on('layerremove', this._disableLayerEdit, this);
	},

	disable: function () {
		if (!this._enabled) { return; }
		this._featureGroup
		  .off('layeradd', this._enableLayerEdit, this)
		  .off('layerremove', this._disableLayerEdit, this);
		L.Handler.prototype.disable.call(this);
		this._map.fire('draw:editstop', { handler: this.type });
		this.fire('disabled', {handler: this.type});
	},

	addHooks: function () {
		var map = this._map;

		if (map) {
			map.getContainer().focus();

			this._featureGroup.eachLayer(this._enableLayerEdit, this);

			this._tooltip = new L.Tooltip(this._map);
			this._updateTooltip();

			this._map
			  .on('mousemove', this._onMouseMove, this)
			  .on('touchmove', this._onMouseMove, this)
			  .on('MSPointerMove', this._onMouseMove, this)
			  .on('draw:editvertex', this._updateTooltip, this);
		}
	},

	removeHooks: function () {
		if (this._map) {
			// Clean up selected layers.
			this._featureGroup.eachLayer(this._disableLayerEdit, this);

			// Clear the backups of the original layers
			this._uneditedLayerProps = {};

			this._tooltip.dispose();
			this._tooltip = null;

			this._map
			  .off('mousemove', this._onMouseMove, this)
			  .off('touchmove', this._onMouseMove, this)
			  .off('MSPointerMove', this._onMouseMove, this)
			  .off('draw:editvertex', this._updateTooltip, this);
		}
	},

	revertLayers: function () {
		this._featureGroup.eachLayer(function (layer) {
			this._revertLayer(layer);
		}, this);
	},

	save: function () {
		var editedLayers = new L.LayerGroup();
		this._featureGroup.eachLayer(function (layer) {
			if (layer.edited) {
				editedLayers.addLayer(layer);
				layer.edited = false;
			}
		});
		this._map.fire('draw:edited', {layers: editedLayers});
	},

	_getTooltipText: function () {
		return ({
			text: L.drawLocal.edit.handlers.edit.tooltip.text,
			subtext: L.drawLocal.edit.handlers.edit.tooltip.subtext
		});
	},

	_enableLayerEdit: function (e) {
		var layer = e.layer || e.target || e,
			pathOptions;

		// Back up this layer (if haven't before)
		this._backupLayer(layer);

		// Set different style for editing mode
		if (this.options.selectedPathOptions) {
			pathOptions = L.Util.extend({}, this.options.selectedPathOptions);

			// Use the existing color of the layer
			if (pathOptions.maintainColor) {
				pathOptions.color = layer.options.color;
				pathOptions.fillColor = layer.options.fillColor;
			}

			layer.options.original = L.extend({}, layer.options);
			layer.options.editing = pathOptions;
		}

		layer.editing.enable();
	},

	_disableLayerEdit: function (e) {
		var layer = e.layer || e.target || e;

		layer.edited = false;
		layer.editing.disable();

		delete layer.options.editing;
		delete layer.options.original;
		// Reset layer styles to that of before select
		if (this._selectedPathOptions) {
			if (layer instanceof L.Marker) {
				this._toggleMarkerHighlight(layer);
			} else {
				// reset the layer style to what is was before being selected
				layer.setStyle(layer.options.previousOptions);
				// remove the cached options for the layer object
				delete layer.options.previousOptions;
			}
		}

		layer.editing.disable();
	},

	_onMouseMove: function (e) {
		this._tooltip.updatePosition(e.latlng);
	},

	_onTouchMove: function (e) {
		var touchEvent = e.originalEvent.changedTouches[0],
			layerPoint = this._map.mouseEventToLayerPoint(touchEvent),
			latlng = this._map.layerPointToLatLng(layerPoint);
		e.target.setLatLng(latlng);
	},

	_hasAvailableLayers: function () {
		return this._featureGroup.getLayers().length !== 0;
	},

	_onMarkerDragEnd: function (e) {
		e.target.edited = true;
	}
});


L.EditToolbar.Delete = L.Handler.extend({
	statics: {
		TYPE: 'remove' // not delete as delete is reserved in js
	},

	includes: L.Mixin.Events,

	initialize: function (map, options) {
		L.Handler.prototype.initialize.call(this, map);

		L.Util.setOptions(this, options);

		// Store the selectable layer group for ease of access
		this._deletableLayers = this.options.featureGroup;

		if (!(this._deletableLayers instanceof L.FeatureGroup)) {
			throw new Error('options.featureGroup must be a L.FeatureGroup');
		}

		// Save the type so super can fire, need to do this as cannot do this.TYPE :(
		this.type = L.EditToolbar.Delete.TYPE;
	},

	enable: function () {
		if (this._enabled || !this._hasAvailableLayers()) {
			return;
		}
		this.fire('enabled', { handler: this.type});

		this._map.fire('draw:deletestart', { handler: this.type });

		L.Handler.prototype.enable.call(this);

		this._deletableLayers
			.on('layeradd', this._enableLayerDelete, this)
			.on('layerremove', this._disableLayerDelete, this);
	},

	disable: function () {
		if (!this._enabled) { return; }

		this._deletableLayers
			.off('layeradd', this._enableLayerDelete, this)
			.off('layerremove', this._disableLayerDelete, this);

		L.Handler.prototype.disable.call(this);

		this._map.fire('draw:deletestop', { handler: this.type });

		this.fire('disabled', { handler: this.type});
	},

	addHooks: function () {
		var map = this._map;

		if (map) {
			map.getContainer().focus();

			this._deletableLayers.eachLayer(this._enableLayerDelete, this);
			this._deletedLayers = new L.LayerGroup();

			this._tooltip = new L.Tooltip(this._map);
			this._tooltip.updateContent({ text: L.drawLocal.edit.handlers.remove.tooltip.text });

			this._map.on('mousemove', this._onMouseMove, this);
		}
	},

	removeHooks: function () {
		if (this._map) {
			this._deletableLayers.eachLayer(this._disableLayerDelete, this);
			this._deletedLayers = null;

			this._tooltip.dispose();
			this._tooltip = null;

			this._map.off('mousemove', this._onMouseMove, this);
		}
	},

	revertLayers: function () {
		// Iterate of the deleted layers and add them back into the featureGroup
		this._deletedLayers.eachLayer(function (layer) {
			this._deletableLayers.addLayer(layer);
			layer.fire('revert-deleted', { layer: layer });
		}, this);
	},

	save: function () {
	  this._deletedLayers.eachLayer(function(layer) {
	    layer.fire('deleted', layer);
	  });
		this._map.fire('draw:deleted', { layers: this._deletedLayers });
	},

	_enableLayerDelete: function (e) {
		var layer = e.layer || e.target || e;

		layer.on('click', this._removeLayer, this);
	},

	_disableLayerDelete: function (e) {
		var layer = e.layer || e.target || e;

		layer.off('click', this._removeLayer, this);

		// Remove from the deleted layers so we can't accidentally revert if the user presses cancel
		this._deletedLayers.removeLayer(layer);
	},

	_removeLayer: function (e) {
		var layer = e.layer || e.target || e;
		var _this = this;

		this._deletableLayers.removeLayer(layer);

		this._deletedLayers.addLayer(layer);

        if (layer.properties && layer.properties.type === 'track') {
          var id = layer.properties.id || layer.properties.cid;
          if (id) {
            this._deletableLayers.eachLayer(function(_layer) {
              var _id;
              if (_layer.properties) {
                _id = _layer.properties.track || _layer.properties.track_cid
              }
              if (id === _id) {
                _this._deletableLayers.removeLayer(_layer);
		        _this._deletedLayers.addLayer(_layer);
              }
            });
          }
        }

		layer.fire('deleted');
	},

	_onMouseMove: function (e) {
		this._tooltip.updatePosition(e.latlng);
	},

	_hasAvailableLayers: function () {
		return this._deletableLayers.getLayers().length !== 0;
	}
});


L.EditToolbar.Split = L.EditToolbar.Handler.extend({
	statics: {
		TYPE: 'split'
	},

	includes: L.Mixin.Events,

	initialize: function (map, options) {
		L.Handler.prototype.initialize.call(this, map);

		L.setOptions(this, options);

		// Store the selectable layer group for ease of access
		this._featureGroup = options.featureGroup;

		if (!(this._featureGroup instanceof L.FeatureGroup)) {
			throw new Error('options.featureGroup must be a L.FeatureGroup');
		}

		this._uneditedLayerProps = {};

		// Save the type so super can fire, need to do this as cannot do this.TYPE :(
		this.type = L.EditToolbar.Split.TYPE;
	},

	enable: function () {
		if (this._enabled || !this._hasAvailableLayers()) {
			return;
		}
		this.fire('enabled', {handler: this.type});
		  //this disable other handlers

		this._map.fire('draw:editstart', { handler: this.type });
		  //allow drawLayer to be updated before beginning edition.

		L.Handler.prototype.enable.call(this);
		this._featureGroup
			.on('layeradd', this._enableLayerSplit, this)
			.on('layerremove', this._disableLayerSplit, this);
	},

	disable: function () {
		if (!this._enabled) { return; }
		this._featureGroup
			.off('layeradd', this._enableLayerSplit, this)
			.off('layerremove', this._disableLayerSplit, this);
		L.Handler.prototype.disable.call(this);
		this._map.fire('draw:editstop', { handler: this.type });
		this.fire('disabled', {handler: this.type});
		this._removeSplitPoints();

		if (this._tempLine) {
		  this._removeTempLine();
		}
	},

	addHooks: function () {
		if (this._map) {
			this._map.getContainer().focus();
			this._featureGroup.eachLayer(this._enableLayerSplit, this);
			this._tooltip = new L.Tooltip(this._map);
			this._updateTooltip();

			this._map
				.on('mousemove', this._onMouseMove, this)
				.on('touchmove', this._onMouseMove, this)
				.on('MSPointerMove', this._onMouseMove, this)
				.on('click', this._onMouseClick, this)
				.on('zoomend', this._onZoomEnd, this);
		}
	},

	removeHooks: function () {
		if (this._map) {
			// Clean up selected layers.
			this._featureGroup.eachLayer(this._disableLayerSplit, this);

			// Clear the backups of the original layers
			this._uneditedLayerProps = {};

			this._tooltip.dispose();
			this._tooltip = null;

			this._map
				.off('mousemove', this._onMouseMove, this)
				.off('touchmove', this._onMouseMove, this)
				.off('MSPointerMove', this._onMouseMove, this)
				.off('click', this._onMouseClick, this)
				.off('zoomend', this._onZoomEnd, this);
		}
	},

	revertLayers: function () {
		this._featureGroup.eachLayer(function (layer) {
			this._revertLayer(layer);
		}, this);
	},

	save: function () {
		var editedLayers = new L.LayerGroup();
		this._featureGroup.eachLayer(function (layer) {
			if (layer.edited) {
				editedLayers.addLayer(layer);
				layer.edited = false;
				layer.properties = layer.properties || {};
				layer.properties.type = 'segment';
			}
		});
		this._map.fire('draw:splitted', {layers: editedLayers});
	},

	_getTooltipText: function () {
		return ({
			text: L.drawLocal.edit.handlers.split.tooltip.text,
			subtext: L.drawLocal.edit.handlers.split.tooltip.subtext
		});
	},

	_enableLayerSplit: function (e) {
		var layer = e.layer || e.target || e;
		// Back up this layer (if haven't before)
		this._backupLayer(layer);
	},

	_disableLayerSplit: function (e) {
		var layer = e.layer || e.target || e;

		layer.edited = false;

		delete layer.options.editing;
		delete layer.options.original;
		// Reset layer styles to that of before select
		if (this._selectedPathOptions) {
			if (layer instanceof L.Marker) {
				this._toggleMarkerHighlight(layer);
			} else {
				// reset the layer style to what is was before being selected
				layer.setStyle(layer.options.previousOptions);
				// remove the cached options for the layer object
				delete layer.options.previousOptions;
			}
		}
	},

	_onZoomEnd: function () {
		if (this._splitPoint) {
			this._drawSplitPoint(this._splitPoint);
		}

		if (this._firstSplitPoint) {
			this._drawSplitPoint(this._firstSplitPoint);
		}
	},

	_removeSplitPoints: function () {
		if (this._splitPoint) {
			this._map._pathRoot.removeChild(this._splitPoint.vertex);
			this._splitPoint = null;
		}

		if (this._firstSplitPoint) {
			this._map._pathRoot.removeChild(this._firstSplitPoint.vertex);
			this._firstSplitPoint = null;
		}
	},

	_onMouseMove: function (e) {
		this._tooltip.updatePosition(e.latlng);
		var latlng = e.latlng,
			splitPoint = this._getSplitPoint(latlng),
			templine,
			layer;

		if (this._splitPoint) {
			this._splitPoint.vertex.onmouseclick = null;
			this._map._pathRoot.removeChild(this._splitPoint.vertex);
			this._splitPoint = null;
		}

		if (this._tempLine) {
			this._removeTempLine();
		}

		if (!splitPoint) {
			return; //too far
		}

		this._splitPoint = this._drawSplitPoint(splitPoint);

		if (this._firstSplitPoint) {

			if (this._firstSplitPoint.layer !== this._splitPoint.layer) {
				return;
			}

			templine = this._getSegment(this._firstSplitPoint, this._splitPoint);
			if (!templine) {
				return;
			}

			layer = this._firstSplitPoint.layer;
			if (layer && layer.properties) {
				templine.properties = {
				  track: layer.properties.id,
				  track_cid: layer.properties.cid
				 };
			}

			this._addTempLine(templine);
		}
	},

	_onMouseClick: function () {
		if (this._splitPoint && !this._firstSplitPoint) {
			this._startSplit();
		} else {

			if (this._splitPoint && this._firstSplitPoint) {
				if (this._tempLine) {
					this._tempLine.edited = true;
					this.save();
					this._removeTempLine();
					this._removeSplitPoints();
					this.disable();
				}
			}
		}

	},

	_onTouchMove: function () {
//        var touchEvent = e.originalEvent.changedTouches[0],
//            layerPoint = this._map.mouseEventToLayerPoint(touchEvent),
//            latlng = this._map.layerPointToLatLng(layerPoint);
	},

	_startSplit: function () {
		this._firstSplitPoint = this._splitPoint;
		this._splitPoint = null;
	},

	_getSegment: function (start, end) {
		var layer = start.layer,
			startIndex = start.index,
			endIndex = end.index,
			segment = [],
			firstPoint = start.latlng,
			endPoint = end.latlng,
			latlngs = [];

		if (startIndex > endIndex) {
			startIndex = startIndex + endIndex;
			endIndex = startIndex - endIndex;
			startIndex = startIndex - endIndex;
			firstPoint = end;
			endPoint = start;
		}
		segment.push(firstPoint);

		latlngs = layer.getLatLngs().slice(startIndex, endIndex);
		segment = segment.concat(latlngs);
		segment.push(endPoint);

		return L.segment(segment);

	},

	_getSplitPoint: function (latlng) {
		var closest = null,
			_this = this,
			_layer = null,
			_index,
			temp;

		if (!this._firstSplitPoint) {
			this._featureGroup.eachLayer(function (layer) {
				if (layer instanceof L.Polyline) {
					temp = _this.closestLayerPoint(latlng, layer);
					if (!closest || closest.distance > temp.distance) {
						closest = temp;
						_layer = layer;
						_index = closest.index;
					}
				}
			});
		} else {
			closest = _this.closestLayerPoint(latlng, this._firstSplitPoint.layer);
			_layer = this._firstSplitPoint.layer;
			_index = closest.index;
		}

		if (closest && closest.distance < 20) {
			return {
			  latlng: closest,
			  layer: _layer,
			  index: _index
			};
		}
		return null;
	},

	_drawSplitPoint: function (splitPoint) {
		var latlng = splitPoint.latlng;
		if (splitPoint.vertex) {
			this._map._pathRoot.removeChild(splitPoint.vertex);
		}

		var namespace = 'http://www.w3.org/2000/svg',
			point = this._map.latLngToLayerPoint(latlng),
			vertex;

		vertex = document.createElementNS(namespace, 'circle');
		vertex.setAttributeNS(null, 'r', 5);
		vertex.setAttributeNS(null, 'cx', point.x);
		vertex.setAttributeNS(null, 'cy', point.y);
		vertex.setAttributeNS(null, 'fill', '#00ff00');
		vertex.setAttributeNS(null, 'fill-opacity', splitPoint.layer.options.opacity);

		splitPoint.vertex = vertex;
		splitPoint.point = point;
		this._map._pathRoot.appendChild(vertex);
		return splitPoint;
	},

	_addTempLine: function (polyline) {
		polyline.setStyle({weight: 10, color: '#b8860b'});
		polyline.addTo(this._featureGroup);
		polyline.on('click', L.bind(this._onMouseClick, this));
		this._tempLine = polyline;
		return this;
	},

	_removeTempLine: function () {
		this._tempLine.off('click', null, null, null);
		this._featureGroup.removeLayer(this._tempLine);
		this._tempLine = null;
		return this;
	},

	closestLayerPoint: function () {
		return L.Edit.SegmentVerticesEdit.prototype.closestLayerPoint.apply(this,arguments);
	},

});


L.EditToolbar.Erase = L.EditToolbar.Handler.extend({
	statics: {
		TYPE: 'erase'
	},

	includes: L.Mixin.Events,

	initialize: function (map, options) {
		L.Handler.prototype.initialize.call(this, map);

		L.setOptions(this, options);

		// Store the selectable layer group for ease of access
		this._featureGroup = options.featureGroup;

		if (!(this._featureGroup instanceof L.FeatureGroup)) {
			throw new Error('options.featureGroup must be a L.FeatureGroup');
		}

		this._uneditedLayerProps = {};

		// Save the type so super can fire, need to do this as cannot do this.TYPE :(
		this.type = L.EditToolbar.Erase.TYPE;
	},

	enable: function () {
		if (this._enabled || !this._hasAvailableLayers()) {
			return;
		}
		this.fire('enabled', {handler: this.type});
		  //this disable other handlers

		this._map.fire('draw:editstart', { handler: this.type });
		  //allow drawLayer to be updated before beginning edition.

		L.Handler.prototype.enable.call(this);

		var _this = this;
		this._featureGroup.eachLayer(function(layer) {
		  _this._backupLayer(layer);
		});
	},

	disable: function () {
		if (!this._enabled) { return; }

		L.Handler.prototype.disable.call(this);
		this._map.fire('draw:editstop', { handler: this.type });
		this.fire('disabled', {handler: this.type});
	},

	addHooks: function () {
		if (this._map) {
			this._map.getContainer().focus();
			this._tooltip = new L.Tooltip(this._map);
			this._updateTooltip();

			this._map
				.on('mousemove', this._onMouseMove, this)
				.on('touchmove', this._onMouseMove, this)
				.on('MSPointerMove', this._onMouseMove, this)
				.on('mousedown', this._onMouseDown, this)
				.on('mouseup', this._onMouseUp, this);
		}
	},

	removeHooks: function () {
		if (this._map) {
			this._uneditedLayerProps = {};

			this._tooltip.dispose();
			this._tooltip = null;

			this._map
				.off('mousemove', this._onMouseMove, this)
				.off('touchmove', this._onMouseMove, this)
				.off('MSPointerMove', this._onMouseMove, this)
				.off('mousedown', this._onMouseDown, this)
				.off('mouseup', this._onMouseUp, this);

			if (this.erasePoint) {
				this._map._pathRoot.removeChild(this.erasePoint);
				this.erasePoint = null;
			}
		}
	},

	save: function () {
		var editedLayers = new L.LayerGroup();
		var deletedLayers = new L.LayerGroup();
		var _this = this;

		this._featureGroup.eachLayer(function (layer) {
			if (layer.edited && !layer.deleted) {
				editedLayers.addLayer(layer);
				layer.edited = false;
				layer.fire('changed', { layer: layer });
			}

			if (layer.deleted) {
				_this._featureGroup.removeLayer(layer);
				deletedLayers.addLayer(layer);
				layer.edited = false;
				  layer.fire('deleted', layer);
			}
		});
		this._map.fire('draw:edited', {layers: editedLayers});
		this._map.fire('draw:deleted', {layers: deletedLayers});
	},

	_getTooltipText: function () {
		return ({
			text: L.drawLocal.edit.handlers.erase.tooltip.text,
			subtext: L.drawLocal.edit.handlers.erase.tooltip.subtext
		});
	},

	_onMouseMove: function (e) {
		this._tooltip.updatePosition(e.latlng);
		var latlng = e.latlng;

		this._showErasePoint(latlng);

		if (this._erasing) {
		  this.erase(latlng);
		}
	},

	_onMouseDown: function (e) {
	  if (e.originalEvent.button === 2) {
		this._erasing = true;
	  }
	},

	_onMouseUp: function (e) {
	  if (e.originalEvent.button === 2) {
		this.erase(e.latlng);
		this._erasing = false;
	  }
	},

	_onTouchMove: function () {
//        var touchEvent = e.originalEvent.changedTouches[0],
//            layerPoint = this._map.mouseEventToLayerPoint(touchEvent),
//            latlng = this._map.layerPointToLatLng(layerPoint);
	},

	erase: function (latlng) {
		var _this = this,
			p;

		p = this._map.latLngToLayerPoint(latlng);

		this._featureGroup.eachLayer(function (layer) {
			if (layer instanceof L.Polyline) {
				var latlngs = layer.getLatLngs();
				for (var i = 0, len = latlngs.length; i < len; i++) {
					var p2 = latlngs[i];
					if (!p2) {
					  break;
					}

					p2 = _this._map.latLngToLayerPoint(p2);
					var sqDist = L.LineUtil._sqDist(p, p2);

					if (sqDist < 80) {
					  latlngs.splice(i,1);

					  if (latlngs.length > 1) {
						layer.edited = true;
						layer.setLatLngs(latlngs);
					  } else {
						layer.deleted = true;
						layer.setLatLngs([]);
					  }
					}
				}
			}
		});

		return this;
	},

	_showErasePoint: function (latlng) {
		if (this.erasePoint) {
			this._map._pathRoot.removeChild(this.erasePoint);
		}
		this.erasePoint = this._drawErasePoint(latlng);
		return this;
	},

	_drawErasePoint: function (latlng) {
		var namespace = 'http://www.w3.org/2000/svg',
			vertex = document.createElementNS('http://www.w3.org/2000/svg', 'circle'),
			point = this._map.latLngToLayerPoint(latlng);

		vertex = document.createElementNS(namespace, 'circle');
		vertex.setAttributeNS(null, 'r', 20);
		vertex.setAttributeNS(null, 'cx', point.x);
		vertex.setAttributeNS(null, 'cy', point.y);
		vertex.setAttributeNS(null, 'fill', '#00ff00');
		vertex.setAttributeNS(null, 'fill-opacity', 0.3);
		this._map._pathRoot.appendChild(vertex);
		return vertex;
	},

});


}(window, document));