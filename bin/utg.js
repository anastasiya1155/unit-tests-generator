#!/usr/bin/env node

'use strict';

var cli = require('../index.js');

module.exports = cli.run(process.argv[2]);
