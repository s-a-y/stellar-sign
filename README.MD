# Stellar Sign

Account should have a home domain set to be able to send requests,
and on home domain /.well-known/stellar.toml file should contain SIGNING_REQUEST_ACCOUNT=G...
to verify the legitimacy of siging request.


Executes `StellarSign.requestOperation` and pass XDR operation to be sent to the destination.

Usage example:

```
const StellarSign = require('./index');
const StellarSdk = require('stellar-sdk');

StellarSign
  .setHorizonUrl('https://horizon-testnet.stellar.org')
  .useNetwork(StellarSdk.Networks.TESTNET)
  .requestOperation(
  StellarSdk.Keypair.fromSecret('...'),
  'GD3CS2AR4YZ25LN6NARSSRJMUY7XQBJNGJJTQU2URRDPTPJZBYU2O3DD',
  StellarSdk.Operation.createAccount({
    destination: 'GAUCWS5EXPZLFKYKRSMXV4MRN6P76WTVZDRPKKDSJL7X4ZDQZDYRWRZH',
    startingBalance: '2'
  }).toXDR()
)
  .then(tx => {
    console.log(tx);
	// Success! Signing request sent

  })
  .catch(err => {
    console.error(err);
  });

```

Or if you want to prepare complete transaction envelope

```
const StellarSign = require('./index');
const StellarSdk = require('stellar-sdk');

const keypair = StellarSdk.Keypair.fromSecret('...');
const server = new StellarSdk.Server('https://horizon.stellar.org');
server.loadAccount(keypair.publicKey())
	.then(account => {
		const options = {
			memo: StellarSdk.Memo.text('test')
		};
		const builder = new StellarSdk.TransactionBuilder(account, options);
		
		builder
			.addOperation(StellarSdk.Operation.payment({
				destination: 'GAUCWS5EXPZLFKYKRSMXV4MRN6P76WTVZDRPKKDSJL7X4ZDQZDYRWRZH',
				asset: StellarSdk.Asset.native(),
				amount: '0.0000001'
			}));
		
		StellarSign.requestTransaction(
			keypair,
			'GD3CS2AR4YZ25LN6NARSSRJMUY7XQBJNGJJTQU2URRDPTPJZBYU2O3DD',
			builder.build().toEnvelope().toXDR()
		)
		.then(tx => {
			console.log(tx);
			// Success! Signing request sent
		
		})
		.catch(err => {
			console.error(err);
		});
    });

```


Recipient decodes transaction using `decodeXDR` method

```
 
StellarSign.decodeXDR(tx.envelope_xdr)
  .then(res => {
	
	if (res.type === 'tx') {
	  const transaction = new StellarSdk.Transaction(res.body);
	  transaction.sign(keypair);
	  server.submitTransaction(transaction);
	} else if (res.type === 'op') {
	  const operation = StellarSdk.Operation.fromXDRObject(StellarSdk.xdr.Operation.fromXDR(res.body, 'base64'));
	  console.log(operation);
	}
  });

```