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

	modes: {},

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

		this.modes = {
            auto: {
                name: 'auto',
                title: L.drawLocal.draw.handlers.polyline.modes.auto,
                callback: this._toggleAutoMode
            },

            bus: {
                name: 'bus',
                title: L.drawLocal.draw.handlers.polyline.modes.bus,
                callback: this._toggleBusMode
            },

            bicycle: {
                name: 'bicycle',
                title: L.drawLocal.draw.handlers.polyline.modes.bicycle,
                callback: this._toggleBicycleMode
            },

            pedestrian: {
                name: 'pedestrian',
                title: L.drawLocal.draw.handlers.polyline.modes.pedestrian,
                callback: this._togglePedestrianMode
            },

            transit: {
                name: 'transit',
                title: L.drawLocal.draw.handlers.polyline.modes.transit,
                callback: this._toggleTransitMode
            }
        };

		L.Draw.Feature.prototype.initialize.call(this, map, options);
	},

	addHooks: function () {
		var _this = this;
		L.Draw.Feature.prototype.addHooks.call(this);
		if (this._map) {
			this._markers = [];

			this._markerGroup = new L.LayerGroup();
			this._map.addLayer(this._markerGroup);

			this._segmentGroup = new L.LayerGroup();
			this._map.addLayer(this._segmentGroup);

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

		this._counter = 0;

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

	    this._map.removeLayer(this._segmentGroup);
	    delete this._segmentGroup;

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
		if (this._counter < 1) {
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
		    var distance = L.point(e.originalEvent.clientX, e.originalEvent.clientY)
				    .distanceTo(this._mouseDownOrigin);

            if (Math.abs(distance) >= 9 * (window.devicePixelRatio || 1)) {
              this._mouseDownOrigin = null;
              return;
            }

			if ((e.originalEvent.ctrlKey && this._markers.length) ||
			    (this._markers.length && this._activeMode)) {
				this._fireRouteRequest(e.latlng);
			} else {
                this.addVertex(e.latlng);
                this._counter++;
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
	  e.handler = this;
      this._map.fire('contextmenu', e);
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
	    var latlng = e.target.getLatLng();
		if (e.originalEvent.button === 2) {
			return;
		}
		if (this._mouseDownOrigin) {
		    if (!this._markers.length) {
		      this.addVertex(latlng);
		      this._mouseDownOrigin = null;
		      return;
		    }

		    var markers = this._markers,
                last = markers[markers.length - 1],
                lastLatlng = last.getLatLng();

			if (e.originalEvent.ctrlKey || this._activeMode) {
				this._fireRouteRequest(latlng, lastLatlng);
			} else {
				this.addVertex(latlng);
				this.addSegment([lastLatlng, latlng]);
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
		this._map.fire('draw:created', {
		  layer: poly,
		  layerType: this.type,
		  segments: this._segmentGroup
		});
	},

	_addContinueHandler: function (layer) {
		if (layer instanceof L.Polyline && !(layer instanceof L.Segment)) {
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

	_appendLatlngs: function(latlngs) {
        for (var i=0; i<latlngs.length;i++) {
            this.addVertex(latlngs[i]);
        }
	},

	_fireRouteRequest: function(latlng, lastLatlng) {
		var markers = this._markers,
			last = markers[markers.length - 1],
			latLngs = [last.getLatLng(), latlng],
			_this = this;

		this._map.fireEvent('request:route', {
			latLngs: latLngs,
			callback: function(latlngs) {
				latlngs.splice(0,1);
				_this._appendLatlngs(latlngs);

				if (lastLatlng) {
				  _this.addSegment(latlngs);
				}
			},
			mode: _this._activeMode ? _this._activeMode.name : 'auto'
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

		if (e.originalEvent.originalEvent.ctrlKey || this._activeMode) {
			this._map.fireEvent('request:route', {
				latLngs: [_latLngs[_latLngs.length-1], e.latlng],
				callback: function(latlngs) {
					if (latlngs.length > 3) {
						_this._appendLatlngs(latlngs.splice(1,latlngs.length - 2));
					}
					continuePolyline(_this, latLngsToAdd, finishShape);
				},
				mode: _this._activeMode ? _this._activeMode.name : 'auto'

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
	},

	addSegment: function(latlngs) {
	  var segment = L.segment(latlngs);
      segment.addTo(this._segmentGroup);
      segment.edited = true;
      segment._track = this._poly;
      segment.setStyle({
        weight: 4,
        color: '#ffffff',
        opacity: 0.5
      });
      segment.bringToFront();
      segment.properties = {
        type: 'segment'
      };
      return segment;
	},

	_toggleMode: function(newmode) {
	  if (this._activeMode) {
	    this.fire('disabled:'+this._activeMode.name, this._activeMode);
	  }
	  if (this._activeMode === newmode) {
	    this._activeMode = null;
	  } else if (newmode) {
	    this._activeMode = newmode;
	    this.fire('enabled:'+newmode.name, newmode);
	  }
	},

	_setMode: function(newmode) {
	  if (this._activeMode) {
	    this.fire('disabled:'+this._activeMode.name, this._activeMode);
	  }
	  if (!newmode) {
	    this._activeMode = null;
	  } else {
	    this._activeMode = newmode;
	    this.fire('enabled:'+newmode.name, newmode);
	  }
	},

    _toggleAutoMode: function() {
        this._toggleMode(this.modes.auto);
    },

    _toggleBusMode: function() {
        this._toggleMode(this.modes.bus);
    },

    _toggleBicycleMode: function() {
        this._toggleMode(this.modes.bicycle);
    },

    _togglePedestrianMode: function() {
        this._toggleMode(this.modes.pedestrian);
    },

    _toggleTransitMode: function() {
        this._toggleMode(this.modes.transit);
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
