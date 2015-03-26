"use strict";

var fs = require('fs-extra');
var mkdirp = require('mkdirp');
var path = require('path');
var mmm = require('mmmagic');
var magic = new mmm.Magic(mmm.MAGIC_MIME_TYPE);
var transform = require('../transform');

module.exports = function(app) {

  app.delete('/:collection/:id/image', function (req, res, next) {
    var id = req.params.id;

    req.collection.findById(id, function (err, doc) {
      if (err) {
        return next(err);
      }
      if (!doc) {
        return res.send(204);
      }

      var images = doc.get('images');

      images.forEach(function(img) {
        if ( img._id ) {
          var image = new (req.popit.model('Image'))( img );
          var path = req.popit.files_dir( image.local_path );
          fs.removeSync( path );
        }
      });

      doc.set('image', null);
      doc.set('images', []);
      doc.markModified('images');
      doc.save(function(err, newDoc) {
        if (err) {
          return next(err);
        }

        return res.withBody(transform(newDoc, req));
      });
    });
  });

  app.delete('/:collection/:id/image/:image_id', function (req, res, next) {
    var id = req.params.id;
    var image_id = req.params.image_id;

    req.collection.findById(id, function (err, doc) {
      if (err) {
        return next(err);
      }
      if (!doc) {
        return res.send(204);
      }

      var images = doc.get('images');

      if ( !images ) {
        return res
          .status(400)
          .jsonp({
            errors: ["Doc has no images"]
          });
      }

      var imageIdx = getImageByIdx( image_id, images );

      if ( imageIdx == -1 ) {
        return res
          .status(400)
          .jsonp({
            errors: ["No image with that id found"]
          });
      }

      var image = new (req.popit.model('Image'))( images[imageIdx] );
      var imagePath = req.popit.files_dir( image.local_path );

      fs.remove( imagePath, function(err) {
        if (err) {
          throw err;
        }

        images.splice(imageIdx, 1);
        doc.set('images', images);
        doc.markModified('images');
        doc.save(function(err, newDoc) {
          if (err) {
            return next(err);
          }

          return res.withBody(transform(newDoc, req));
        });
      });
    });
  });

  function saveImagesMiddleware(req, res, next) {
    function saveImages( doc, image, upload, dest_path, idx ) {
      var options = {};
      if ( typeof idx != 'undefined' ) {
        options = { clobber: true };
      }
      fs.move( upload.path, dest_path, options, function(err) {
        if (err) {
          throw err;
        }

        var images = doc.get('images');
        if ( !images ) {
          images = [];
        }

        /* This whole process here is to make sure mongoose sees this as
         * JSON and not as a Mongoose document. If it does the latter then
         * there are various circular references in there that cause a stack
         * size exceeded error.
         *
         * Furthermore elasticsearch is fussy about date formats and the default
         * format that is produced when parsing the created date to JSON upsets
         * it so to be safe we force it to a known compatible
         * format here.
         */
        image = image.toJSON();
        image.created = image.created.toISOString();

        if ( typeof idx != 'undefined' ) {
          images[idx] = image;
        } else {
          if (image.index === 'first') {
            images.unshift(image);
          } else if (image.index === 'last') {
            images.push(image);
          } else if (/^(0|[1-9]\d*)$/.test(image.index)) {
            images.splice(parseInt(image.index), 0, image);
          } else {
            images.push(image);
          }
        }
        delete image.index;

        /* In case no MIME type was specified on upload, guess it
         * using libmagic */
        magic.detectFile(dest_path, function(err, result) {
          if (err) {
            throw err;
          }

          if (!image.mime_type) {
            image.mime_type = result;
          }

          doc.set('images', images);
          // mongoose has trouble working out if mixed object arrays have changed
          // so make sure it knows otherwise the changes aren't saved
          doc.markModified('images');

          doc.save(function(err, newDoc) {
            if (err) {
              return next(err);
            }

            return res.withBody(transform(newDoc, req));
          });
        });
      });
    }
    res.saveImages = saveImages;
    next();
  }

  function processImageBody( image, body ) {
    var fieldsToRemove = [ 'filename', 'name', 'content', 'id', '_id' ];
    fieldsToRemove.forEach(function(field) {
      delete body[field];
    });

    Object.keys(body).forEach(function(key) {
      image.set(key, body[key]);
    });

    return image;
  }

  app.post('/:collection/:id/image', saveImagesMiddleware, function (req, res, next) {
    var id = req.params.id;
    var body = req.body;

    var upload = {};
    if ( req.files ) {
      upload = req.files.image || {};
    }

    if ( !upload.size ) {
      return res
        .status(400)
        .jsonp({
          errors: ["No image sent"]
        });
    }

    req.collection.findById(id, function (err, doc) {
      if (err) {
        return next(err);
      }
      if ( !doc ) {
        return res
          .status(400)
          .jsonp({
            errors: ["No doc found"]
          });
      }

      var image = new (req.popit.model('Image'))({
          mime_type: upload.type
        });

      image = processImageBody( image, body );

      var dest_path = req.popit.files_dir( image.local_path );

      // copy the image to the right place
      mkdirp( path.dirname(dest_path), function (err) {
        if (err) {
          throw err;
        }
        res.saveImages( doc, image, upload, dest_path );
      });
    });
  });

  // this doesn't make sense to do and we have to handle it
  // explicitly otherwise documents with an id of :id/image
  // are created which is almost certainly not what people
  // want
  app.put('/:collection/:id/image', function (req, res) {
    res.status(405).jsonp({errors: ["unsupported method"] });
  });

  function getImageByIdx( idx, images ) {
    for ( var i = 0; i < images.length; i++ ) {
      if ( images[i]._id == idx ) {
        return i;
      }
    }

    return -1;
  }

  app.put('/:collection/:id/image/:image_id', saveImagesMiddleware, function (req, res, next) {
    var id = req.params.id;
    var image_id = req.params.image_id;
    var body = req.body;

    var upload = {};
    if ( req.files ) {
      upload = req.files.image || {};
    }

    if ( !upload.size ) {
      return res
        .status(400)
        .jsonp({
          errors: ["No image sent"]
        });
    }

    req.collection.findById(id, function (err, doc) {
      if (err) {
        return next(err);
      }
      if ( !doc ) {
        return res
          .status(400)
          .jsonp({
            errors: ["No doc found"]
          });
      }

      var images = doc.get('images');

      if ( !images ) {
        return res
          .status(400)
          .jsonp({
            errors: ["Doc has no images"]
          });
      }

      var imageIdx = getImageByIdx( image_id, images );

      if ( imageIdx == -1 ) {
        return res
          .status(400)
          .jsonp({
            errors: ["No image with that id found"]
          });
      }

      var image = new (req.popit.model('Image'))( images[imageIdx] );

      image = processImageBody( image, body );

      var dest_path = req.popit.files_dir( image.local_path );

      res.saveImages( doc, image, upload, dest_path, imageIdx );
    });
  });

};
