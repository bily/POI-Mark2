/*jshint laxcomma:true */

/**
 * Module dependencies.
 */
var auth = require('./auth')
    , express = require('express')
    , mongoose = require('mongoose')
    , mongoose_auth = require('mongoose-auth')
    , mongoStore = require('connect-mongo')(express)
    , routes = require('./routes')
    , middleware = require('./middleware')

    , poimap = require('./poimap')
    , request = require('request')
    , xml = require('node-xml')
    , procedure = require('./procedure')
    ;

var HOUR_IN_MILLISECONDS = 3600000;
var session_store;

var init = exports.init = function (config) {
  
  var db_uri = process.env.MONGOLAB_URI || process.env.MONGODB_URI || config.default_db_uri;

  mongoose.connect(db_uri);
  session_store = new mongoStore({url: db_uri});

  var app = express.createServer();

  app.configure(function(){
    app.set('views', __dirname + '/views');
    app.set('view engine', 'jade');
    app.set('view options', { pretty: true });

    app.use(express.bodyParser());
    app.use(express.cookieParser());
    app.use(express.methodOverride());
    app.use(express.session({secret: 'top secret', store: session_store,
      cookie: {maxAge: HOUR_IN_MILLISECONDS}}));
    app.use(mongoose_auth.middleware());
    app.use(express.static(__dirname + '/public'));
    app.use(app.router);

  });

  app.configure('development', function(){
    app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
  });

  app.configure('production', function(){
    app.use(express.errorHandler({ dumpExceptions: true, showStack: false}));
  });
  
  // POI Dough Mark 2
  app.get('/editor', function(req,res) {
    poimap.POIMap.findOne({}, function(err, myEditMap){
      if(!err){
        res.render('poieditor', { poimap: myEditMap });
      }
    });
  });
  
  app.get('/openmap', function(req, res) {
    if(req.query["id"]){
      poimap.POIMap.findById(req.query["id"], function(err, myViewMap){
        if(!err){
          res.render('poiview', { poimap: myViewMap });          
        }
      });
    }  
  });
  
  app.get('/savemap', function(req,res) {
    if(req.query["id"]){
      poimap.POIMap.findById(req.query["id"], function(err, myEditMap){
        if(!err){
          res.render('poieditor', { poimap: myEditMap });
          myEditMap.updated = new Date();
          myEditMap.save(function (err) {
            if (!err){
              console.log('Success!');
            }
            else{
              console.log('Fail! ' + err);
            }
          });
        }
      });
    }
    else{
      var basemapProviders = {
        "mapquest": {
          url: "http://otile1.mqcdn.com/tiles/1.0.0/osm/{z}/{x}/{y}.png",
          credit: "Map data &copy; 2012 OpenStreetMap contributors, Tiles by MapQuest"
        },
        "mapnik": {
          url: "http://tile.openstreetmap.org/{z}/{x}/{y}.png",
          credit: "Map data &copy; 2012 OpenStreetMap contributors"
        },
        "transit": {
          url: "http://{s}.tile2.opencyclemap.org/transport/{z}/{x}/{y}.png",
          credit: "Map data &copy; 2012 OpenStreetMap contributors, Tiles by Andy Allan"
        },
        "terrain": {
          url: "http://{s}.tile.stamen.com/terrain/{z}/{x}/{y}.jpg",
          credit: "Map data &copy; 2012 OpenStreetMap contributors, Tiles by Stamen Design"
        },
        "watercolor": {
          url: "http://{s}.tile.stamen.com/watercolor/{z}/{x}/{y}.jpg",
          credit: "Map data &copy; 2012 OpenStreetMap contributors, Tiles by Stamen Design"
        },
        "mapbox": {
          url: "http://{s}.tiles.mapbox.com/v3/mapbox.mapbox-streets/{z}/{x}/{y}.png",
          credit: "Map data &copy; 2012 OpenStreetMap contributors, Tiles by MapBox"
        }
      };
      var myNewMap = new poimap.POIMap({
        buildings : req.query["bld"].split(","),
        parks : req.query["prk"].split(","),
        basemap : basemapProviders[ req.query["tiler"] ].url,
        createdby : "POI Dough Test",
        attribution : basemapProviders[ req.query["tiler"] ].credit,
        updated : new Date(),
        center: req.query["ctr"].split(','),
        zoom: req.query["z"]
      })
      myNewMap.save(function (err) {
        if (!err){
          console.log('Success!');
          res.redirect('/openmap?id=' + myNewMap._id);
        }
        else{
          console.log('Fail! ' + err);
          res.send('Did not save');
        }
      });
    }
  });
  
  app.get('/osmbbox', function(req,res) {
    var bbox = req.query["bbox"];
    //var osmurl = 'http://poidough.herokuapp.com/osmbbox/' + bbox;
    var osmurl = 'http://api.openstreetmap.org/api/0.6/map?bbox=' + bbox;
    var requestOptions = {
      'uri': osmurl,
      'User-Agent': 'Mozilla/4.0 (compatible; MSIE 7.0; Windows NT 6.0)'
    };
    request(requestOptions, function (err, response, body) {
      //res.send(body);
      var nodesandways = { nodes:[ ], ways: [ ] };
      var lastObject = null;
      var parser = new xml.SaxParser(function(alerts){
        alerts.onStartElementNS(function(elem, attarray, prefix, uri, namespaces){
          var attrs = { };
          for(var a=0;a<attarray.length;a++){
            attrs[ attarray[a][0] ] = attarray[a][1];
          }
          if(elem == "node"){
            nodesandways.nodes.push( { id: attrs["id"], user: attrs["user"] + "-pt", latlng: [ attrs["lat"], attrs["lon"] ], keys: [ ] } );
            lastObject = nodesandways.nodes[ nodesandways.nodes.length-1 ];
          }
          else if(elem == "way"){
            nodesandways.ways.push( { wayid: attrs["id"], user: attrs["user"], line: [ ], keys: [ ] } );
            lastObject = nodesandways.ways[ nodesandways.ways.length-1 ];
          }
          else if((elem == "tag") && ( lastObject )){
            if(lastObject.id){
              // it's a node, and it should be sent to the user
              if(lastObject.user.indexOf("-pt") > -1){
                lastObject.user = lastObject.user.replace("-pt","");
              }
              lastObject.keys.push({ key: [attrs.k, attrs.v] });
            }
            else if(lastObject.wayid){
              // it's a way!
              lastObject.keys.push({ key: [attrs.k, attrs.v] });
            }
          }
          else if((elem == "nd") && ( lastObject ) && ( lastObject.wayid )){
            for(var n=0;n<nodesandways.nodes.length;n++){
              if(nodesandways.nodes[n].id == attrs["ref"]){
                lastObject.line.push( nodesandways.nodes[n].latlng );
                break;
              }
            }
          }
        });
        alerts.onEndDocument(function(){
          for(var n=nodesandways.nodes.length-1;n>=0;n--){
            if(nodesandways.nodes[n].user.lastIndexOf("-pt") == nodesandways.nodes[n].user.length - 3){
              // point without its own tags
              nodesandways.nodes.splice(n,1);
            }
          }
          res.send( nodesandways );
        });
      });
      parser.parseString(body);
    });
  });

  app.get('/isometrics', function(req,res) {
    // '/isometrics?wayid=WAYID'  
    var wayid = req.query["wayid"]

    // generate from API: http://www.openstreetmap.org/api/0.6/way/[WAYID]/full
    var osmurl = 'http://www.openstreetmap.org/api/0.6/way/' + wayid + '/full'

    var requestOptions = {
      'uri': osmurl,
      'User-Agent': 'Mozilla/4.0 (compatible; MSIE 7.0; Windows NT 6.0)'
    };
    request(requestOptions, function (err, response, body) {
      //res.send(body);
      var isometric = {
        "wayid": wayid,
        "sections": [{
          "vertices": [ ],
          "levels": 1
        }]
      };
      var latlngs = { };
      var lastObject = null;
      var parser = new xml.SaxParser(function(alerts){
        alerts.onStartElementNS(function(elem, attarray, prefix, uri, namespaces){
          var attrs = { };
          for(var a=0;a<attarray.length;a++){
            attrs[ attarray[a][0] ] = attarray[a][1];
          }
          if(elem == "node"){
            latlngs[ attrs["id"] ] = [ attrs["lat"] * 1, attrs["lon"] * 1 ];
            lastObject = "node";
          }
          else if(elem == "way"){
            lastObject = "way";
          }
          else if(elem == "nd"){
            isometric.sections[0].vertices.push( latlngs[ attrs["ref"] ] );
          }
          else if(elem == "tag"){
            if(lastObject == "way" && attrs["k"] == "name"){
              isometric.name = attrs["v"];
            }
          }
        });
        alerts.onEndDocument(function(){
          res.send( isometric );
        });
      });
      parser.parseString(body);
    });
  });

  app.get('/textures', function(req,res){
  
	var wayid = req.query["wayid"];

    // generate from API: http://www.openstreetmap.org/api/0.6/way/[WAYID]/full
    var osmurl = 'http://www.openstreetmap.org/api/0.6/way/' + wayid + '/full'

    var requestOptions = {
      'uri': osmurl,
      'User-Agent': 'Mozilla/4.0 (compatible; MSIE 7.0; Windows NT 6.0)'
    };
    request(requestOptions, function (err, response, body) {
      //res.send(body);
      var park = {
        "wayid": wayid,
        "vertices": [ ]
      };
      var latlngs = { };
      var lastObject = null;
      var parser = new xml.SaxParser(function(alerts){
        alerts.onStartElementNS(function(elem, attarray, prefix, uri, namespaces){
          var attrs = { };
          for(var a=0;a<attarray.length;a++){
            attrs[ attarray[a][0] ] = attarray[a][1];
          }
          if(elem == "node"){
            latlngs[ attrs["id"] ] = [ attrs["lat"] * 1, attrs["lon"] * 1 ];
            lastObject = "node";
          }
          else if(elem == "way"){
            lastObject = "way";
          }
          else if(elem == "nd"){
            park.vertices.push( latlngs[ attrs["ref"] ] );
          }
          else if(elem == "tag"){
            if(lastObject == "way" && attrs["k"] == "name"){
              park.name = attrs["v"];
            }
          }
        });
        alerts.onEndDocument(function(){
          res.send( park );
        });
      });
      parser.parseString(body);
    });
  });
  
/* Sample Document Creation Script
  app.get('/rand', function(req,res) {
    try{
      var randmap = new poimap.POIMap();
      randmap.body = "sample";
      randmap.date = new Date();
      randmap.save(function (err) {
        if (!err){
          console.log('Success!');
        }
        else{
          console.log('Fail! ' + err);
        }
      });
      res.render('poieditor', { poimap: randmap });
    }
    catch(e){
    	return "Error " + e;
    }
    
  }); */


  // Project Kansas: different procedural buildings / art effects
  // using HTML5 Canvas
  app.get('/kansas', function(req, res){
    if(req.query["id"]){
      procedure.Procedure.findById(req.query["id"], function(err, canvProgram){
        res.render('kansasedit', { program: canvProgram });
      });
    }
    else{
      res.send('no id');
    }
  });

  app.get('/', function(req,res) {
    res.render('poihome', { title: "My Title", app_name: "Test App", comments: [ ] });
  });
  
  // Poang Routes

  app.get('/poang', middleware.require_auth_browser, routes.index);
  app.post('/poang/add_comment',middleware.require_auth_browser, routes.add_comment);
  
  // redirect all non-existent URLs to doesnotexist
  app.get('*', function onNonexistentURL(req,res) {
    res.render('doesnotexist',404);
  });

  mongoose_auth.helpExpress(app);

  return app;
};

// Don't run if require()'d
if (!module.parent) {
  var config = require('./config');
  var app = init(config);
  app.listen(process.env.PORT || 3000);
  console.info("Express server listening on port %d in %s mode", app.address().port, app.settings.env);
}