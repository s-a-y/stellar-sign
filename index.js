'use strict';

const StellarSdk = require('stellar-sdk');
const server = new StellarSdk.Server(process.env.HORIZON_URL || 'https://horizon.stellar.org');
const _ = require('lodash');
// if (process.env.ENV === 'production') {
  StellarSdk.Network.usePublicNetwork();
// } else {
//   StellarSdk.Network.useTestNetwork();
// }
const uuid = require('uuid');

const StellarSign = {

  /**
   *
   * @param Keypair srcKeypair
   * @param string destAddress
   * @param Buffer xdr
   */
  requestOperation: (srcKeypair, destAddress, xdr) => {

    return StellarSdk.FederationServer.resolve(destAddress)
      .then((fedRecord) => {
        return server.loadAccount(srcKeypair.publicKey())
          .then(sourceAccount => {
            const options = (fedRecord.memo ? {memo: new StellarSdk.Memo(fedRecord.memo_type, fedRecord.memo)} : {});
            const builder = new StellarSdk.TransactionBuilder(sourceAccount, options);

            builder
              .addOperation(StellarSdk.Operation.payment({
                destination: fedRecord.account_id,
                asset: StellarSdk.Asset.native(),
                amount: '0.0000001'
              }));

            const guid = uuid.v4();

            for (let i = 0; i < Math.ceil(xdr.length/64); i++) {
              const chunk = xdr.slice(i*64, (i+1)*64);
              builder
                .addOperation(StellarSdk.Operation.manageData({
                  name: ('srv1:op:' + guid + ':' + i),
                  value: chunk,
                }));
            }

            for (let i = 0; i < Math.ceil(xdr.length/64); i++) {
              builder
                .addOperation(StellarSdk.Operation.manageData({
                  name: ('srv1:op:' + guid + ':' + i),
                  value: '',
                }));
            }

            const tx = builder.build();
            tx.sign(srcKeypair);

            return server.submitTransaction(tx);
            // return Promise.resolve(tx.toEnvelope().toXDR().toString('base64'));
          })
      });

  },

  decodeXDR: (xdr) => {
    const tx = new StellarSdk.Transaction(xdr);

    const manageDataOps = _.filter(tx.operations, (item) => {
      if (item.type !== 'manageData') {
        return false;
      }
      const itemPieces = item.name.split(':');
      return item.value.length > 0
        && itemPieces[0] && itemPieces[0] === 'srv1'
        && itemPieces[1] && itemPieces[1] === 'op'
        && itemPieces[2] && itemPieces[3];
    });
    if (!manageDataOps.length) {
      return Promise.reject(new Error('No relevant manageData operations found'));
    }

    return server.loadAccount(tx.source)
      .then(srcAccount => {

        if (!srcAccount.home_domain) {
          return Promise.reject(new Error('Home domain not set on source account'));
        }

        return StellarSdk.StellarTomlResolver.resolve(srcAccount.home_domain)
          .then(tomlObject => {
            if (!tomlObject.SIGNING_REQUEST_ACCOUNT || tomlObject.SIGNING_REQUEST_ACCOUNT !== tx.source) {
              return Promise.reject('SIGNING_REQUEST_ACCOUNT doesn\'t exist in stellar.toml or doesn\'t match the source account')
            }

            const result = {};
            _.each(manageDataOps, (item) => {
              const itemPieces = item.name.split(':');
              if (!result[itemPieces[2]]) {
                result[itemPieces[2]] = { parts: [] };
              }
              result[itemPieces[2]].parts[itemPieces[3]] = item.value.toString('base64');
              result[itemPieces[2]].version = itemPieces[0];
              result[itemPieces[2]].type = itemPieces[1];
            });
            return _.map(result, (item) => {
              return {
                version: item.version,
                type: item.type,
                body: item.parts.join()
              }
            });
          })
          .catch(err => {
            return Promise.reject(new Error('stellar.toml placed on home domain is not found or invalid: ' + err.message))
          });
      });
  }
};

module.exports = StellarSign;