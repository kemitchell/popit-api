"use strict";

var i18n = require('../src/i18n');
var assert = require('assert');
var fixtures = require('pow-mongodb-fixtures');
var defaults = require('./defaults');
var supertest = require('supertest');
var popitApp = require('../test-server-app');
var mongoose = require('mongoose');

describe("internationalization", function() {
  var json = {
    name: {
      en: 'Chris',
      ru: 'Крис'
    }
  };

  it("converts translated documents to popolo", function() {
    assert.equal(i18n(json, ['en']).name, 'Chris');
    assert.equal(i18n(json, ['ru']).name, 'Крис');
  });

  it("uses the default language when there is no match", function() {
    assert.equal(i18n(json, ['es'], 'en').name, 'Chris');
    assert.equal(i18n(json, ['es'], 'ru').name, 'Крис');
  });

  it("returns an empty string when no languages match", function() {
    assert.equal(i18n(json, ['es'], 'de').name, '');
  });

  describe("translating documents in the API", function() {
    var fixture = fixtures.connect(defaults.databaseName);
    var request = supertest(popitApp);
    beforeEach(function(done) {
      fixture.clearAllAndLoad({
        persons: [
          { _id: 'fred-bloggs', name: { en: 'Fred Bloggs', ru: 'Фред Влоггс' } }
        ]
      }, done);
    });

    it("allows documents to be created over the API", function(done) {
      request.post('/api/persons')
      .send({
        name: {
          en: 'Chris',
          ru: 'Крис'
        },
        links: [
          {url: 'http://example.org', note: {en: 'Example', es: 'Ejemplo'}}
        ]
      })
      .expect(200)
      .end(function(err, res) {
        assert.ifError(err);
        assert.equal(res.body.result.name, 'Chris');
        assert.equal(res.body.result.links[0].note, 'Example');
        done();
      });
    });

    it("returns the document in the requested language", function(done) {
      request.get('/api/persons/fred-bloggs')
      .set('Accept-Language', 'en')
      .expect(200)
      .end(function(err, res) {
        assert.ifError(err);
        assert.equal(res.body.result.name, 'Fred Bloggs');
        done();
      });
    });
  });

  describe("search", function() {
    var Person;
    before(function() {
      mongoose.connect('mongodb://localhost/' + defaults.databaseName);
    });

    after(function(done) {
      mongoose.connection.close(done);
    });

    beforeEach(function(done) {
      Person = mongoose.model('Person');
      var person = new Person({_id: 'foo', id: 'foo', name: 'Foo'});
      person.save(function(err) {
        assert.ifError(err);
        person.on('es-indexed', done);
      });
    });

    it("doesn't give an error when indexing", function(done) {
      var person = new Person();
      person._id = person.id = 'chris';
      person.name = {en: 'Chris', ru: 'Крис'};
      person.save(function(err) {
        assert.ifError(err);
        person.on('es-indexed', function(err) {
          assert.ifError(err);
          done();
        });
      });
    });
  });
});
