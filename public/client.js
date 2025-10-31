// Client-side script: renders PayPal buttons but uses server-side order creation + capture endpoints.
// Expects server endpoints:
// POST /api/create-order  -> { amount, currency }  returns { orderID }
// POST /api/capture-order -> { orderID }            returns PayPal capture details
// GET  /api/total         -> { totalINR, transactions: [...] }

document.addEventListener('DOMContentLoaded', () => {
  const amountInput = document.getElementById('donation-amount');
  const currencySelect = document.getElementById('currency');
  const thankyouEl = document.getElementById('thankyou');
  const raisedText = document.getElementById('raised-text');
  const progressFill = document.getElementById('progress-fill');

  const GOAL = 100000;

  async function fetchTotal() {
    try {
      const res = await fetch('/api/total');
      if (!res.ok) throw new Error('Failed to fetch totals');
      const data = await res.json();
      const totalINR = data.totalINR || 0;
      raisedText.textContent = `₹${Math.round(totalINR).toLocaleString('en-IN')}`;
      const percentage = Math.min(100, (totalINR / GOAL) * 100);
      progressFill.style.width = percentage + '%';
    } catch (err) {
      console.warn('Could not fetch totals', err);
    }
  }
  fetchTotal();

  function renderPayPal() {
    if (!window.paypal) return console.warn('PayPal SDK not loaded yet');
    paypal.Buttons({
      style: { shape: 'rect', color: 'gold', layout: 'vertical', label: 'donate' },

      createOrder: function() {
        const amount = parseFloat(amountInput.value) || 10;
        const currency = (currencySelect.value || 'INR').toUpperCase();
        return fetch('/api/create-order', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ amount, currency })
        })
        .then(res => res.json())
        .then(data => {
          if (!data.orderID) throw new Error('No orderID returned');
          return data.orderID;
        });
      },

      onApprove: function(data) {
        return fetch('/api/capture-order', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ orderID: data.orderID })
        })
        .then(res => res.json())
        .then(info => {
          if (info.error) throw new Error(info.error);
          thankyouEl.innerHTML = `<strong>Thank you!</strong> Donation received. Transaction ID: ${info.captureId || info.id}`;
          // Refresh totals from server
          fetchTotal();
        }).catch(err => {
          thankyouEl.innerHTML = `<span style="color:#b00020">Payment error: ${err.message}</span>`;
        });
      },

      onError: function(err) {
        thankyouEl.innerHTML = `<span style="color:#b00020">Payment error: ${err && err.toString ? err.toString() : 'Unknown'}</span>`;
      }
    }).render('#paypal-button-container');
  }

  let attempts = 0;
  const poll = setInterval(() => {
    attempts++;
    if (window.paypal) { clearInterval(poll); renderPayPal(); }
    if (attempts > 20) clearInterval(poll);
  }, 250);

  currencySelect.addEventListener('change', () => {});
});