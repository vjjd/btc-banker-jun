'use strict';

const config = require('./config.json');
const library = require('./library.js');
const nodemailer = require('nodemailer');
const fs = require('fs');
const logStr = '';
const meta = {
  initTime: Date.now(),
  balance: {},
  currencies: [],
  orders: [],
  recordTradeHistory: [],
  withdraw: {
    addresses: [],
  },
};

if (checkPercentage()) {
  run();
} else {
  throw new Error('Percentage is not valid!');
}

function run() {
  getBalance().then(balances => {
    let exchangeCurrs = Object.keys(balances);

    if (exchangeCurrs.length === 1 && exchangeCurrs[0] == 'BTC') {
      console.log(`Step 1. No Currency To Exchange. Let\'s Withdraw ${meta.balance.BTC} BTC`);
      withdrawForAll().then(onSuccess, onError);
    } else {
      meta.currencies = exchangeCurrs.filter(currency => {
        if (currency != 'BTC') {
          return currency;
        }
      });

      placeOrders().then(() => {
        console.log('Orders was placed!');
        waitingForCompletion().then(() => {
          console.log('Orders resolved!');
          withdrawForAll().then(() => {
            console.log('Withdrawed!');
            onSuccess();
          }, onError);
        }, onError);
      }, onError);
    }

    function onSuccess() {
      recordHistory().then(() => {
        writeLog();
        sendEmail();
      }, onError);
    }
  });
}

/**
 * Get balances
 * @return {object} promise
 */
function getBalance() {
  return new Promise((resolve, reject) => {
    let balanceParams = {
      query: `command=returnAvailableAccountBalances&nonce=${Date.now()}`,
    };

    library.postReq(balanceParams, balances => {
      if (balances.exchange) {
        meta.balance = balances.exchange;

        console.log(`Step 1. (6) Current Balance: ${JSON.stringify(meta.balance)}`);

        resolve(meta.balance);
      } else {
        reject('Step 1. (6) Nothing to exchange');
      }
    });
  });
}

/**
 * Place orders
 * @return {object} Promise
 */
function placeOrders() {
  return new Promise((resolve, reject) => {
    iterator(meta.currencies[0], meta.currencies, newOrder, resolve);

    function newOrder(currency) {
      let currencyPair = `BTC_${currency}`;
      let orderBookParams = {
        query: `https://poloniex.com/public?command=returnOrderBook&currencyPair=${currencyPair}&depth=1`,
      };

      return new Promise(function(resolve, reject) {
        library.getReqt(orderBookParams, res => {
          if (res.error) {
            reject(res.error);
          }

          let order = {
            currencyPair: orderBookParams.currencyPair,
            bid: res.bids,
          };

          let sellParams = {
            currencyPair,
            rate: order.bid[0][0],
            amount: meta.balance[currency],
          };

          sellParams.query = `command=sell&currencyPair=${sellParams.currencyPair}&rate=${sellParams.rate}&amount=${sellParams.amount}&nonce=${Date.now()}`;

          library.postReq(sellParams, res => {
            if (res.orderNumber) {
              console.log(
                `Step 2. Order № ${res.orderNumber} Placed For ${sellParams.currencyPair}. Rate: ${sellParams.rate}; Amount: ${sellParams.amount}`
              );

              meta.orders.push(order);

              resolve();
            } else {
              console.log(res);
              resolve();
            }
          });
        });
      });
    }
  });
}

/**
 * Waiting for the completion of all orders
 * @return {object}	promise
 */
function waitingForCompletion() {
  return new Promise((resolve, reject) => {
    let intervalID = setInterval(function() {
      library.postReq(
        {
          query: `command=returnOpenOrders&currencyPair=all&nonce=${Date.now()}`,
        },
        res => {
          if (!res.length && !res.error) {
            clearInterval(intervalID);
            resolve();
          } else {
            if (res.error) {
              console.log(res.error);
            } else {
              console.log('Not closed yet..', res.length);
            }
          }
        }
      );
    }, 1000);
  });
}

/**
 * Get trade history from poloniex
 * @return {object} promise
 */
function recordHistory() {
  return new Promise((resolve, reject) => {
    let params = {
      query: `command=returnTradeHistory&currencyPair=all&start=${meta.initTime / 1000}&end=${Date.now() /
        1000}&nonce=${Date.now()}`,
    };

    library.postReq(params, res => {
      let log = '';

      if (!res.error) {
        for (let key in res) {
          for (let order of res[key]) {
            let orderStr = `Order ${key}, Rate: ${order.rate}, Amount: ${order.amount}, Fee: ${order.fee}, Total: ${order.total} BTC`;

            console.log(orderStr);
            log += `\n${orderStr}`;
          }
        }
      }

      logStr = log + logStr;

      meta.recordTradeHistory.push(res);
      resolve();
      ar;
    });
  });
}

/**
 * Withdraw all BTC to users accounts
 * @return {object} promise
 */
function withdrawForAll() {
  return new Promise(function(resolve, reject) {
    let addrs = Object.keys(config.withdrawRatio);

    getBalance().then(function() {
      iterator(addrs[0], addrs, withdraw, resolve);

      function withdraw(addr) {
        return new Promise(function(resolve, reject) {
          let amount = parseFloat(meta.balance['BTC']) * parseFloat(config.withdrawRatio[addr]);
          let params = {
            query: `command=withdraw&currency=BTC&amount=${amount}&address=${addr}&nonce=${Date.now()}`,
          };
          let withdrawStr = `Withdraw ${amount} BTC to ${addr}. (${parseFloat(config.withdrawRatio[addr]) *
            100}% from ${meta.balance['BTC']} BTC)`;

          console.log(withdrawStr);
          logStr += `\n${withdrawStr}`;

          library.postReq(params, res => {
            meta.withdraw.addresses.push({ [addr]: res.response ? amount : 0 });
            resolve();
          });
        });
      }
    });
  });
}

/**
 * Write meta object to log file
 * @return {object} promise
 */
function writeLog() {
  return new Promise((resolve, reject) => {
    console.log('Step 5. (8) Recording Log File');
    fs.access(config.logFile, fs.constants.R_OK | fs.constants.W_OK, err => {
      if (err) {
        fs.writeFile(config.logFile, `${JSON.stringify(meta)}\n`, 'utf-8', err => {
          if (!err) {
            resolve();
          } else {
            reject(err);
          }
        });
      } else {
        fs.appendFile(config.logFile, `${JSON.stringify(meta)}\n`, 'utf-8', err => {
          if (!err) {
            resolve();
          } else {
            reject(err);
          }
        });
      }
    });
  });
}

/**
 * Do "Step to step" requests
 * @param  {any} fnAsync param
 * @param  {array} Array of params
 * @param  {function} Async function what return a promise
 * @param  {function} Global promise resolver
 * @return {undefined}
 */
function iterator(item, arr, fnAsync, resolve) {
  setTimeout(function() {
    arr.shift();

    fnAsync(item).then(function() {
      if (arr[0]) {
        iterator(arr[0], arr, fnAsync, resolve);
      } else {
        resolve();
      }
    }, onError);
  }, 500);
}

/**
 * Send meta object via E-mail
 * @return {undefined}
 */
function sendEmail() {
  let transporter = nodemailer.createTransport('');
  let data = Object.assign({}, meta);

  delete data.balance;
  delete data.currencies;
  delete data.orders;

  let body = `
		<ul>${logStr.replace(/\n/gim, '</li><li>').replace(/^<\/li>/, '')}</ul>
	`;

  console.log(body);

  let mailOptions = {
    from: 'POLONIEX trader',
    to: '',
    subject: 'Exchanged',
    html: body,
  };

  transporter.sendMail(mailOptions, function(error, info) {
    console.log('Message sent: ' + (error || info.response));
  });
}

/**
 * Percentage neet do be < 100
 * @return {bool}
 */
function checkPercentage() {
  let summ = 0;

  for (let address in config.withdrawRatio) {
    summ += config.withdrawRatio[address];
  }

  return summ > 1 ? false : true;
}

/**
 * Error logger
 * @param  {object|string}
 * @return {undefined} 
 */
function onError(err) {
  console.log(err);
}
