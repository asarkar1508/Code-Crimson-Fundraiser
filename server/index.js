const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const PAYPAL_CLIENT = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_SECRET = process.env.PAYPAL_SECRET;
const PAYPAL_ENV = (process.env.PAYPAL_ENV || 'sandbox');
const PORT = process.env.PORT || 3000;
const app = express();
app.use(cors());
app.use(express.json());

const STORE_PATH = path.join(__dirname, '..', 'data', 'store.json');

function readStore() {
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return { transactions: [], totalINR: 0 };
  }
}

function writeStore(obj) {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(obj, null, 2));
}

async function getPayPalAccessToken() {
  const base = PAYPAL_ENV === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';

  const resp = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    body: 'grant_type=client_credentials',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${PAYPAL_CLIENT}:${PAYPAL_SECRET}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error('PayPal token error: ' + text);
  }
  return resp.json();
}

app.post('/api/create-order', async (req, res) => {
  try {
    const { amount = 10, currency = 'INR' } = req.body;
    if (!PAYPAL_CLIENT || !PAYPAL_SECRET) return res.status(500).json({ error: 'PayPal credentials not set on server' });

    const tokenResp = await getPayPalAccessToken();
    const token = tokenResp.access_token;
    const base = PAYPAL_ENV === 'live'
      ? 'https://api-m.paypal.com'
      : 'https://api-m.sandbox.paypal.com';

    const orderResp = await fetch(`${base}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          amount: {
            currency_code: currency,
            value: Number(amount).toFixed(2)
          },
          description: "Donation to Code Crimson - menstrual health fundraiser"
        }]
      })
    });
    const order = await orderResp.json();
    if (!order.id) return res.status(500).json({ error: 'Could not create order', details: order });
    res.json({ orderID: order.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/capture-order', async (req, res) => {
  try {
    const { orderID } = req.body;
    if (!orderID) return res.status(400).json({ error: 'orderID required' });
    const tokenResp = await getPayPalAccessToken();
    const token = tokenResp.access_token;
    const base = PAYPAL_ENV === 'live'
      ? 'https://api-m.paypal.com'
      : 'https://api-m.sandbox.paypal.com';

    const captureResp = await fetch(`${base}/v2/checkout/orders/${orderID}/capture`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    const capture = await captureResp.json();
    if (!capture || capture.status === 'ERROR') {
      return res.status(500).json({ error: 'Capture failed', details: capture });
    }

    const payer = capture.payer || {};
    let captureId = '';
    let amount = 0;
    let currency = '';
    try {
      const captures = capture.purchase_units[0].payments.captures;
      if (captures && captures.length > 0) {
        captureId = captures[0].id;
        amount = parseFloat(captures[0].amount.value);
        currency = captures[0].amount.currency_code;
      } else if (capture.id) {
        captureId = capture.id;
      }
    } catch (e) {}

    const store = readStore();
    const txn = {
      id: captureId || orderID,
      orderID,
      amount,
      currency,
      payer: {
        name: (payer.name && `${payer.name.given_name || ''} ${payer.name.surname || ''}`).trim(),
        email: payer.email_address || ''
      },
      raw: capture,
      createdAt: new Date().toISOString()
    };

    store.transactions.push(txn);

    if (currency === 'INR') {
      store.totalINR = (store.totalINR || 0) + Number(amount);
    } else {
      store.totalINR = store.totalINR || 0;
    }

    writeStore(store);

    res.json({ success: true, captureId: txn.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/total', (req, res) => {
  const store = readStore();
  res.json({
    totalINR: store.totalINR || 0,
    transactions: (store.transactions || []).slice(-20).reverse()
  });
});

const publicPath = path.join(__dirname, '..', 'public');
if (fs.existsSync(publicPath)) {
  app.use(express.static(publicPath));
  app.get('*', (req, res) => res.sendFile(path.join(publicPath, 'index.html')));
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} (env=${PAYPAL_ENV})`);
});