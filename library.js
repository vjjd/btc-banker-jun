'use strict';

const request = require('request');
const config = require('./config.json');
const crypto = require('crypto');

// Post request form
function postReq(params, cb) {
  const hmac = new crypto.createHmac('sha512', config.secret);
  hmac.update(params.query);

  let options = {
    method: 'POST',
    url: config.tradingUrl,
    form: params.query,

    headers: {
      Key: config.APIKey,
      Sign: hmac.digest('hex'),
    },
  };

  function callback(err, res, body) {
    if (!err && res.statusCode == 200) {
      if (!JSON.parse(body).error) {
        cb(JSON.parse(body));
      } else {
        console.log(`Poloniex: ${body}`);
      }
    } else {
      console.log(err);
    }
  }

  request(options, callback);
}

// Get request form
function getReqt(params, cb) {
  request(params.query, (err, res, body) => {
    if (!err && res.statusCode == 200) {
      cb(JSON.parse(body));
    } else {
      console.log(err);
    }
  });
}

module.exports.postReq = postReq;
module.exports.getReqt = getReqt;
