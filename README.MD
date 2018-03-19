# Stellar Sign

Account should have a home domain set to be able to send requests,
it executes `StellarSign.requestOperation` and passes XDR operation to be sent to the destination.

Recipient decodes transaction using `decodeXDR` method

Usage example:

```
const StellarSign = require('./index');
const StellarSdk = require('stellar-sdk');

StellarSign.requestOperation(
  StellarSdk.Keypair.fromSecret('...'),
  'GD3CS2AR4YZ25LN6NARSSRJMUY7XQBJNGJJTQU2URRDPTPJZBYU2O3DD',
  StellarSdk.Operation.createAccount({
    destination: 'GAUCWS5EXPZLFKYKRSMXV4MRN6P76WTVZDRPKKDSJL7X4ZDQZDYRWRZH',
    startingBalance: '2'
  }).toXDR()
)
  .then(tx => {
    console.log(tx);

    return StellarSign.decodeXDR(tx.envelope_xdr)
      .then(ops => {
        console.log(StellarSdk.Operation.fromXDRObject(StellarSdk.xdr.Operation.fromXDR(ops[0].body, 'base64')));
      });

  })
  .catch(err => {
    console.error(err);
  });


```