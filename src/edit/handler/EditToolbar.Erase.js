L.EditToolbar.Erase = L.Handler.extend({
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

    revertLayers: function () {
        this._featureGroup.eachLayer(function (layer) {
            this._revertLayer(layer);
        }, this);
    },

    _revertLayer: function (layer) {
        var id = L.Util.stamp(layer);
        layer.edited = false;
        layer.deleted = false;
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
        var deletedLayers = new L.LayerGroup();
        var _this = this;

        this._featureGroup.eachLayer(function (layer) {
            if (layer.edited && !layer.deleted) {
                editedLayers.addLayer(layer);
                layer.edited = false;
            }

            if (layer.deleted) {
                _this._featureGroup.removeLayer(layer);
                deletedLayers.addLayer(layer);
                layer.edited = false;
            }
        });
        this._map.fire('draw:edited', {layers: editedLayers});
        this._map.fire('draw:deleted', {layers: deletedLayers});
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
        return this._featureGroup.getLayers().length > 0;
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
      this.erase(e.latlng);
      if (e.originalEvent.button === 2) {
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

                    if (sqDist < 40) {
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
