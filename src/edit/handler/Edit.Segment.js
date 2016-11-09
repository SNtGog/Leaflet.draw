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
			firstPoint = end.latlng;
			endPoint = start.latlng;
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