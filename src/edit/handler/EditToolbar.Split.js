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
        return this._featureGroup.getLayers().length > 0;
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
            this._showSplitPoint(this._splitPoint);
        }

        if (this._firstSplitPoint) {
            this._showSplitPoint(this._firstSplitPoint);
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
        var pointA = e.layerPoint,
            splitPoint = this._getSplitPoint(pointA),
            templine;

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

        this._splitPoint = this._showSplitPoint(splitPoint);

        if (this._firstSplitPoint) {

            if (this._firstSplitPoint.layer !== this._splitPoint.layer) {
                return;
            }

            templine = this._getSegment(this._firstSplitPoint, this._splitPoint);
            if (!templine) {
                return;
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
                    this._tempLine.splitted = true;
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
            firstPoint = start,
            endPoint = end,
            latlngs = [],
            i;

        if (startIndex > endIndex) {
            startIndex = startIndex + endIndex;
            endIndex = startIndex - endIndex;
            startIndex = startIndex - endIndex;
            firstPoint = end;
            endPoint = start;
        }
        segment.push(firstPoint);

        latlngs = layer._originalPoints.slice(startIndex, endIndex);
        for (i = 0; i < latlngs.length; i++) {
            latlngs[i] = this._map.layerPointToLatLng(L.point(latlngs[i].x, latlngs[i].y));
        }
        segment = segment.concat(latlngs);
        segment.push(endPoint);

        return L.polyline(segment);

    },

    _addSegment: function (latLngs) {
        var layer = L.polyline(latLngs);
        layer.edited = true;
        layer.splitted = true;
        layer._map = this._map;
        layer.addTo(this._featureGroup);
    },

    _getSplitPoint: function (pointA) {
        var pointB = null,
            _this = this,
            _layer = null,
            _index,
            closest;

        if (!this._firstSplitPoint) {
            this._featureGroup.eachLayer(function (layer) {
                if (layer instanceof L.Polyline) {
                    closest = _this.closestLayerPoint(pointA, layer);
                    if (!pointB || pointB.distance > closest.distance) {
                        pointB = closest;
                        _layer = layer;
                        _index = pointB.index;
                    }
                }
            });
        } else {
            closest = _this.closestLayerPoint(pointA, this._firstSplitPoint.layer);
            pointB = closest;
            _layer = this._firstSplitPoint.layer;
            _index = pointB.index;
        }

        if (pointB && pointB.distance < 20) {
            pointB = this._map.layerPointToLatLng(pointB);
            pointB.layer = _layer;
            pointB.index = _index;
            return pointB;
        }
        return null;
    },

    _showSplitPoint: function (latlng) {

        if (latlng && latlng.vertex) {
            this._map._pathRoot.removeChild(latlng.vertex);
        }
        return this._drawSplitPoint(latlng);
    },

    _drawSplitPoint: function (latlng) {
        var namespace = 'http://www.w3.org/2000/svg',
            vertex = document.createElementNS('http://www.w3.org/2000/svg', 'circle'),
            point = this._map.latLngToLayerPoint(latlng);

        vertex = document.createElementNS(namespace, 'circle');
        vertex.setAttributeNS(null, 'r', 5);
        vertex.setAttributeNS(null, 'cx', point.x);
        vertex.setAttributeNS(null, 'cy', point.y);
        vertex.setAttributeNS(null, 'fill', '#00ff00');
        vertex.setAttributeNS(null, 'fill-opacity', latlng.layer.options.opacity);
        this._map._pathRoot.appendChild(vertex);
        latlng.point = point;
        latlng.vertex = vertex;
        return latlng;
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

    closestLayerPoint: function (p, layer) {
        var minDistance = Infinity, p1, p2, minPoint = null;
        var points = layer._originalPoints;
        for (var i = 1, len = points.length; i < len; i++) {
            p1 = points[i - 1];
            p2 = points[i];
            var sqDist = L.LineUtil._sqClosestPointOnSegment(p, p1, p2, true);
            if (sqDist < minDistance) {
                minDistance = sqDist;
                minPoint = L.LineUtil._sqClosestPointOnSegment(p, p1, p2);
                minPoint.index = i;
            }
        }
        if (minPoint) {
            minPoint.distance = Math.sqrt(minDistance);
        }
        return minPoint;
    },

});
