"use strict";

var mongoose = require('mongoose');
var config = require('config');
var format = require('util').format;
var InstanceSchema = require('./schemas/instance');

var connectionStringFormat = config.get('mongodb.connectionStringFormat');
var prefix = config.get('mongodb.prefix');
var master = config.get('mongodb.master');

// Main connection to master database
mongoose.connect(format(connectionStringFormat, prefix + master));

mongoose.model('Instance', InstanceSchema);

function connectionForInstance(instance) {
  var dbName = instance.dbName || prefix + instance.slug;
  return mongoose.createConnection(format(connectionStringFormat, dbName));
}

mongoose.connectionForInstance = connectionForInstance;

module.exports = mongoose;
