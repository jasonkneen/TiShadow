/*
 * Copyright (c) 2011-2014 YY Digital Pty Ltd. All Rights Reserved.
 * Please see the LICENSE file included with this distribution for details.
 */

var logger = require('../../server/logger.js'),
  fs = require('fs-extra'),
  path = require('path'),
  tishadow_app = path.join(__dirname, '../..', 'app'),
  config = require('./config'),
  package_version = require('../../package.json').version,
  _ = require('underscore');

_.templateSettings = {
  interpolate: /\{\{(.+?)\}\}/g
};

var required_modules = [
  '<module platform="android">ti.socketio</module>',
  '<module platform="android">ti.compression</module>',
  '<module platform="android">yy.logcatcher</module>',
  '<module platform="iphone">ti.socketio</module>',
  '<module platform="iphone">ti.compression</module>',
  '<module platform="iphone">yy.logcatcher</module>',
  '<module platform="iphone">yy.tidynamicfont</module>'
];

var required_properties = [
  '<property name="ti.android.bug2373.finishfalseroot" type="bool">true</property>',
  '<property name="ti.android.bug2373.skipAlert" type="bool">true</property>'
];

exports.copyCoreProject = function(env) {
  var dest = env.destination || '.';
  fs.mkdirpSync(dest);
  if (!fs.existsSync(dest) || !fs.lstatSync(dest).isDirectory()) {
    logger.error('Could not create destination directory.');
    return false;
  }
  if (dest === '.') {
    logger.error("You really don't want to write to the current directory.");
    return false;
  }

  if (env.upgrade) {
    logger.info('Upgrading existing app....');

    if (!fs.existsSync(path.join(dest, 'Resources'))) {
      logger.error('Could not find existing tishadow app');
      return false;
    }
    var target_tiapp = fs.readFileSync(path.join(dest, 'tiapp.xml'), 'utf8');
    var write_tiapp = target_tiapp
      .replace(
        /<property[^>]+ti\.android\.bug2373\.finishfalseroot[^>]+>true<\/property>/,
        ''
      )
      .replace(/<property name="tishadow:version".*<\/property>/, '')
      .replace('android:launchMode="singleTop"', '')
      .replace('<modules/>', '<modules></modules>');
    required_properties.forEach(function(prop) {
      if (write_tiapp.indexOf(prop) === -1) {
        write_tiapp = write_tiapp.replace(
          '</modules>',
          '</modules>\n  ' + prop
        );
      }
    });
    required_modules.forEach(function(mod) {
      if (write_tiapp.indexOf(mod) === -1) {
        write_tiapp = write_tiapp.replace(
          '</modules>',
          '  ' + mod + '\n</modules>'
        );
      }
    });

    //inject tishadow version
    write_tiapp = write_tiapp.replace(
      '</modules>',
      '</modules>\n  <property name="tishadow:version" type="string">' +
        package_version +
        '</property>'
    );

    fs.writeFileSync(path.join(dest, 'tiapp.xml'), write_tiapp);
    fs.copySync(
      path.join(tishadow_app, 'Resources'),
      path.join(dest, 'Resources')
    );
    fs.copySync(
      path.join(tishadow_app, 'modules'),
      path.join(dest, 'modules'),
      { overwrite: false }
    );
  } else {
    logger.info('Creating new app...');

    fs.copySync(tishadow_app, dest);

    //inject new GUID
    var source_tiapp = fs.readFileSync(
      path.join(tishadow_app, 'tiapp.xml'),
      'utf8'
    );
    fs.writeFileSync(
      path.join(dest, 'tiapp.xml'),
      source_tiapp
        .replace(
          '{{GUID}}',
          'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = (Math.random() * 16) | 0,
              v = c == 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
          })
        ) // GUID one-liner: http://stackoverflow.com/a/2117523
        .replace('{{APPID}}', env.appid)
        .replace(
          '</modules>',
          '</modules>\n  <property name="tishadow:version" type="string">' +
            package_version +
            '</property>'
        )
    );
  }
  return true;
};

exports.build = function(env) {
  var dest = env.destination || '.';
  var dest_resources = path.join(dest, 'Resources');
  var dest_fonts = path.join(dest_resources, 'fonts');
  var dest_modules = path.join(dest, 'modules');
  var dest_platform = path.join(dest, 'platform');
  var dest_plugins = path.join(dest, 'plugins');
  var template_file = path.join(tishadow_app, 'Resources', 'appify.js');

  //set to bundle mode
  env._name = 'bundle';
  var compiler = require('./compiler');
  //bundle the source
  compiler(env, function() {
    //copy tishadow src
    if (exports.copyCoreProject(env)) {
      // generate app.js
      var template = fs.readFileSync(template_file, 'utf8');
      var new_app_js = _.template(template)({
        proto: 'http' + (config.isTiCaster ? 's' : ''),
        host: config.host,
        port: config.port,
        room: config.room,
        app_name: config.app_name,
        date: new Date().getTime()
      });
      fs.writeFileSync(path.join(dest_resources, 'app.js'), new_app_js);
      //copy fonts
      if (fs.existsSync(config.fonts_path)) {
        fs.copySync(config.fonts_path, dest_fonts);
      }
      fs.mkdirpSync(dest_platform);
      //copy splash screen and icons
      [
        'iphone',
        'ios',
        'android',
        'blackberry',
        'mobileweb',
        'tizen',
        'commonjs'
      ].forEach(function(platform) {
        if (fs.existsSync(path.join(config.resources_path, platform))) {
          fs.copySync(
            path.join(config.resources_path, platform),
            path.join(dest_resources, platform),
            {
              filter(src) {
                let regex = new RegExp(
                  '(.png|images|res-.*|fonts|.otf|.ttf|.bundle|.json|.plist)$',
                  'i'
                );
                return regex.test(src);
              }
            }
          );
        }
        if (fs.existsSync(path.join(config.modules_path, platform))) {
          fs.copySync(
            path.join(config.modules_path, platform),
            path.join(dest_modules, platform),
            { preserve: true }
          );
        }
        if (fs.existsSync(path.join(config.platform_path, platform))) {
          fs.copySync(
            path.join(config.platform_path, platform),
            path.join(dest_platform, platform)
          );
        }
      });
      if (fs.existsSync(config.plugins_path)) {
        fs.copySync(config.plugins_path, dest_plugins);
      }
      // copy DefaultIcon.png if it exists
      if (fs.existsSync(path.join(config.base, 'DefaultIcon.png'))) {
        fs.createReadStream(path.join(config.base, 'DefaultIcon.png')).pipe(
          fs.createWriteStream(path.join(dest, 'DefaultIcon.png'))
        );
      }
      if (fs.existsSync(path.join(config.base, 'Podfile'))) {
        fs.createReadStream(path.join(config.base, 'Podfile')).pipe(
          fs.createWriteStream(path.join(dest, 'Podfile'))
        );
      }

      if (fs.existsSync(path.join(config.base, 'Entitlements.plist'))) {
        fs.createReadStream(path.join(config.base, 'Entitlements.plist')).pipe(
          fs.createWriteStream(path.join(dest, 'Entitlements.plist'))
        );
      }

      ['semantic.colors.json', 'GoogleService-Info.plist'].forEach(file => {
        if (
          fs.existsSync(path.join(config.base, 'Resources', 'iphone', file))
        ) {
          fs.createReadStream(
            path.join(config.base, 'Resources', 'iphone', file)
          ).pipe(
            fs.createWriteStream(path.join(dest, 'Resources', 'iphone', file))
          );
        }
      });

      if (fs.existsSync(path.join(config.base, 'extensions'))) {
        var extensionsPath = path.join(dest, 'extensions');

        fs.mkdirpSync(extensionsPath);
        fs.copySync(path.join(config.base, 'extensions'), extensionsPath);
      }

      if (fs.existsSync(path.join(config.base, 'scripts'))) {
        var scriptsPath = path.join(dest, 'scripts');

        fs.mkdirpSync(scriptsPath);
        fs.copySync(path.join(config.base, 'scripts'), scriptsPath);
      }

      // copy tiapp.xml and inject modules
      var source_tiapp = fs.readFileSync(
        path.join(config.base, 'tiapp.xml'),
        'utf8'
      );

      //if source tiapp is missing a modules tag
      if (
        source_tiapp.indexOf('</modules>') === -1 &&
        source_tiapp.indexOf('<modules/>') === -1
      ) {
        source_tiapp = source_tiapp.replace(
          '</ti:app>',
          '  <modules/>\n</ti:app>'
        );
      }

      required_modules.push('</modules>');
      var injected_xml = required_modules.concat(required_properties);
      var new_tiapp_xml = source_tiapp
        .replace(/<plugin[^>]*>ti\.alloy<\/plugin>/, '')
        .replace(
          /<property[^>]+ti\.android\.bug2373\.finishfalseroot[^>]+>true<\/property>/,
          ''
        )
        .replace('android:launchMode="singleTop"', '')
        .replace('<modules/>', '<modules></modules>')
        .replace('</modules>', injected_xml.join('\n'))
        .replace(
          '</modules>',
          '</modules>\n  <property name="tishadow:version" type="string">' +
            package_version +
            '</property>'
        );
      if (config.modifyAppId) {
        new_tiapp_xml = new_tiapp_xml.replace('</id>', '.appified</id>');
      }
      fs.writeFileSync(path.join(dest, 'tiapp.xml'), new_tiapp_xml);
      // copy the bundle
      fs.writeFileSync(
        path.join(dest_resources, config.app_name.replace(/ /g, '_') + '.zip'),
        fs.readFileSync(config.bundle_file)
      );

      logger.info('TiShadow app ready');
    }
  });
};
