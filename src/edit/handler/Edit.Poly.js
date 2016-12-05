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


	addHooks: function () {
		this._initHandlers();
	},

	removeHooks: function () {

	},

	updateMarkers: function () {

	},

	_initHandlers: function () {

	},

	_updateLatLngs: function (e) {
		this.latlngs = [e.target._latlngs];
		if (e.target._holes) {
			this.latlngs = this.latlngs.concat(e.target._holes);
		}
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