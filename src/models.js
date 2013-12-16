"use strict";

var mongoose = require('mongoose');
var mongooseJsonSchema = require('./mongoose/json-schema');
var deduplicateSlug = require('./mongoose/deduplicate-slug');
var search = require('./mongoose/search');
var collections = require('./collections');
var Filter = require('./filter');

/**
 * Transform a document to a json doc.
 *
 * - options.fieldSpec The fields to show/hide
 */
function toJSON(doc, ret, options) {
  if (options.fields) {
    var filter = new Filter(options.fields);
    return filter.doc(ret);
  }
}

/**
 * Generate mongoose models from the collections module.
 */
for (var key in collections) {
  if (collections.hasOwnProperty(key)) {
    var spec = collections[key];
    var Schema = new mongoose.Schema({_id: String}, {collection: key});

    Schema.set('toJSON', {transform: toJSON});

    Schema.plugin(mongooseJsonSchema, {jsonSchemaUrl: spec.popoloSchemaUrl});
    Schema.plugin(deduplicateSlug);
    Schema.plugin(search);

    mongoose.model(spec.model, Schema);
  }
}
