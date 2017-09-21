#!/usr/bin/env node
// Send to specified address, read config from json
// Copyright (C) Kost

var rise = require('shift-js');

var request = require('request');
var fs = require('fs');
var winston = require('winston');

var argv = require('minimist')(process.argv.slice(2));

winston.remove(winston.transports.Console);
winston.add(winston.transports.Console, {'timestamp':true});

winston.level = 'info';
sendadr = null;
apiurl = 'https://wallet.rise.vision';
txapiurl = apiurl+'/peer/transactions';
txfee = parseInt(10000000,10); // TxFee is 0.1
ponder = Math.pow(10, 8);
amounttx = null;
clientversion='0.1.1';
clientos='linux3.2.0-4-amd64';

if (argv.hasOwnProperty('l')) {
	winston.level = argv['l'];
}

if (argv.hasOwnProperty('c')) {
	amounttx=parseFloat(argv['c'])*ponder;
}

if (argv._.length === 0) {
	winston.log('error','Destination address to send is not specified!');	
	return;
}

sendadr = argv._[0];

global.jsonconf = JSON.parse(fs.readFileSync(process.env.HOME+'/.rise.json', 'utf8'));

winston.log('debug',"conf object:", global.jsonconf);

max=global.jsonconf.accounts[0];
max.balance=0;
maxcount = 0;
nethash = null;

option_tries=3;
option_delay=5000;

var tx_cb = function(error, response, body) {
  if (error != null) {
        winston.log('error','Got Error sending transaction: ', error);
  } else {
        winston.log('info',"Transaction sent", body);
  }
};

var transaction2network_cb = function(transaction, tryno) {
	winston.log('info',"Try: "+tryno+" to send transaction");
	request({
	  url: txapiurl,
	  json: { transactions: [transaction] },
	  method: 'POST',
	  headers: {
	    'Content-Type': 'application/json',
	    'os': clientos,
	    'version': clientversion,
	    'port': 1,
	    'nethash': nethash
	  }
	}, tx_cb);
};

var nethash_cb = function(error, response, body) {
        nethash = body.expected;
        if (error != null) {
                winston.log('error',"Error getting nethash, error is: "+error);
        } else {
                winston.log('debug', "Got nethash which is: "+nethash);
        }

	var amount;
	if (amounttx == null) {
		amount = max.balance - txfee;
	} else {
		amount = amounttx;
	}
	var dispamount = amount / ponder;
	winston.log('info','Sending '+amount+' ('+dispamount+') to address: '+sendadr+' from '+max.address + ' (' + max.delegate+')');
        var transaction = rise.transaction.createTransaction(sendadr, amount, max.passphrase, max.secondpassphrase);
        // transaction.fee = txfee;

        winston.log('info',"Transaction: "+JSON.stringify(transaction, null, 4) );

	for (var c = 0; c < option_tries; c++) {
		setTimeout(transaction2network_cb.bind(null, transaction,c), c*option_delay);
	}

};

var sendtoaddress = function() {
	request({
	  url: txapiurl,
	  json: { },
	  method: 'POST',
	  headers: {
	    'Content-Type': 'application/json',
	    'os': clientos,
	    'version': clientversion,
	    'port': 1,
	    'nethash': "wrongnethash"
	  }
	}, nethash_cb );
};

// double check sending address
var testadrtosend = function() {
	var sent = false;
	if (sendadr == null) {
		winston.log('warn','Sending to address which is null, aborting');
		return;
	}

	if (sendadr === max.address) {
		winston.log('warn','Sending to same address - aborting');
		return;
	}

	for (var c = 0; c < global.jsonconf.accounts.length; c++) {
		if (sendadr === global.jsonconf.accounts[c].address) {
			sent = true;
			sendtoaddress(sendadr);
		}
	}
	if (!sent) {
		winston.log('error','Sending to address not in list failed: '+sendadr);
	}
}

var findmaximum =  function() {
	winston.log('debug',"Finding maximum");
	// find address with maximum value
	for (var c = 0; c < global.jsonconf.accounts.length; c++) {
		winston.log('debug',"Testing maximum for "+global.jsonconf.accounts[c].balance+" against max "+max.balance);
		if (global.jsonconf.accounts[c].balance > max.balance) {
			max=global.jsonconf.accounts[c];
			winston.log('debug', "Higher value detected: "+max.balance);
		}
	}

	// display that amount
	winston.log('info','Maximum: '+max.address+' with balance '+max.balance);
	testadrtosend();
}

var getbalances = function (i, error, response, body) {
	if (error) {
		winston.log('error','error: ', error); // Print the error if one occurred
	}
	// winston.log('debug','statusCode:', response && response.statusCode); 
	winston.log('debug', "body: "+body);
	jsonresp = JSON.parse(body);
	winston.log('debug', 'balance: ', jsonresp.balance);
	winston.log('debug', 'account data:', global.jsonconf.accounts[i]);
	global.jsonconf.accounts[i].balance = parseInt(jsonresp.balance,10) || 0;
	winston.log('debug', "balance of account: ",global.jsonconf.accounts[i].balance);

	maxcount++;

	if (maxcount===global.jsonconf.accounts.length) {
		findmaximum();
	}
}

winston.log('debug', "Getting balances")
for (var i = 0; i < global.jsonconf.accounts.length; i++) {
	request(apiurl+'/api/accounts/getBalance?address='+global.jsonconf.accounts[i].address, getbalances.bind(null, i));
}

