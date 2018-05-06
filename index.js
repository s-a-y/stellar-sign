'use strict';

const StellarSdk = require('stellar-sdk');
const _ = require('lodash');
const uuid = require('uuid');

const StellarSign = {

  setHorizonUrl: (url) => {
    StellarSign.horizonUrl = url;
    return StellarSign;
  },

  useNetwork: (networkPassphrase) => {
    StellarSign.networkPassphrase = networkPassphrase;
    return StellarSign;
  },

  getServer() {
    if (!StellarSign.server) {
      StellarSign.server = new StellarSdk.Server(StellarSign.horizonUrl || process.env.HORIZON_URL || 'https://horizon.stellar.org');
      StellarSdk.Network.use(new StellarSdk.Network(StellarSign.networkPassphrase || (
        process.env.NODE_ENV === 'production' ? StellarSdk.Networks.PUBLIC : StellarSdk.Networks.TESTNET
      )));
    }
    return StellarSign.server;
  },

  /**
   *
   * @param xdr
   * @param guid
   * @param type
   * @returns Array
   */
  encodeXdr: (xdr, guid, type = 'op') => {
    let result = [];
    for (let i = 0; i < Math.ceil(xdr.length / 64); i++) {
      const chunk = xdr.slice(i * 64, (i + 1) * 64);
      result.push({
        name: `srv1:${type}:${guid}:${i}`,
        value: chunk,
      });
      result.push({
        name: `srv1:${type}:${guid}:${i}`,
        value: null,
      });
    }
    return result;
  },

  resolveAccount: (destAddress) => {
    return new Promise(function (resolve, reject) {
      !!destAddress.account_id
        ? resolve(destAddress)
        : StellarSdk.FederationServer.resolve(destAddress)
          .then(result => {
            resolve(result);
          })
          .catch(err => {
            reject(err);
          });
    });
  },

  /**
   *
   * @param srcKeypair
   * @param destAddress
   * @param xdr
   */
  requestOperation: (srcKeypair, destAddress, xdr) => {
    return Promise.all([
      StellarSign.resolveAccount(destAddress),
      StellarSign.getServer().loadAccount(srcKeypair.publicKey())
    ])
      .then(([fedRecord, sourceAccount]) => {
        const options = (fedRecord.memo ? {memo: new StellarSdk.Memo(fedRecord.memo_type, fedRecord.memo)} : {});
        const builder = new StellarSdk.TransactionBuilder(sourceAccount, options);

        builder
          .addOperation(StellarSdk.Operation.payment({
            destination: fedRecord.account_id,
            asset: StellarSdk.Asset.native(),
            amount: '0.0000001'
          }));

        StellarSign.encodeXdr(xdr, uuid.v4(), 'op').forEach((item) => {
          builder.addOperation(StellarSdk.Operation.manageData(item));
        });

        const tx = builder.build();
        tx.sign(srcKeypair);

        return StellarSign.getServer().submitTransaction(tx);
      });
  },

  requestTransaction: (srcKeypair, destAddress, xdr) => {
    return Promise.all([
      StellarSign.resolveAccount(destAddress),
      StellarSign.getServer().loadAccount(srcKeypair.publicKey())
    ])
      .then(([fedRecord, sourceAccount]) => {
        const options = (fedRecord.memo ? {memo: new StellarSdk.Memo(fedRecord.memo_type, fedRecord.memo)} : {});
        const builder = new StellarSdk.TransactionBuilder(sourceAccount, options);

        builder
          .addOperation(StellarSdk.Operation.payment({
            destination: fedRecord.account_id,
            asset: StellarSdk.Asset.native(),
            amount: '0.0000001'
          }));

        StellarSign.encodeXdr(xdr, uuid.v4(), 'tx').forEach((item) => {
          builder.addOperation(StellarSdk.Operation.manageData(item));
        });

        const tx = builder.build();
        tx.sign(srcKeypair);

        return StellarSign.getServer().submitTransaction(tx);
      });
  },

  /**
   * @param tx
   * @returns {Promise<Array>}
   */
  parseTx: (tx) => {
    const manageDataOps = _.filter(tx.operations, (item) => {
      if (item.type !== 'manageData' || !item.value) {
        return false;
      }
      const itemPieces = item.name.split(':');
      return itemPieces[0] && itemPieces[0] === 'srv1'
        && itemPieces[1] && (itemPieces[1] === 'op' || itemPieces[1] === 'tx')
        && itemPieces[2] && itemPieces[3];
    });

    if (!manageDataOps.length) {
      return Promise.reject(new Error('No relevant manageData operations found'));
    }

    const result = {};
    _.each(manageDataOps, (item) => {
      const itemPieces = item.name.split(':');
      if (!result[itemPieces[2]]) {
        result[itemPieces[2]] = {parts: [], bufferSize: 0};
      }
      result[itemPieces[2]].parts[itemPieces[3]] = item.value;
      result[itemPieces[2]].bufferSize += item.value.length;
      result[itemPieces[2]].version = itemPieces[0];
      result[itemPieces[2]].type = itemPieces[1];
    });

    return Promise.resolve(_.map(result, (item) => {

      let parsed = null;
      const body = Buffer.concat(item.parts, item.bufferSize).toString('base64');
      if (item.type === 'tx') {
        parsed = new StellarSdk.Transaction(body);
      } else if (item.type === 'op') {
        parsed = StellarSdk.Operation.fromXDRObject(
          StellarSdk.xdr.Operation.fromXDR(body, 'base64')
        );
      }

      return {
        version: item.version,
        type: item.type,
        body: body,
        parsed: parsed
      }
    }));
  },

  decodeXDR: (xdr, skipSenderDomainValidation = false) => {
    const tx = new StellarSdk.Transaction(xdr);

    return StellarSign.getServer().loadAccount(tx.source)
      .then(srcAccount => {

        if (skipSenderDomainValidation) {
          return srcAccount;
        }

        if (!srcAccount.home_domain) {
          return Promise.reject(new Error('Home domain not set on source account'));
        }

        return StellarSdk.StellarTomlResolver.resolve(srcAccount.home_domain)
          .then(tomlObject => {
            if (!tomlObject.SIGNING_REQUEST_ACCOUNT || tomlObject.SIGNING_REQUEST_ACCOUNT !== tx.source) {
              return Promise.reject('SIGNING_REQUEST_ACCOUNT doesn\'t exist in stellar.toml or doesn\'t match the source account')
            }
            return srcAccount;
          })
          .catch(err => {
            return Promise.reject(new Error('stellar.toml placed on home domain is not found or invalid: ' + err.message))
          });
      })
      .then((srcAccount) => {
        return StellarSign.parseTx(tx)
          .then((result) => {
            return _.map(result, (item) => {
              return Object.assign(item, { sender: srcAccount.home_domain });
            });
          });
      })
      .catch(err => {
        return Promise.reject(new Error('Decoding XDR failed: ' + err.message))
      });
  }
};

module.exports = StellarSign;