"use strict";

/**
 * Mongoose middleware providing elasticsearch indexing and searching for
 * models.
 *
 * Uses the database name as the index and the model name as the type when
 * indexing documents in elasticsearch. This can be configured by overriding
 * the `indexName` and/or `typeName` methods.
 */

var elasticsearch = require('elasticsearch');
var filter = require('../filter');
var paginate = require('../paginate');
var i18n = require('../i18n');
var async = require('async');
var util = require('util');

module.exports = exports = elasticsearchPlugin;

function InvalidQueryError(message, explanation) {
  this.name = 'InvalidQueryError';
  this.message = message || "Invalid q parameter";
  this.explaination = explanation;
}
util.inherits(InvalidQueryError, Error);

exports.InvalidQueryError = InvalidQueryError;

var client = elasticsearchPlugin.client = new elasticsearch.Client({
  apiVersion: '0.90'
});

function elasticsearchPlugin(schema) {

  /**
   * Convert the document into a format suitable for indexing in
   * Elasticsearch. This uses the toJSON transform option to remove
   * fields we don't want to index.
   *
   * TODO: Make this more generalised rather than hard-coding memberships
   */
  schema.methods.toElasticsearch = function toElasticsearch(callback) {
    process.nextTick(function() {
      var doc = this.toJSON({
        transform: filter,
        fields: {
          all: {
            memberships: false,
            url: false,
            html_url: false
          }
        }
      });
      callback(null, i18n(doc, [], schema.options.toJSON.defaultLanguage || 'en', true));
    }.bind(this));
  };

  schema.methods.reIndex = function reIndex(callback) {
    callback = callback || function() {};
    var self = this;
    self.toElasticsearch(function(err, result) {
      if (err) {
        throw err;
      }
      client.index({
        index: self.constructor.indexName(),
        type: self.constructor.typeName(),
        id: self.id,
        body: result
      }, function(err) {
        self.emit('es-indexed', err);
        callback(err);
      });
    });
  };

  /**
   * After the document has been saved, index it in elasticsearch.
   */
  schema.post('save', function(doc) {
    doc.reIndex();
  });

  /**
   * After the document is removed, delete it from elasticsearch.
   */
  schema.post('remove', function(doc) {
    client.delete({
      index: doc.constructor.indexName(),
      type: doc.constructor.typeName(),
      id: doc.id
    }, function(err) {
      doc.emit('es-removed', err);
    });
  });

  /**
   * Configure the index name using the database name.
   */
  schema.statics.indexName = function() {
    return this.db.name.toLowerCase();
  };

  /**
   * Configure the type name using the model name.
   */
  schema.statics.typeName = function() {
    return this.modelName.toLowerCase();
  };

  /**
   * Add a search method to models that use this plugin.
   *
   * @param {Object} params An object containing search params
   * @param {String} params.q The elasticsearch query to perform
   * @param {String} params.page Page of results to return
   * @param {String} params.per_page Number of results per page
   * @param {Function} cb Function to call when search is complete
   */
  schema.statics.search = function(params, cb) {
    var skipLimit = paginate(params);

    var query = {
      index: this.indexName(),
      type: this.typeName(),
      q: params.q,
      from: skipLimit.skip,
      size: skipLimit.limit,
      explain: true
    };

    client.indices.validateQuery(query, function(err, res) {
      if (err) {
        return cb(err);
      }
      if (!res.valid) {
        var message = "Invalid q parameter: " + query.q;
        var error = new InvalidQueryError(message, res.explanations[0].error);
        return cb(error);
      }
      client.search(query, cb);
    });

  };

  function findForElasticsearchWithSkip(batchSize, skip, done) {
    var self = this;
    self.find({}, null, {limit: batchSize, skip: skip}, function(err, docs) {
      if (err) {
        return done(err);
      }

      async.concat(docs, function(doc, callback) {
        doc.toElasticsearch(function(err, result) {
          if (err) {
            return callback(err);
          }
          callback(null, [{
            index: {
              _index: self.indexName(),
              _type: self.typeName(),
              _id: doc._id,
            }
          }, result]);
        });
      }, done);
    });
  }

  /**
   * Reindex all the documents in this collection using the elasticsearch
   * bulk API.
   */
  schema.statics.reIndex = function(done) {
    var self = this;
    self.count(function(err, count) {
      if (err) {
        return done(err);
      }
      if (count === 0) {
        return done(null, 0);
      }

      // The version of mongo we're currently using (2.0.x) has a limit of 4MB
      // for documents being returned from mongo. When there is a collection
      // bigger than this limit an error will occur if we try and retrieve the
      // whole collection at once, so instead we do it in batches of 'batchSize'.
      //
      // It's not entirely clear why this is necessary, since mongo *should* use
      // a cursor to avoid limits like this, but we couldn't find an obvious way
      // to work around this.
      var batchSize = 2000;
      var skip;
      var skips = [];
      for (skip = 0; skip < count; skip += batchSize) {
        skips.push(skip);
      }

      async.concat(skips, function(skip, next) {
        findForElasticsearchWithSkip.call(self, batchSize, skip, next);
      }, function(err, body) {
        client.bulk({body: body}, function(err) {
          // There are 2 array elements for every document, so we divide the total by 2
          done(err, body.length / 2);
        });
      });
    });
  };

}
