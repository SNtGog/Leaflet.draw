L.EditToolbar.Split = L.Handler.extend({
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
        .on('click', this._onMouseClick, this);
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
        .off('click', this._onMouseClick, this);
    }
  },

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
      if (layer instanceof L.Polyline || layer instanceof L.Polygon || layer instanceof L.Rectangle) {
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

  save: function () {
    var editedLayers = new L.LayerGroup();
    this._featureGroup.eachLayer(function (layer) {
      if (layer.edited) {
        editedLayers.addLayer(layer);
        layer.edited = false;
      }
    });
    this._map.fire('draw:splitted', {layers: editedLayers});
  },

  _backupLayer: function (layer) {
    var id = L.Util.stamp(layer);

    if (!this._uneditedLayerProps[id]) {
      // Polyline, Polygon or Rectangle
      if (layer instanceof L.Polyline || layer instanceof L.Polygon || layer instanceof L.Rectangle) {
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
    return this._featureGroup.getLayers().length !== 0;
  },

  _enableLayerSplit: function (e) {
    var layer = e.layer || e.target || e,
      pathOptions;
    layer.options.vertexWeight = 10;
    // Back up this layer (if haven't before)
    this._backupLayer(layer);

    layer
      .on('touchmove', this._onTouchMove, this)
      .on('MSPointerMove', this._onTouchMove, this)
      .on('mousemove', this._onLayerMouseMove, this)
      .on('vertex:click', this._onVertexClick, this);
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

    layer
      .off('touchmove', this._onTouchMove, this)
      .off('MSPointerMove', this._onTouchMove, this)
      .off('mousemove', this._onLayerMouseMove, this)
      .off('vertex:click', this._onVertexClick, this);
  },

  _onMouseMove: function (e) {
    this._tooltip.updatePosition(e.latlng);
    if (this._splitPoint) {
      this._showSplitPoint(this._splitPoint.layer,e.layerPoint);
    }
//    if (this._splitPoint) {
//      var pos = e.layerPoint;
//      var distance = this._map.getZoom();
//      var distanceX = Math.abs(pos.x - this._splitPoint.x);
//      var distanceY = Math.abs(pos.y - this._splitPoint.y);
//      if (distanceX > distance && distanceY > distance) {
//        this._splitPoint.layer.removeVertices();
//        delete this._splitPoint;
//      }
//    }
  },

  _onMouseClick: function(e) {
    if (this._splitPoint) {
      this._splitPoint.layer.removeVertices();
      delete this._splitPoint;
    }

    if (this._tempLine) {
      this._map.removeLayer(this._tempLine);
      this._tempLine.edited = true;
      this._tempLine.splitted = true;
      this._tempLine.addTo(this._featureGroup);
      delete this._tempLine;
    }
  },

  _onTouchMove: function (e) {
    var touchEvent = e.originalEvent.changedTouches[0],
      layerPoint = this._map.mouseEventToLayerPoint(touchEvent),
      latlng = this._map.layerPointToLatLng(layerPoint);
  },

  _onLayerMouseMove: function(e) {
    var pos = e.layerPoint,
      layer = e.target;
    this._layer = layer;
    if (layer instanceof L.Polyline) {
      this._showSplitPoint(layer,pos);
    }
  },

  _onVertexClick: function(e) {
    if (this._splitPoint) {
      if (e.layer != this._splitPoint.layer) {
        return this._startSplit(e);
      }
      this._splitLayer(e);
    } else {
      this._startSplit(e);
    }
  },

  _startSplit: function(e) {
    var layer = e.target,
      point = e.point;
    this._splitPoint = point;
    this._splitPoint.layer = layer;
  },

  _stopSplit: function() {
    delete this._splitPoint;
  },

  _splitLayer: function(e) {


  },

  _getSegment: function(layer, start, end) {
    var latLngs = layer.getLatLngs();
    var _start = this._map.layerPointToLatLng(start);
    var _end = this._map.layerPointToLatLng(end);

    var startIndex = -1,
        endIndex = -1;
    for (var i = 0; i < latLngs.length; i++) {
      var _latLng = latLngs[i];
      if (_latLng.lat == _start.lat && _latLng.lon == _start.lon) {
        startIndex = i;
      }
      if (_latLng.lat == _end.lat && _latLng.lon == _end.lon) {
        endIndex = i;
      }
    }

    if (startIndex !== -1 && endIndex !== -1) {
      if (startIndex > endIndex) {
        startIndex=startIndex+endIndex;
        endIndex=startIndex-endIndex;
        startIndex=startIndex-endIndex;
      }
      var segment = latLngs.slice(startIndex, endIndex+1);
      return L.polyline(segment);
    }
    return false;
  },

  _addSegment: function(latLngs) {
    var layer = L.polyline(latLngs);
    layer.edited = true;
    layer.splitted = true;
    layer._map = this._map;
    layer.addTo(this._featureGroup);
  },

  _getSplitPoint: function(layer, pos) {
    var closest = null;
    var list = layer._originalPoints;
    var distance = this._map.getZoom();
    for (var i = 0; i < list.length; i++) {
      var distanceX = Math.abs(pos.x - list[i].x);
      var distanceY = Math.abs(pos.y - list[i].y);
      if (distanceX < distance && distanceY < distance) {
        if (!closest) {
          closest = list[i];
        } else {
          var distanceX2 = Math.abs(pos.x - closest.x);
          var distanceY2 = Math.abs(pos.y - closest.y);
          if (distanceX < distanceX2 && distanceY < distanceY2) {
            closest = list[i];
          }
        }
      }
    }
    return closest;
  },

  _showSplitPoint: function(layer,pos) {
    var closest = this._getSplitPoint(layer, pos);
    if (!closest){
      return;
    }
    if (!this._splitPoint) {
      if (this._lastLayer && this._lastLayer != layer ) {
        this._lastLayer.removeVertices();
      }
      layer.removeVertices();
      layer.addVertex(closest);
      this._lastLayer = layer;
    } else {
      if (this._tempLine) {
        this._map.removeLayer(this._tempLine);
      }

      this._tempLine = this._getSegment(layer, this._splitPoint, closest);
      if (!this._tempLine) {
        return;
      }
      this._tempLine.setStyle({weight: 10, color: '#b8860b'});
      this._tempLine.addTo(this._map);
    }
  },

});
